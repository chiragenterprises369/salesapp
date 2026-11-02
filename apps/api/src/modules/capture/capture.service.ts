import { Injectable, Logger } from '@nestjs/common';
import {
  CAPTURE_HONEYPOT_FIELD,
  captureFormHostedPath,
  CaptureFormSettingsSchema,
  CaptureFieldSchema,
  normalizeIndianPhone,
  UtmSchema,
  type CaptureField,
  type CaptureForm,
  type CaptureFormCreate,
  type CaptureFormSettings,
  type CaptureFormUpdate,
  type CaptureSubmission,
  type CursorPaginationQuery,
  type CustomFieldValue,
  type FieldError,
  type LeadCreate,
  type Page,
  type PublicCaptureForm,
  type PublicCaptureSubmit,
  type PublicCaptureSubmitResult,
} from '@vistar/shared';
import type { Request } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { iso } from '../../common/mappers/user.mapper.js';
import { getEnv } from '../../config/env.js';
import type { CaptureForm as FormRow, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { isUniqueViolation } from '../crm/lib/db.js';
import { pageArgs, pageOut } from '../crm/lib/paging.js';
import { requestActor, type RequestActor } from '../leads/lib/context.js';
import { LeadsService } from '../leads/leads.service.js';
import { ActivityService } from '../leads/activity.service.js';
import { BrandingService } from '../workspace/branding.service.js';
import { CaptureRateLimiter } from './capture-rate-limit.js';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const newKey = (): string => [...randomBytes(12)].map((b) => KEY_ALPHABET[b % KEY_ALPHABET.length]).join('');

const closed = () => new AppException('CAPTURE_FORM_CLOSED', 'This form is not accepting responses');
const invalid = (details: FieldError[]) => new AppException('VALIDATION_FAILED', 'Please check the highlighted fields', { details, status: 422 });

const parseFields = (j: unknown): CaptureField[] => {
  const r = z.array(CaptureFieldSchema).safeParse(j);
  return r.success ? r.data : [];
};
const parseSettings = (j: unknown): CaptureFormSettings => {
  const r = CaptureFormSettingsSchema.safeParse(j ?? {});
  return r.success ? r.data : CaptureFormSettingsSchema.parse({});
};

/** System caller for public submissions: may create and assign leads, sees everything (scope all). */
function systemAuth(workspaceId: string): AuthContext {
  return { audience: 'workspace', userId: null, workspaceId, roleId: null, kind: null, dataScope: 'all', permissions: ['leads.create', 'leads.assign', 'leads.read'], sessionId: null, via: 'jwt', apiKeyId: null, impersonation: null };
}

type Answer = string | number | boolean | string[];

/**
 * Lead capture forms (schemas/capture.ts): builder CRUD for company admins, the public form for the hosted
 * page, and submissions that become routed leads (rate limit, honeypot, consent, idempotency, dedupe).
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);
  private readonly env = getEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
    private readonly activities: ActivityService,
    private readonly branding: BrandingService,
    private readonly limiter: CaptureRateLimiter,
  ) {}

  // ---------------------------------------------------------------- admin

  toDto(f: FormRow): CaptureForm {
    const web = this.env.WEB_ORIGIN.replace(/\/$/, '');
    const hostedUrl = `${web}${captureFormHostedPath(f.key)}`;
    const name = f.name.replace(/["<>&]/g, '');
    const embedHtml =
      `<iframe src="${hostedUrl}?embed=1" title="${name}" style="width:100%;min-height:560px;border:0" loading="lazy"></iframe>` +
      `<script>window.addEventListener("message",function(e){if(e.origin!=="${web}"||!e.data||e.data.type!=="vistar-form-height")return;` +
      `document.querySelectorAll('iframe[src^="${hostedUrl}"]').forEach(function(f){f.style.height=e.data.height+"px"});});</script>`;
    return {
      id: f.id,
      key: f.key,
      name: f.name,
      status: f.status === 'paused' ? 'paused' : 'active',
      fields: parseFields(f.fields),
      settings: parseSettings(f.settings),
      submissionCount: f.submissionCount,
      lastSubmissionAt: iso(f.lastSubmissionAt),
      hostedUrl,
      embedHtml,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }

  private async checkSettings(workspaceId: string, s: Partial<CaptureFormSettings>): Promise<void> {
    const db = this.prisma.forTenant(workspaceId);
    if (s.ownerId && (await db.user.count({ where: { id: s.ownerId, isActive: true, deletedAt: null } })) !== 1) throw notFound('User');
    if (s.stageId && (await db.stage.count({ where: { id: s.stageId, archivedAt: null, pipeline: { entity: 'lead' } } })) !== 1) throw notFound('Stage');
  }

  async list(auth: AuthContext): Promise<{ items: CaptureForm[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).captureForm.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return { items: rows.map((r) => this.toDto(r)) };
  }

  private async load(auth: AuthContext, id: string): Promise<FormRow> {
    const row = await this.prisma.forTenant(auth.workspaceId).captureForm.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('Form');
    return row;
  }

  async get(auth: AuthContext, id: string): Promise<CaptureForm> {
    return this.toDto(await this.load(auth, id));
  }

  async create(auth: AuthContext, req: Request, body: CaptureFormCreate): Promise<CaptureForm> {
    await this.checkSettings(auth.workspaceId, body.settings);
    const db = this.prisma.forTenant(auth.workspaceId);
    let row: FormRow | null = null;
    for (let i = 0; i < 3 && !row; i++) {
      try {
        row = await db.captureForm.create({
          data: { workspaceId: auth.workspaceId, key: newKey(), name: body.name, status: body.status, fields: body.fields as unknown as Prisma.InputJsonArray, settings: body.settings as unknown as Prisma.InputJsonObject, createdById: auth.userId },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    if (!row) throw new AppException('INTERNAL_ERROR', 'Could not create the form. Try again.');
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'capture_form.create', entityType: 'capture_form', entityId: row.id, diff: { name: row.name } }, actor.summary?.name);
    return this.toDto(row);
  }

  async update(auth: AuthContext, id: string, body: CaptureFormUpdate): Promise<CaptureForm> {
    const current = await this.load(auth, id);
    const settings = body.settings ? { ...parseSettings(current.settings), ...body.settings } : null;
    if (settings) await this.checkSettings(auth.workspaceId, body.settings!);
    const row = await this.prisma.forTenant(auth.workspaceId).captureForm.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.fields !== undefined ? { fields: body.fields as unknown as Prisma.InputJsonArray } : {}),
        ...(settings ? { settings: CaptureFormSettingsSchema.parse(settings) as unknown as Prisma.InputJsonObject } : {}),
      },
    });
    return this.toDto(row);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const row = await this.load(auth, id);
    const db = this.prisma.forTenant(auth.workspaceId);
    await db.captureForm.updateMany({ where: { id }, data: { deletedAt: new Date(), status: 'paused' } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'capture_form.delete', entityType: 'capture_form', entityId: id, diff: { name: row.name, submissions: row.submissionCount } }, actor.summary?.name);
    return { ok: true };
  }

  async submissions(auth: AuthContext, id: string, q: CursorPaginationQuery): Promise<Page<CaptureSubmission>> {
    await this.load(auth, id);
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const rows = await this.prisma.forTenant(auth.workspaceId).captureSubmission.findMany({ where: { formId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take });
    const page = pageOut(rows, skip, q.limit);
    return {
      items: page.rows.map((s) => ({
        id: s.id,
        formId: s.formId,
        leadId: s.leadId,
        duplicateOfLeadId: s.duplicateOfLeadId,
        values: (s.values ?? {}) as Record<string, unknown>,
        utm: UtmSchema.catch({}).parse(s.utm),
        consent: s.consent,
        pageUrl: s.pageUrl,
        referrer: s.referrer,
        createdAt: s.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ---------------------------------------------------------------- public

  /** Root client on purpose: the public key decides the workspace; everything after goes through forTenant(). */
  private async publicForm(key: string): Promise<FormRow> {
    const row = await this.prisma.captureForm.findUnique({ where: { key } });
    if (!row || row.deletedAt || row.status !== 'active') throw closed();
    const ws = await this.prisma.workspace.findUnique({ where: { id: row.workspaceId }, select: { status: true, deletedAt: true } });
    if (!ws || ws.deletedAt || ws.status === 'suspended' || ws.status === 'deleted') throw closed();
    return row;
  }

  async getPublic(key: string): Promise<PublicCaptureForm> {
    const row = await this.publicForm(key);
    const db = this.prisma.forTenant(row.workspaceId);
    const s = parseSettings(row.settings);
    const [branding, ws] = await Promise.all([this.branding.get(db, row.workspaceId), db.workspace.findFirst({ select: { name: true } })]);
    return {
      key: row.key,
      name: row.name,
      fields: parseFields(row.fields).map(({ mapTo: _m, ...f }) => f),
      submitLabel: s.submitLabel,
      successMessage: s.successMessage,
      consent: s.consent,
      layout: s.layout,
      showLogo: s.showLogo,
      honeypotField: CAPTURE_HONEYPOT_FIELD,
      workspaceName: branding.displayName ?? ws?.name ?? 'Vistar',
      branding,
    };
  }

  /** Validate one answer against its field; returns the typed value or an error message. */
  private answer(f: CaptureField, raw: unknown): { value: Answer | null; error?: string } {
    const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (f.type === 'hidden') {
      const v = empty ? f.defaultValue : String(raw).slice(0, 200);
      return { value: v ?? null };
    }
    if (empty) return f.required ? { value: null, error: `${f.label} is required` } : { value: null };
    switch (f.type) {
      case 'email': {
        const r = z.email().safeParse(String(raw).trim().toLowerCase());
        return r.success ? { value: r.data } : { value: null, error: 'Enter a valid email address' };
      }
      case 'phone': {
        const p = normalizeIndianPhone(String(raw));
        return p ? { value: p } : { value: null, error: 'Enter a valid mobile number' };
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
        return Number.isFinite(n) ? { value: n } : { value: null, error: 'Enter a number' };
      }
      case 'checkbox':
        return { value: raw === true || raw === 'true' || raw === 'on' || raw === 1 };
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(String(raw)) ? { value: String(raw) } : { value: null, error: 'Enter a date' };
      case 'select': {
        const v = String(raw);
        return f.options.some((o) => o.value === v) ? { value: v } : { value: null, error: 'Pick one of the options' };
      }
      case 'multi_select': {
        const list = (Array.isArray(raw) ? raw : [raw]).map(String);
        return list.every((v) => f.options.some((o) => o.value === v)) ? { value: list } : { value: null, error: 'Pick from the options' };
      }
      case 'textarea':
        return { value: String(raw).slice(0, 4000) };
      default:
        return { value: String(raw).trim().slice(0, 300) };
    }
  }

  async submit(key: string, body: PublicCaptureSubmit, req: Request): Promise<PublicCaptureSubmitResult> {
    const form = await this.publicForm(key);
    const wid = form.workspaceId;
    const settings = parseSettings(form.settings);
    const ok: PublicCaptureSubmitResult = { ok: true, message: settings.successMessage, redirectUrl: settings.redirectUrl };
    const ipHash = createHash('sha256').update(`${req.ip ?? 'unknown'}|${this.env.ENCRYPTION_KEY}`).digest('hex').slice(0, 32);
    if (!(await this.limiter.allow(form.id, ipHash))) throw new AppException('RATE_LIMITED', 'Too many submissions. Wait a minute and try again');
    // Bots fill the hidden honeypot: answer like a success, store nothing.
    if (body.hp && body.hp.trim()) return ok;
    const db = this.prisma.forTenant(wid);
    if (body.clientSubmissionId && (await db.captureSubmission.count({ where: { formId: form.id, clientSubmissionId: body.clientSubmissionId } }))) return ok;

    // answers
    const fields = parseFields(form.fields);
    const errors: FieldError[] = [];
    const answers = new Map<string, Answer | null>();
    for (const f of fields) {
      const a = this.answer(f, body.values[f.id]);
      if (a.error) errors.push({ path: `values.${f.id}`, message: a.error });
      answers.set(f.id, a.value);
    }
    if (settings.consent.enabled && settings.consent.required && body.consent !== true) {
      throw new AppException('CONSENT_MISSING', 'Please tick the consent box to continue', { details: [{ path: 'consent', message: 'Required' }] });
    }
    if (errors.length) throw invalid(errors);

    // mapping to the lead
    const lead: Record<string, unknown> = {};
    const custom: Record<string, CustomFieldValue> = {};
    const extra: string[] = [];
    let tags: string[] = [...settings.defaultTags];
    for (const f of fields) {
      const v = answers.get(f.id);
      if (v === null || v === undefined) continue;
      const target = f.mapTo;
      if (!target) {
        if (f.type !== 'hidden') extra.push(`${f.label}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
        continue;
      }
      if (target.startsWith('custom.')) custom[target.slice(7)] = v as CustomFieldValue;
      else if (target === 'tags') tags = [...tags, ...(Array.isArray(v) ? v : [String(v)])];
      else if (target === 'valueInr') lead.valueInr = Math.max(0, Math.min(2_000_000_000, Math.round(Number(v)) || 0));
      else lead[target] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    const requirement = [lead.requirement as string | undefined, ...extra].filter(Boolean).join('\n').slice(0, 4000) || undefined;
    const name = String(lead.name ?? '').trim() || 'Website visitor';
    const phone = (lead.phone as string | undefined) ?? undefined;
    const email = (lead.email as string | undefined)?.toLowerCase();
    const utm = UtmSchema.parse(body.utm ?? {});
    const values = Object.fromEntries([...answers.entries()].filter(([, v]) => v !== null));
    const userAgent = (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;
    const submissionId = randomUUID();
    const actor: RequestActor = { event: { type: 'integration', id: form.id, name: form.name }, summary: null, activityActorType: 'system', activityActorId: null };

    // dedupe: an open lead with the same phone or email gets a note instead of a second lead
    let duplicateOf: string | null = null;
    if (settings.dedupe === 'phone_or_email' && (phone || email)) {
      const match = await db.lead.findFirst({
        where: { deletedAt: null, stage: { type: 'open' }, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])] },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      duplicateOf = match?.id ?? null;
    }

    let leadId: string | null = null;
    if (duplicateOf) {
      const now = new Date();
      const note = [`Submitted the form "${form.name}" again.`, requirement, utm.campaign ? `Campaign: ${utm.campaign}` : null].filter(Boolean).join('\n');
      const row = await db.activity.create({ data: this.activities.data(wid, actor, duplicateOf, 'note', { body: note.slice(0, 10_000) }, now) });
      await db.lead.updateMany({ where: { id: duplicateOf }, data: { lastActivityAt: now, version: { increment: 1 } } });
      await this.activities.publishCreated(db, wid, [row], actor);
    } else {
      const input: LeadCreate = {
        name,
        source: 'website',
        sourceRef: `form:${submissionId}`,
        valueInr: (lead.valueInr as number | undefined) ?? 0,
        tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 30),
        customFields: custom,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
        ...(lead.companyName ? { companyName: String(lead.companyName).slice(0, 160) } : {}),
        ...(lead.city ? { city: String(lead.city).slice(0, 80) } : {}),
        ...(lead.state ? { state: String(lead.state).slice(0, 80) } : {}),
        ...(lead.productInterest ? { productInterest: String(lead.productInterest).slice(0, 200) } : {}),
        ...(requirement ? { requirement } : {}),
        ...(settings.ownerId ? { ownerId: settings.ownerId } : {}),
        ...(settings.stageId ? { stageId: settings.stageId } : {}),
      };
      try {
        const created = await this.leads.create(systemAuth(wid), input, { captureFormId: form.id, formName: form.name, utm, actor, notify: settings.notifyOwner });
        leadId = created.id;
      } catch (err) {
        if (err instanceof AppException && (err.code === 'VALIDATION_FAILED' || err.code === 'FIELD_VALUE_NOT_UNIQUE')) throw invalid(err.details ?? [{ path: 'values', message: err.message }]);
        throw err;
      }
      if (body.consent === true) {
        const contact = await db.lead.findFirst({ where: { id: leadId }, select: { contactId: true } });
        if (contact?.contactId) {
          await db.consentRecord.create({ data: { workspaceId: wid, contactId: contact.contactId, channel: 'whatsapp', status: 'opted_in', source: 'web_form', evidence: { formId: form.id, text: settings.consent.text, pageUrl: body.pageUrl ?? null, at: new Date().toISOString() } } });
          await db.contact.updateMany({ where: { id: contact.contactId }, data: { whatsappOptIn: 'opted_in' } });
        }
      }
    }

    try {
      await db.captureSubmission.create({
        data: {
          id: submissionId,
          workspaceId: wid,
          formId: form.id,
          leadId,
          duplicateOfLeadId: duplicateOf,
          values: values as Prisma.InputJsonObject,
          utm: utm as Prisma.InputJsonObject,
          consent: body.consent ?? null,
          pageUrl: body.pageUrl?.slice(0, 2000) ?? null,
          referrer: body.referrer?.slice(0, 2000) ?? null,
          ipHash,
          userAgent,
          clientSubmissionId: body.clientSubmissionId ?? null,
        },
      });
      await db.captureForm.updateMany({ where: { id: form.id }, data: { submissionCount: { increment: 1 }, lastSubmissionAt: new Date() } });
    } catch (err) {
      // a parallel retry with the same clientSubmissionId already stored it
      if (!isUniqueViolation(err)) throw err;
    }
    return ok;
  }
}
