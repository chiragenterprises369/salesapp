import { Injectable, Logger } from '@nestjs/common';
import type { ImportCommitRequest, ImportJob, ImportPreviewResponse, LeadSource, StageType } from '@vistar/shared';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AuditService } from '../../../common/audit/audit.service.js';
import type { AuthContext } from '../../../common/auth/auth-context.js';
import { ScopeService } from '../../../common/auth/scope.service.js';
import { AppException, notFound } from '../../../common/errors/app-exception.js';
import type { ImportJob as ImportJobRow, Lead as LeadRow, Prisma } from '../../../generated/prisma/client.js';
import { EventBus } from '../../../infra/events/event-bus.service.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../../infra/prisma/tenant.js';
import { ActivityService } from '../activity.service.js';
import { endOfColumn, endOfColumnKeys } from '../lead-position.js';
import { scoreLead } from '../lead-score.js';
import { stageDates, syncDealsForStage } from '../lead-stage.js';
import { LeadsService, normalizeTags } from '../leads.service.js';
import { can, publishSafe, requestActor, type RequestActor, type TenantDb } from '../lib/context.js';
import { isEmail, normalizePhone, parseCustomValue, parseRupees, parseSource, suggestMapping, type MappingTarget } from './mapping.js';
import { IMPORT_MAX_BYTES, parseTable, type Table } from './table.js';

/** Minimal multer file shape (memory storage). */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const IMPORT_DIR = path.join(os.tmpdir(), 'vistar-imports');
const CHUNK = 200;
const MAX_ERRORS = 500;
const STALE_UPLOAD_MS = 24 * 3_600_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StageRef {
  id: string;
  pipelineId: string;
  type: StageType;
}

interface PreparedRow {
  rowNo: number;
  name: string;
  text: Partial<Record<'companyName' | 'phone' | 'email' | 'city' | 'state' | 'productInterest' | 'requirement', string>>;
  source: LeadSource;
  sourceRef: string | null;
  valueInr: number | null;
  tags: string[];
  ownerId: string | undefined;
  stage: StageRef | undefined;
  customFields: Record<string, string | number | boolean>;
}

interface Ctx {
  auth: AuthContext;
  actor: RequestActor;
  workspaceId: string;
  importId: string;
  strategy: ImportCommitRequest['duplicateStrategy'];
  columnFor: Map<MappingTarget, string>;
  customTypes: Map<string, string>;
  stagesByName: Map<string, StageRef>;
  defaultStage: StageRef;
  usersByEmail: Map<string, string>;
  defaultOwnerId: string | null;
  defaultTags: string[];
  canAssign: boolean;
  lastPos: Map<string, string | null>;
  seenPhone: Set<string>;
  seenEmail: Set<string>;
  seenRef: Set<string>;
  /** Existing leads already updated by this import (one update per lead). */
  touched: Set<string>;
  allTags: Set<string>;
  counts: { created: number; updated: number; skipped: number };
  errors: Array<{ row: number; message: string }>;
  errorCount: number;
}

const TRUNC: Record<keyof PreparedRow['text'], number> = {
  companyName: 160,
  phone: 20,
  email: 254,
  city: 80,
  state: 80,
  productInterest: 200,
  requirement: 4000,
};

@Injectable()
export class LeadImportService {
  private readonly logger = new Logger(LeadImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly activities: ActivityService,
    private readonly leads: LeadsService,
  ) {}

  // ------------------------------------------------------------------ preview

  async preview(auth: AuthContext, file: UploadedFileLike | undefined): Promise<ImportPreviewResponse> {
    if (!file?.buffer?.length) throw new AppException('IMPORT_INVALID_FILE', 'Choose a CSV or Excel (.xlsx) file to upload');
    if (file.size > IMPORT_MAX_BYTES || file.buffer.length > IMPORT_MAX_BYTES) throw new AppException('PAYLOAD_TOO_LARGE', 'Files can be up to 10 MB');
    const fileName = path.basename(file.originalname || 'leads.csv').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
    const table = await parseTable(fileName, file.buffer);

    const db = this.prisma.forTenant(auth.workspaceId);
    const customFields = await db.customField.findMany({ where: { entity: 'lead' }, select: { key: true, label: true } });
    const id = randomUUID();
    await mkdir(IMPORT_DIR, { recursive: true });
    await writeFile(path.join(IMPORT_DIR, id), file.buffer);
    void this.cleanupStaleUploads();

    await db.importJob.create({
      data: {
        id,
        workspaceId: auth.workspaceId,
        createdById: auth.userId,
        status: 'previewed',
        fileKey: `local:${id}`,
        fileName,
        columns: table.columns,
        rowCount: table.rows.length,
      },
    });
    return {
      importId: id,
      columns: table.columns,
      sampleRows: table.rows.slice(0, 20),
      suggestedMapping: suggestMapping(table.columns, customFields),
      rowCount: table.rows.length,
    };
  }

  private async cleanupStaleUploads(): Promise<void> {
    try {
      const now = Date.now();
      for (const name of await readdir(IMPORT_DIR)) {
        const full = path.join(IMPORT_DIR, name);
        if (now - (await stat(full)).mtimeMs > STALE_UPLOAD_MS) await rm(full, { force: true });
      }
    } catch {
      // best effort
    }
  }

  // ------------------------------------------------------------------ status

  private toDto(j: ImportJobRow): ImportJob {
    const errors = Array.isArray(j.errors) ? (j.errors as Array<{ row: number; message: string }>) : [];
    return {
      id: j.id,
      status: j.status,
      rowCount: j.rowCount,
      created: j.created,
      updated: j.updated,
      skipped: j.skipped,
      errors: errors.slice(0, MAX_ERRORS),
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
    };
  }

  /** Import jobs are visible to their creator and to callers with workspace-wide scope. */
  private async loadJob(db: TenantDb, auth: AuthContext, id: string): Promise<ImportJobRow> {
    const job = await db.importJob.findUnique({ where: { id } });
    if (!job || (job.createdById !== auth.userId && auth.dataScope !== 'all')) throw notFound('Import');
    return job;
  }

  async get(auth: AuthContext, id: string): Promise<ImportJob> {
    return this.toDto(await this.loadJob(this.prisma.forTenant(auth.workspaceId), auth, id));
  }

  // ------------------------------------------------------------------ commit

  async commit(auth: AuthContext, req: Request, id: string, body: ImportCommitRequest): Promise<ImportJob> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const job = await this.loadJob(db, auth, id);
    if (job.status !== 'previewed') throw new AppException('CONFLICT', 'This import has already run');

    // mapping
    const customTypes = new Map((await db.customField.findMany({ where: { entity: 'lead' }, select: { key: true, type: true } })).map((f) => [f.key, f.type]));
    const columnFor = new Map<MappingTarget, string>();
    for (const [column, target] of Object.entries(body.mapping)) {
      if (!job.columns.includes(column)) throw new AppException('IMPORT_MAPPING_INVALID', 'The mapping refers to a column that is not in the file');
      if (target === null) continue;
      if (columnFor.has(target as MappingTarget)) throw new AppException('IMPORT_MAPPING_INVALID', 'Map each lead field to one column only');
      if (target.startsWith('custom.') && !customTypes.has(target.slice(7))) throw new AppException('IMPORT_MAPPING_INVALID', 'A mapped custom field does not exist');
      columnFor.set(target as MappingTarget, column);
    }
    if (!columnFor.has('name')) throw new AppException('IMPORT_MAPPING_INVALID', 'Map a column to the lead name');

    const canAssign = can(auth, 'leads.assign');
    if (body.defaultOwnerId) {
      if (body.defaultOwnerId !== auth.userId && !canAssign) throw new AppException('FORBIDDEN', 'You cannot assign leads to other users');
      await this.leads.assertAssignable(db, body.defaultOwnerId);
    }

    const claimed = await db.importJob.updateMany({ where: { id, status: 'previewed' }, data: { status: 'running', mapping: body.mapping as Prisma.InputJsonObject } });
    if (claimed.count !== 1) throw new AppException('CONFLICT', 'This import has already run');

    const filePath = job.fileKey.startsWith('local:') && UUID_RE.test(job.fileKey.slice(6)) ? path.join(IMPORT_DIR, job.fileKey.slice(6)) : null;
    const actor = await requestActor(db, auth);
    let ctx: Ctx | null = null;
    let failed = false;
    try {
      if (!filePath) throw new AppException('IMPORT_INVALID_FILE', 'The uploaded file is no longer available. Upload it again.');
      let buffer: Buffer;
      try {
        buffer = await readFile(filePath);
      } catch {
        throw new AppException('IMPORT_INVALID_FILE', 'The uploaded file is no longer available. Upload it again.');
      }
      const table = await parseTable(job.fileName, buffer);
      ctx = await this.buildContext(db, auth, actor, id, body, columnFor, customTypes, canAssign);
      await this.run(db, ctx, table);
    } catch (err) {
      failed = true;
      const message = err instanceof AppException ? err.message : 'The import stopped because of an unexpected error. Rows before it were saved.';
      if (!(err instanceof AppException)) this.logger.error(`Import ${id} failed: ${(err as Error).name}`);
      (ctx?.errors ?? []).push({ row: 0, message });
      if (!ctx) await db.importJob.update({ where: { id }, data: { errors: [{ row: 0, message }] } });
    } finally {
      if (filePath) await rm(filePath, { force: true }).catch(() => undefined);
    }

    const finished = await db.importJob.update({
      where: { id },
      data: {
        status: failed ? 'failed' : 'completed',
        finishedAt: new Date(),
        ...(ctx ? { ...ctx.counts, errors: this.errorList(ctx) } : {}),
      },
    });
    if (ctx) await this.leads.ensureTags(db, wid, [...ctx.allTags]);
    await this.audit.record(
      auth,
      req,
      { action: 'lead.import', entityType: 'import', entityId: id, diff: { status: finished.status, rowCount: job.rowCount, ...(ctx?.counts ?? {}), errors: ctx?.errorCount ?? 0, strategy: body.duplicateStrategy } },
      actor.summary?.name,
    );
    await publishSafe(this.events, this.logger, 'import.progress', wid, { importId: id, processed: job.rowCount, total: job.rowCount, done: true }, { actor: actor.event, userId: auth.userId });
    return this.toDto(finished);
  }

  private errorList(ctx: Ctx): Array<{ row: number; message: string }> {
    if (ctx.errorCount <= MAX_ERRORS) return ctx.errors;
    return [...ctx.errors.slice(0, MAX_ERRORS - 1), { row: 0, message: `${ctx.errorCount - (MAX_ERRORS - 1)} more rows had errors` }];
  }

  private async buildContext(
    db: TenantDb,
    auth: AuthContext,
    actor: RequestActor,
    importId: string,
    body: ImportCommitRequest,
    columnFor: Map<MappingTarget, string>,
    customTypes: Map<string, string>,
    canAssign: boolean,
  ): Promise<Ctx> {
    const def = await this.leads.defaultStage(db);
    const stages = await db.stage.findMany({ where: { pipelineId: def.pipelineId }, select: { id: true, pipelineId: true, type: true, name: true, key: true } });
    const stagesByName = new Map<string, StageRef>();
    for (const s of stages) {
      const ref = { id: s.id, pipelineId: s.pipelineId, type: s.type };
      stagesByName.set(s.name.trim().toLowerCase(), ref);
      stagesByName.set(s.key.toLowerCase(), ref);
    }
    const users = columnFor.has('ownerEmail') ? await db.user.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, email: true } }) : [];
    return {
      auth,
      actor,
      workspaceId: auth.workspaceId,
      importId,
      strategy: body.duplicateStrategy,
      columnFor,
      customTypes,
      stagesByName,
      defaultStage: { id: def.id, pipelineId: def.pipelineId, type: def.type },
      usersByEmail: new Map(users.map((u) => [u.email.toLowerCase(), u.id])),
      defaultOwnerId: body.defaultOwnerId ?? null,
      defaultTags: normalizeTags(body.defaultTags.map((t) => t.slice(0, 40))),
      canAssign,
      lastPos: new Map(),
      seenPhone: new Set(),
      seenEmail: new Set(),
      seenRef: new Set(),
      touched: new Set(),
      allTags: new Set(),
      counts: { created: 0, updated: 0, skipped: 0 },
      errors: [],
      errorCount: 0,
    };
  }

  private rowError(ctx: Ctx, row: number, message: string): void {
    ctx.errorCount++;
    if (ctx.errors.length < MAX_ERRORS) ctx.errors.push({ row, message });
  }

  /** Validate and normalise one file row. Returns null (and records an error) when the row cannot be imported. */
  private prepare(ctx: Ctx, raw: Record<string, string>, rowNo: number): PreparedRow | null {
    const get = (t: MappingTarget) => {
      const col = ctx.columnFor.get(t);
      return col ? (raw[col] ?? '').trim() : '';
    };
    const fail = (message: string): null => {
      this.rowError(ctx, rowNo, message);
      return null;
    };
    const name = get('name').slice(0, 120);
    if (!name) return fail('Name is missing');

    const text: PreparedRow['text'] = {};
    for (const f of ['companyName', 'city', 'state', 'productInterest', 'requirement'] as const) {
      const v = get(f);
      if (v) text[f] = v.slice(0, TRUNC[f]);
    }
    const phoneRaw = get('phone');
    if (phoneRaw) {
      const phone = normalizePhone(phoneRaw);
      if (!phone) return fail('Phone number is not valid');
      text.phone = phone;
    }
    const email = get('email').toLowerCase();
    if (email) {
      if (!isEmail(email)) return fail('Email address is not valid');
      text.email = email;
    }
    const valueRaw = get('valueInr');
    const valueInr = valueRaw ? parseRupees(valueRaw) : null;
    if (valueRaw && valueInr === null) return fail('Value must be an amount in rupees');

    let ownerId: string | undefined;
    const ownerEmail = get('ownerEmail').toLowerCase();
    if (ownerEmail) {
      ownerId = ctx.usersByEmail.get(ownerEmail);
      if (!ownerId) return fail('Owner email does not match an active team member');
      if (ownerId !== ctx.auth.userId && !ctx.canAssign) return fail('You cannot assign leads to other users');
    }
    let stage: StageRef | undefined;
    const stageName = get('stageName').toLowerCase();
    if (stageName) {
      stage = ctx.stagesByName.get(stageName);
      if (!stage) return fail('Stage does not match a stage in the default pipeline');
    }
    const customFields: PreparedRow['customFields'] = {};
    for (const [key, type] of ctx.customTypes) {
      const v = get(`custom.${key}`);
      if (!v) continue;
      const parsed = parseCustomValue(type, v);
      if (!parsed.ok) return fail(`Custom field ${key} has an invalid value`);
      customFields[key] = parsed.value;
    }
    const tags = normalizeTags(get('tags').split(/[,;|]/).map((t) => t.slice(0, 40)));
    return {
      rowNo,
      name,
      text,
      source: parseSource(get('source')) ?? 'import',
      sourceRef: get('sourceRef').slice(0, 120) || null,
      valueInr,
      tags,
      ownerId,
      stage,
      customFields,
    };
  }

  private async run(db: TenantPrisma, ctx: Ctx, table: Table): Promise<void> {
    const total = table.rows.length;
    for (let i = 0; i < total; i += CHUNK) {
      const prepared = table.rows
        .slice(i, i + CHUNK)
        .map((raw, j) => this.prepare(ctx, raw, i + j + 2))
        .filter((r): r is PreparedRow => r !== null);
      await this.processChunk(db, ctx, prepared);
      const processed = Math.min(total, i + CHUNK);
      await db.importJob.update({ where: { id: ctx.importId }, data: { ...ctx.counts, errors: this.errorList(ctx) } });
      if (processed < total) {
        await publishSafe(this.events, this.logger, 'import.progress', ctx.workspaceId, { importId: ctx.importId, processed, total, done: false }, { actor: ctx.actor.event, userId: ctx.auth.userId });
      }
    }
  }

  private async processChunk(db: TenantPrisma, ctx: Ctx, rows: PreparedRow[]): Promise<void> {
    if (!rows.length) return;
    const phones = [...new Set(rows.map((r) => r.text.phone).filter((v): v is string => !!v))];
    const emails = [...new Set(rows.map((r) => r.text.email).filter((v): v is string => !!v))];
    const refs = [...new Set(rows.map((r) => r.sourceRef).filter((v): v is string => !!v))];
    const or: Prisma.LeadWhereInput[] = [];
    if (phones.length) or.push({ phone: { in: phones } });
    if (emails.length) or.push({ email: { in: emails } });
    if (refs.length) or.push({ sourceRef: { in: refs } });
    const existing = or.length ? await db.lead.findMany({ where: { deletedAt: null, OR: or }, orderBy: { createdAt: 'asc' } }) : [];
    const byPhone = new Map<string, LeadRow>();
    const byEmail = new Map<string, LeadRow>();
    const byRef = new Map<string, LeadRow>();
    for (const l of existing) {
      if (l.phone && !byPhone.has(l.phone)) byPhone.set(l.phone, l);
      if (l.email && !byEmail.has(l.email.toLowerCase())) byEmail.set(l.email.toLowerCase(), l);
      if (l.sourceRef) byRef.set(`${l.source}:${l.sourceRef}`, l);
    }
    // Rows whose sourceRef already exists can never be created (unique per source).
    const allRefs = await this.allRefsTaken(db, rows);

    const toCreate: PreparedRow[] = [];
    const toUpdate: Array<{ row: PreparedRow; lead: LeadRow }> = [];
    for (const row of rows) {
      const refKey = row.sourceRef ? `${row.source}:${row.sourceRef}` : null;
      const refSeen = !!refKey && ctx.seenRef.has(refKey);
      const inFile = (!!row.text.phone && ctx.seenPhone.has(row.text.phone)) || (!!row.text.email && ctx.seenEmail.has(row.text.email)) || refSeen;
      const match = (row.text.phone ? byPhone.get(row.text.phone) : undefined) ?? (row.text.email ? byEmail.get(row.text.email) : undefined) ?? (refKey ? byRef.get(refKey) : undefined);
      if (row.text.phone) ctx.seenPhone.add(row.text.phone);
      if (row.text.email) ctx.seenEmail.add(row.text.email);
      if (refKey) ctx.seenRef.add(refKey);

      if (match && ctx.strategy !== 'create') {
        if (ctx.strategy === 'skip' || inFile || ctx.touched.has(match.id)) {
          ctx.counts.skipped++;
        } else if (!(await this.scope.canSee(ctx.auth, match.ownerId))) {
          this.rowError(ctx, row.rowNo, 'Matches a lead you do not have access to');
        } else {
          ctx.touched.add(match.id);
          toUpdate.push({ row, lead: match });
        }
        continue;
      }
      if (inFile && ctx.strategy !== 'create') {
        ctx.counts.skipped++; // first occurrence in the file wins
        continue;
      }
      if (refKey && (allRefs.has(refKey) || refSeen)) {
        this.rowError(ctx, row.rowNo, 'A lead with this source reference already exists');
        continue;
      }
      toCreate.push(row);
    }

    await db.$transaction(
      async (tx) => {
        await this.createLeads(tx, ctx, toCreate);
        for (const u of toUpdate) await this.updateLead(tx, ctx, u.row, u.lead);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    ctx.counts.created += toCreate.length;
    ctx.counts.updated += toUpdate.length;
  }

  private async allRefsTaken(db: TenantDb, rows: PreparedRow[]): Promise<Set<string>> {
    const withRef = rows.filter((r) => r.sourceRef);
    if (!withRef.length) return new Set();
    const taken = await db.lead.findMany({
      where: { OR: withRef.map((r) => ({ source: r.source, sourceRef: r.sourceRef })) },
      select: { source: true, sourceRef: true },
    });
    return new Set(taken.map((t) => `${t.source}:${t.sourceRef}`));
  }

  private async createLeads(tx: TenantDb, ctx: Ctx, rows: PreparedRow[]): Promise<void> {
    if (!rows.length) return;
    const wid = ctx.workspaceId;
    const now = new Date();

    // contacts: phone is unique per workspace (reuse), others get a new contact
    const phoneRows = rows.filter((r) => r.text.phone);
    if (phoneRows.length) {
      await tx.contact.createMany({
        data: phoneRows.map((r) => ({ workspaceId: wid, name: r.name, phone: r.text.phone!, email: r.text.email ?? null, city: r.text.city ?? null })),
        skipDuplicates: true,
      });
    }
    const contactByPhone = new Map(
      phoneRows.length ? (await tx.contact.findMany({ where: { phone: { in: phoneRows.map((r) => r.text.phone!) } }, select: { id: true, phone: true } })).map((c) => [c.phone!, c.id]) : [],
    );
    const contactIds = rows.map((r) => (r.text.phone ? contactByPhone.get(r.text.phone) : undefined) ?? randomUUID());
    const newContacts = rows.map((r, i) => ({ r, id: contactIds[i]! })).filter(({ r }) => !r.text.phone);
    if (newContacts.length) {
      await tx.contact.createMany({ data: newContacts.map(({ r, id }) => ({ id, workspaceId: wid, name: r.name, email: r.text.email ?? null, city: r.text.city ?? null })) });
    }

    // positions per stage (appended in file order)
    const stageOf = (r: PreparedRow) => r.stage ?? ctx.defaultStage;
    const byStage = new Map<string, PreparedRow[]>();
    for (const r of rows) byStage.set(stageOf(r).id, [...(byStage.get(stageOf(r).id) ?? []), r]);
    const positions = new Map<PreparedRow, string>();
    for (const [stageId, list] of byStage) {
      const keys = await endOfColumnKeys(tx, stageId, list.length, ctx.lastPos.has(stageId) ? ctx.lastPos.get(stageId) : undefined);
      list.forEach((r, i) => positions.set(r, keys[i]!));
      ctx.lastPos.set(stageId, keys.at(-1) ?? null);
    }

    const leads = rows.map((r, i) => {
      const stage = stageOf(r);
      const tags = normalizeTags([...r.tags, ...ctx.defaultTags]);
      tags.forEach((t) => ctx.allTags.add(t));
      const fields = {
        companyName: r.text.companyName ?? null,
        phone: r.text.phone ?? null,
        email: r.text.email ?? null,
        city: r.text.city ?? null,
        state: r.text.state ?? null,
        productInterest: r.text.productInterest ?? null,
        requirement: r.text.requirement ?? null,
      };
      const valueInr = r.valueInr ?? 0;
      const scored = scoreLead({ ...fields, source: r.source, valueInr, tags, createdAt: now, lastActivityAt: null }, now);
      return {
        id: randomUUID(),
        workspaceId: wid,
        name: r.name,
        ...fields,
        source: r.source,
        sourceRef: r.sourceRef,
        ownerId: r.ownerId ?? ctx.defaultOwnerId ?? (ctx.auth.dataScope !== 'all' ? ctx.auth.userId : null),
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        stageType: stage.type,
        position: positions.get(r)!,
        valueInr,
        score: scored.score,
        scoreBreakdown: scored.breakdown,
        temperature: scored.temperature,
        tags,
        customFields: r.customFields,
        contactId: contactIds[i]!,
        ...stageDates(stage.type, now),
        createdAt: now,
      };
    });
    await tx.lead.createMany({ data: leads.map(({ stageType: _t, ...l }) => l) });
    const won = leads.filter((l) => l.stageType === 'won');
    if (won.length) await syncDealsForStage(tx, wid, won, 'won', now);
    await tx.activity.createMany({
      data: leads.flatMap((l) => [
        this.activities.data(wid, ctx.actor, l.id, 'lead_created', { source: l.source }, now),
        ...(l.ownerId ? [this.activities.data(wid, ctx.actor, l.id, 'assigned', { fromUserId: null, toUserId: l.ownerId, rule: 'import' }, now)] : []),
      ]),
    });
  }

  /** Update strategy: fill the existing lead with the row's non-empty values. */
  private async updateLead(tx: TenantDb, ctx: Ctx, row: PreparedRow, lead: LeadRow): Promise<void> {
    const wid = ctx.workspaceId;
    const now = new Date();
    const data: Prisma.LeadUncheckedUpdateInput = {};
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    const set = (field: keyof LeadRow, to: unknown) => {
      if (JSON.stringify(lead[field]) === JSON.stringify(to)) return;
      (data as Record<string, unknown>)[field] = to;
      changes.push({ field, from: lead[field], to });
    };
    if (row.name !== lead.name) set('name', row.name);
    for (const [f, v] of Object.entries(row.text) as Array<[keyof PreparedRow['text'], string]>) set(f, v);
    if (row.valueInr !== null) set('valueInr', row.valueInr);
    const tags = normalizeTags([...lead.tags, ...row.tags, ...ctx.defaultTags]);
    if (tags.length !== lead.tags.length) set('tags', tags);
    tags.forEach((t) => ctx.allTags.add(t));
    if (Object.keys(row.customFields).length) set('customFields', { ...((lead.customFields as Record<string, unknown>) ?? {}), ...row.customFields });

    const acts: Prisma.ActivityUncheckedCreateInput[] = changes.map((c) => this.activities.data(wid, ctx.actor, lead.id, 'field_updated', c, now));
    if (row.ownerId && row.ownerId !== lead.ownerId) {
      data.ownerId = row.ownerId;
      acts.push(this.activities.data(wid, ctx.actor, lead.id, 'assigned', { fromUserId: lead.ownerId, toUserId: row.ownerId, rule: 'import' }, now));
    }
    if (row.stage && row.stage.id !== lead.stageId) {
      Object.assign(data, { stageId: row.stage.id, pipelineId: row.stage.pipelineId, position: await endOfColumn(tx, row.stage.id, lead.id), lastActivityAt: now, ...stageDates(row.stage.type, now) });
      ctx.lastPos.delete(row.stage.id);
      acts.push(this.activities.data(wid, ctx.actor, lead.id, 'stage_changed', { fromStageId: lead.stageId, toStageId: row.stage.id }, now));
    }
    if (!acts.length) return;
    const merged = { ...lead, ...(data as Partial<LeadRow>) };
    const scored = scoreLead(merged, now);
    await tx.lead.update({
      where: { id: lead.id },
      data: { ...data, score: scored.score, temperature: scored.temperature, scoreBreakdown: scored.breakdown, version: { increment: 1 } },
    });
    if (row.stage && row.stage.id !== lead.stageId) await syncDealsForStage(tx, wid, [merged], row.stage.type, now);
    await tx.activity.createMany({ data: acts });
  }
}
