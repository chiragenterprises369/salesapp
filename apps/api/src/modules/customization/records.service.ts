import { Injectable, Logger } from '@nestjs/common';
import {
  fieldAccessFor,
  objectTarget,
  type CustomFieldValues,
  type CustomRecord,
  type CustomRecordCreate,
  type CustomRecordListQuery,
  type CustomRecordUpdate,
  type FieldDefinition,
  type Page,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, forbidden, notFound } from '../../common/errors/app-exception.js';
import type { CustomObject as ObjectRow, CustomRecord as RecordRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { decodeCursor, encodeCursor, invalidCursor, isUuid } from '../leads/lib/cursor.js';
import { applyPatch, changedKeys, loadFieldDefs, publicValues, roleKeyOf, validateValues, visibleFor } from './custom-values.js';
import { parseValues } from './field.mapper.js';
import { lockUnique, recordUniqueErrors, uniqueDefsIn } from './unique.js';

type Sort = CustomRecordListQuery['sort'];
type Dir = CustomRecordListQuery['dir'];
interface RecordCursor extends Record<string, unknown> {
  s: Sort;
  d: Dir;
  v: string;
  id: string;
}
const isRecordCursor = (c: Record<string, unknown>): c is RecordCursor =>
  (c.s === 'createdAt' || c.s === 'updatedAt' || c.s === 'title') && (c.d === 'asc' || c.d === 'desc') && typeof c.v === 'string' && isUuid(c.id);

const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this record. Reload to see the latest version.');
const TITLE_MAX = 500;

interface ObjectCtx {
  obj: ObjectRow;
  defs: FieldDefinition[];
  target: string;
}

/** Records of custom objects (/objects/{key}/records). Data scope applies through ownerId. */
@Injectable()
export class RecordsService {
  private readonly logger = new Logger(RecordsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** Active object + all its field definitions (archived included, for validation and reads). */
  private async object(db: TenantDb, key: string): Promise<ObjectCtx> {
    const obj = await db.customObject.findFirst({ where: { key, archivedAt: null } });
    if (!obj) throw notFound('Custom object');
    const target = objectTarget(key);
    return { obj, defs: await loadFieldDefs(db, target), target };
  }

  /** Record as the caller sees it: hidden values stripped, title blank when the title field is hidden. */
  private toDto(ctx: ObjectCtx, r: RecordRow, roleKey: string | null, broadcast = false): CustomRecord {
    const raw = parseValues(r.values);
    const values = broadcast ? publicValues(ctx.defs, raw) : visibleFor(ctx.defs, raw, roleKey);
    const titleDef = ctx.defs.find((d) => d.key === ctx.obj.primaryFieldKey);
    const titleHidden = titleDef ? (broadcast ? titleDef.access.hiddenFor.length > 0 : fieldAccessFor(titleDef, roleKey) === 'hidden') : false;
    return {
      id: r.id,
      objectKey: ctx.obj.key,
      title: titleHidden ? '' : r.title,
      values,
      ownerId: r.ownerId,
      version: r.version,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private titleOf(ctx: ObjectCtx, values: CustomFieldValues): string {
    const v = values[ctx.obj.primaryFieldKey];
    return typeof v === 'string' ? v.slice(0, TITLE_MAX) : '';
  }

  private async loadVisible(db: TenantDb, auth: AuthContext, ctx: ObjectCtx, id: string): Promise<RecordRow> {
    const row = await db.customRecord.findFirst({ where: { id, objectId: ctx.obj.id, deletedAt: null } });
    if (!row || !(await this.scope.canSee(auth, row.ownerId))) throw notFound('Record');
    return row;
  }

  /** Owners must be active members the caller can see (so the record stays in the caller's scope). */
  private async assertOwner(db: TenantDb, auth: AuthContext, ownerId: string | null): Promise<void> {
    if (ownerId === null) {
      if ((await this.scope.visibleUserIds(auth)) !== null) throw forbidden('Records need an owner. Assign it to yourself or your team');
      return;
    }
    const active = await db.user.count({ where: { id: ownerId, isActive: true, deletedAt: null } });
    if (active !== 1) throw notFound('User');
    if (!(await this.scope.canSee(auth, ownerId))) throw forbidden('You can only assign records to yourself or your team');
  }

  // ------------------------------------------------------------------ list / get

  async list(auth: AuthContext, key: string, q: CustomRecordListQuery): Promise<Page<CustomRecord> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const ctx = await this.object(db, key);
    const roleKey = await roleKeyOf(db, auth);
    const and: Prisma.CustomRecordWhereInput[] = [{ objectId: ctx.obj.id, deletedAt: null }];
    const scoped = await this.scope.where(auth, 'ownerId');
    if (Object.keys(scoped).length) and.push(scoped as Prisma.CustomRecordWhereInput);
    if (q.q) and.push({ title: { contains: q.q, mode: 'insensitive' } });
    if (q.ownerId === 'unassigned') and.push({ ownerId: null });
    else if (q.ownerId === 'me') and.push(auth.userId ? { ownerId: auth.userId } : { id: { in: [] } });
    else if (q.ownerId) and.push({ ownerId: q.ownerId });
    if (q.related) {
      const [fieldKey, relatedId] = q.related.split(':') as [string, string];
      const def = ctx.defs.find((d) => d.key === fieldKey && d.type === 'relation' && !d.archivedAt);
      if (!def || fieldAccessFor(def, roleKey) === 'hidden') {
        throw new AppException('VALIDATION_FAILED', 'Filter by a relation field of this object', { details: [{ path: 'related', message: 'Unknown relation field' }] });
      }
      const multiple = (def.config as { multiple?: boolean }).multiple === true;
      and.push({ values: multiple ? { path: [fieldKey], array_contains: [relatedId] } : { path: [fieldKey], equals: relatedId } });
    }
    const base: Prisma.CustomRecordWhereInput = { AND: and };
    const after = this.cursorWhere(q.cursor, q.sort, q.dir);
    const [found, total] = await Promise.all([
      db.customRecord.findMany({ where: after ? { AND: [base, after] } : base, orderBy: [{ [q.sort]: q.dir }, { id: q.dir }], take: q.limit + 1 }),
      db.customRecord.count({ where: base }),
    ]);
    const rows = found.slice(0, q.limit);
    const last = rows.at(-1);
    const nextCursor =
      found.length > q.limit && last ? encodeCursor({ s: q.sort, d: q.dir, v: q.sort === 'title' ? last.title : last[q.sort].toISOString(), id: last.id }) : null;
    return { items: rows.map((r) => this.toDto(ctx, r, roleKey)), nextCursor, total };
  }

  private cursorWhere(cursor: string | undefined, sort: Sort, dir: Dir): Prisma.CustomRecordWhereInput | null {
    if (!cursor) return null;
    const c = decodeCursor(cursor, isRecordCursor);
    if (c.s !== sort || c.d !== dir) throw invalidCursor();
    const op = dir === 'asc' ? 'gt' : 'lt';
    const value = sort === 'title' ? c.v : new Date(c.v);
    if (value instanceof Date && Number.isNaN(value.getTime())) throw invalidCursor();
    return { OR: [{ [sort]: { [op]: value } }, { [sort]: value, id: { [op]: c.id } }] } as Prisma.CustomRecordWhereInput;
  }

  async get(auth: AuthContext, key: string, id: string): Promise<CustomRecord> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const ctx = await this.object(db, key);
    const row = await this.loadVisible(db, auth, ctx, id);
    return this.toDto(ctx, row, await roleKeyOf(db, auth));
  }

  // ------------------------------------------------------------------ writes

  async create(auth: AuthContext, key: string, body: CustomRecordCreate): Promise<CustomRecord> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ctx = await this.object(db, key);
    const roleKey = await roleKeyOf(db, auth);
    const parsed = await validateValues(db, auth, ctx.defs, body.values, { mode: 'create', pathPrefix: 'values', roleKey });
    const values = applyPatch({}, parsed);
    const ownerId = body.ownerId ?? auth.userId;
    await this.assertOwner(db, auth, ownerId);

    const unique = uniqueDefsIn(ctx.defs, values);
    const row = await db.$transaction(async (tx) => {
      if (unique.length) {
        await lockUnique(tx, `record-unique:${ctx.obj.id}`);
        const errors = await recordUniqueErrors(tx, wid, ctx.obj.id, ctx.defs, values);
        if (errors.length) throw new AppException('FIELD_VALUE_NOT_UNIQUE', 'Another record already uses one of these values', { details: errors });
      }
      return tx.customRecord.create({
        data: { workspaceId: wid, objectId: ctx.obj.id, title: this.titleOf(ctx, values), values: values as Prisma.InputJsonObject, ownerId, createdById: auth.userId },
      });
    });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'record.created', wid, { record: this.toDto(ctx, row, null, true) }, { actor: actor.event });
    return this.toDto(ctx, row, roleKey);
  }

  async update(auth: AuthContext, key: string, id: string, body: CustomRecordUpdate): Promise<CustomRecord> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ctx = await this.object(db, key);
    const current = await this.loadVisible(db, auth, ctx, id);
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw versionConflict();
    const roleKey = await roleKeyOf(db, auth);

    const before = parseValues(current.values);
    const patch = body.values ? await validateValues(db, auth, ctx.defs, body.values, { mode: 'update', pathPrefix: 'values', roleKey }) : {};
    const after = applyPatch(before, patch);
    const changed = changedKeys(before, after);
    const ownerChanged = body.ownerId !== undefined && body.ownerId !== current.ownerId;
    if (ownerChanged) await this.assertOwner(db, auth, body.ownerId ?? null);
    if (!changed.length && !ownerChanged) return this.toDto(ctx, current, roleKey);

    const unique = uniqueDefsIn(ctx.defs, after, changed);
    const row = await db.$transaction(async (tx) => {
      if (unique.length) {
        await lockUnique(tx, `record-unique:${ctx.obj.id}`);
        const errors = await recordUniqueErrors(tx, wid, ctx.obj.id, ctx.defs, after, { excludeId: id, keys: changed });
        if (errors.length) throw new AppException('FIELD_VALUE_NOT_UNIQUE', 'Another record already uses one of these values', { details: errors });
      }
      const res = await tx.customRecord.updateMany({
        where: { id, version: current.version, deletedAt: null },
        data: {
          ...(changed.length ? { values: after as Prisma.InputJsonObject, title: this.titleOf(ctx, after) } : {}),
          ...(ownerChanged ? { ownerId: body.ownerId ?? null } : {}),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      return tx.customRecord.findUniqueOrThrow({ where: { id } });
    });
    const actor = await requestActor(db, auth);
    const restricted = new Set(ctx.defs.filter((d) => d.access.hiddenFor.length > 0).map((d) => d.key));
    await publishSafe(
      this.events,
      this.logger,
      'record.updated',
      wid,
      { record: this.toDto(ctx, row, null, true), changed: [...changed.filter((k) => !restricted.has(k)), ...(ownerChanged ? ['ownerId'] : [])] },
      { actor: actor.event },
    );
    return this.toDto(ctx, row, roleKey);
  }

  async remove(auth: AuthContext, req: Request, key: string, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ctx = await this.object(db, key);
    const row = await this.loadVisible(db, auth, ctx, id);
    const res = await db.customRecord.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    if (res.count !== 1) throw notFound('Record');
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'record.delete', entityType: 'custom_record', entityId: id, diff: { objectKey: key, ownerId: row.ownerId } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'record.deleted', wid, { objectKey: key, recordIds: [id] }, { actor: actor.event });
    return { ok: true };
  }
}
