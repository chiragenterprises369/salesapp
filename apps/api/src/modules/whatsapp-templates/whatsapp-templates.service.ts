import { Injectable, Logger } from '@nestjs/common';
import {
  WhatsAppTemplateButtonSchema,
  whatsappTemplateProblems,
  type Template,
  type TemplateStatus,
  type WhatsAppTemplate,
  type WhatsAppTemplateCreate,
  type WhatsAppTemplateSyncResult,
  type WhatsAppTemplateUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { Prisma, Template as TemplateRow } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { isUniqueViolation } from '../crm/lib/db.js';
import { IntegrationStore } from '../integrations/integration-store.js';
import { publishSafe, requestActor, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { liveTemplatesClient, MetaApiError, mockTemplatesClient, type MetaTemplatesClient, type TemplateSpec } from './meta-templates.client.js';

const ButtonsSchema = z.array(WhatsAppTemplateButtonSchema).catch([]);
const EDITABLE: readonly TemplateStatus[] = ['draft', 'rejected'];
const HEADER_FORMATS = ['none', 'text', 'image', 'video', 'document'] as const;

export function toWhatsAppTemplate(row: TemplateRow): WhatsAppTemplate {
  const format = (HEADER_FORMATS as readonly string[]).includes(row.headerFormat) ? (row.headerFormat as (typeof HEADER_FORMATS)[number]) : 'none';
  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category,
    status: row.status,
    header: { format, text: row.header, example: row.headerExample },
    body: row.body,
    bodyExamples: row.bodyExamples,
    variables: row.variables,
    footer: row.footer,
    buttons: ButtonsSchema.parse(row.buttons ?? []),
    providerTemplateId: row.providerTemplateId,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    editable: EDITABLE.includes(row.status),
    mode: row.mode,
    packKey: row.packKey,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toLegacyTemplate(row: TemplateRow): Template {
  return { id: row.id, channel: row.channel, name: row.name, language: row.language, category: row.category, status: row.status, body: row.body, variables: row.variables, header: row.header, footer: row.footer, updatedAt: row.updatedAt.toISOString() };
}

const specOf = (row: TemplateRow): TemplateSpec => {
  const t = toWhatsAppTemplate(row);
  return { name: t.name, language: t.language, category: t.category, header: t.header, body: t.body, bodyExamples: t.bodyExamples, footer: t.footer, buttons: t.buttons };
};

function assertMetaReady(t: Pick<WhatsAppTemplateCreate, 'body' | 'bodyExamples' | 'header' | 'buttons'>): void {
  const problems = whatsappTemplateProblems(t);
  if (problems.length) throw new AppException('TEMPLATE_INVALID', problems[0]!.message, { details: problems });
}

/**
 * WHATSAPP MESSAGE TEMPLATES (change #20): drafts in Vistar, submitted to Meta through the workspace's WhatsApp
 * Cloud integration (mock in development), statuses pulled back by "Sync now". Reuses the Template table
 * (channel whatsapp) that the inbox, bulk sends and workflows already read.
 */
@Injectable()
export class WhatsappTemplatesService {
  private readonly logger = new Logger(WhatsappTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly integrations: IntegrationStore,
  ) {}

  private db(auth: AuthContext) {
    return this.prisma.forTenant(auth.workspaceId);
  }

  private async actor(auth: AuthContext) {
    return (await requestActor(this.db(auth), auth)).event;
  }

  private async load(auth: AuthContext, id: string): Promise<TemplateRow> {
    const row = await this.db(auth).template.findFirst({ where: { id, channel: 'whatsapp' } });
    if (!row) throw new AppException('NOT_FOUND', 'Template not found');
    return row;
  }

  private async publish(workspaceId: string, row: TemplateRow, actor = SYSTEM_ACTOR): Promise<void> {
    await publishSafe(this.events, this.logger, 'whatsapp_template.updated', workspaceId, { template: toWhatsAppTemplate(row) }, { actor });
  }

  /** Live client of the connected integration, or the mock outside production. */
  private async provider(workspaceId: string): Promise<{ mode: 'live' | 'mock'; client: MetaTemplatesClient }> {
    const features = await this.integrations.features(workspaceId);
    if (!features.whatsapp) throw new AppException('FEATURE_DISABLED', 'WhatsApp is not included in your plan');
    const production = getEnv().NODE_ENV === 'production';
    const mock = () => ({
      mode: 'mock' as const,
      client: mockTemplatesClient(async () => {
        const rows = await this.prisma.forTenant(workspaceId).template.findMany({ where: { channel: 'whatsapp' } });
        return rows.map((r) => ({ name: r.name, language: r.language, status: r.status, providerTemplateId: r.providerTemplateId, spec: specOf(r) }));
      }),
    });
    const row = await this.integrations.row(workspaceId, 'whatsapp_cloud');
    if (row && row.status !== 'not_connected') {
      if (row.mode === 'mock') {
        if (production) throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Mock WhatsApp is not allowed in production: connect the live WhatsApp Cloud API');
        return mock();
      }
      const wabaId = (row.config as { wabaId?: string } | null)?.wabaId;
      const token = this.integrations.secretsOf(row).accessToken;
      if (!wabaId) throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Add the WhatsApp Business Account ID in Integrations > WhatsApp to submit templates');
      if (!token) throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Reconnect WhatsApp in Integrations: the access token is missing');
      return { mode: 'live', client: liveTemplatesClient(wabaId, token) };
    }
    if (!production) return mock();
    throw new AppException('INTEGRATION_NOT_CONNECTED', 'Connect WhatsApp in Integrations first');
  }

  private metaFailure(err: unknown): never {
    if (err instanceof AppException) throw err;
    if (err instanceof MetaApiError) throw new AppException(err.status === 400 ? 'TEMPLATE_INVALID' : 'INTEGRATION_PROVIDER_ERROR', err.message);
    throw new AppException('INTEGRATION_PROVIDER_ERROR', 'Meta could not be reached. Try again');
  }

  // ---------------------------------------------------------------- CRUD

  async list(auth: AuthContext, q: { status?: TemplateStatus; q?: string }): Promise<{ items: WhatsAppTemplate[] }> {
    const rows = await this.db(auth).template.findMany({
      where: { channel: 'whatsapp', ...(q.status ? { status: q.status } : {}), ...(q.q ? { name: { contains: q.q.toLowerCase() } } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    });
    return { items: rows.map(toWhatsAppTemplate) };
  }

  async get(auth: AuthContext, id: string): Promise<WhatsAppTemplate> {
    return toWhatsAppTemplate(await this.load(auth, id));
  }

  async create(auth: AuthContext, req: Request, body: WhatsAppTemplateCreate): Promise<WhatsAppTemplate> {
    assertMetaReady(body);
    let row: TemplateRow;
    try {
      row = await this.db(auth).template.create({
        data: {
          workspaceId: auth.workspaceId,
          channel: 'whatsapp',
          name: body.name,
          language: body.language,
          category: body.category,
          status: 'draft',
          body: body.body,
          bodyExamples: body.bodyExamples,
          variables: body.variables,
          header: body.header.format === 'text' ? body.header.text : null,
          headerFormat: body.header.format,
          headerExample: body.header.example,
          footer: body.footer,
          buttons: body.buttons as unknown as Prisma.InputJsonValue,
          createdById: auth.userId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppException('CONFLICT', 'A WhatsApp template with this name and language already exists');
      throw err;
    }
    await this.audit.record(auth, req, { action: 'whatsapp_template.create', entityType: 'template', entityId: row.id, diff: { name: row.name, language: row.language, category: row.category } });
    await this.publish(auth.workspaceId, row, await this.actor(auth));
    return toWhatsAppTemplate(row);
  }

  async update(auth: AuthContext, req: Request, id: string, body: WhatsAppTemplateUpdate): Promise<WhatsAppTemplate> {
    const row = await this.load(auth, id);
    if (!EDITABLE.includes(row.status)) throw new AppException('TEMPLATE_STATE_INVALID', `A ${row.status} template cannot be edited. Create a new version instead`);
    const current = toWhatsAppTemplate(row);
    const next = {
      body: body.body ?? current.body,
      bodyExamples: body.bodyExamples ?? current.bodyExamples,
      header: body.header ?? current.header,
      buttons: body.buttons ?? current.buttons,
    };
    assertMetaReady(next);
    const updated = await this.db(auth).template.update({
      where: { id },
      data: {
        ...(body.category ? { category: body.category } : {}),
        ...(body.variables ? { variables: body.variables } : {}),
        ...(body.footer !== undefined ? { footer: body.footer } : {}),
        body: next.body,
        bodyExamples: next.bodyExamples,
        header: next.header.format === 'text' ? next.header.text : null,
        headerFormat: next.header.format,
        headerExample: next.header.example,
        buttons: next.buttons as unknown as Prisma.InputJsonValue,
        // An edited rejected template is a draft again (submit it for a new review).
        status: 'draft',
        rejectionReason: null,
      },
    });
    await this.audit.record(auth, req, { action: 'whatsapp_template.update', entityType: 'template', entityId: id, diff: { fields: Object.keys(body) } });
    await this.publish(auth.workspaceId, updated, await this.actor(auth));
    return toWhatsAppTemplate(updated);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const row = await this.load(auth, id);
    if (row.providerTemplateId && row.mode === 'live') {
      try {
        const { client } = await this.provider(auth.workspaceId);
        await client.remove(row.name, row.providerTemplateId);
      } catch (err) {
        this.metaFailure(err);
      }
    }
    await this.db(auth).template.deleteMany({ where: { id } });
    await this.audit.record(auth, req, { action: 'whatsapp_template.delete', entityType: 'template', entityId: id, diff: { name: row.name, language: row.language, status: row.status } });
    await publishSafe(this.events, this.logger, 'whatsapp_template.deleted', auth.workspaceId, { templateId: id }, { actor: await this.actor(auth) });
    return { ok: true };
  }

  // ---------------------------------------------------------------- Meta

  async submit(auth: AuthContext, req: Request, id: string): Promise<WhatsAppTemplate> {
    const row = await this.load(auth, id);
    if (!EDITABLE.includes(row.status)) throw new AppException('TEMPLATE_STATE_INVALID', `This template is already ${row.status}`);
    const spec = specOf(row);
    assertMetaReady(spec);
    const { mode, client } = await this.provider(auth.workspaceId);
    let created: { id: string; status: TemplateStatus };
    try {
      created = await client.create(spec);
    } catch (err) {
      this.metaFailure(err);
    }
    const now = new Date();
    const updated = await this.db(auth).template.update({ where: { id }, data: { status: created.status, providerTemplateId: created.id, submittedAt: now, lastSyncedAt: now, mode, rejectionReason: null } });
    await this.audit.record(auth, req, { action: 'whatsapp_template.submit', entityType: 'template', entityId: id, diff: { name: row.name, mode } });
    await this.publish(auth.workspaceId, updated, await this.actor(auth));
    return toWhatsAppTemplate(updated);
  }

  async sync(auth: AuthContext, req: Request | null): Promise<WhatsAppTemplateSyncResult & { rows: TemplateRow[] }> {
    const { mode, client } = await this.provider(auth.workspaceId);
    let remote: Awaited<ReturnType<MetaTemplatesClient['list']>>;
    try {
      remote = await client.list();
    } catch (err) {
      this.metaFailure(err);
    }
    const db = this.db(auth);
    const local = await db.template.findMany({ where: { channel: 'whatsapp' } });
    const byProvider = new Map(local.filter((r) => r.providerTemplateId).map((r) => [r.providerTemplateId!, r]));
    const byName = new Map(local.map((r) => [`${r.name}|${r.language}`, r]));
    const now = new Date();
    let created = 0;
    let updated = 0;
    const changed: TemplateRow[] = [];
    for (const t of remote) {
      const existing = byProvider.get(t.id) ?? byName.get(`${t.name}|${t.language}`);
      if (existing) {
        const statusChanged = existing.status !== t.status || existing.providerTemplateId !== t.id;
        const reason = t.status === 'rejected' ? (t.rejectionReason ?? existing.rejectionReason) : null;
        const row = await db.template.update({ where: { id: existing.id }, data: { status: t.status, category: t.category, providerTemplateId: t.id, rejectionReason: reason, lastSyncedAt: now, mode } });
        if (statusChanged || reason !== existing.rejectionReason) {
          updated++;
          changed.push(row);
        }
      } else {
        const s = t.spec;
        try {
          const row = await db.template.create({
            data: {
              workspaceId: auth.workspaceId,
              channel: 'whatsapp',
              name: t.name,
              language: t.language,
              category: t.category,
              status: t.status,
              body: s.body || '(no body)',
              bodyExamples: s.bodyExamples,
              header: s.header.format === 'text' ? s.header.text : null,
              headerFormat: s.header.format,
              headerExample: s.header.example,
              footer: s.footer,
              buttons: s.buttons as unknown as Prisma.InputJsonValue,
              providerTemplateId: t.id,
              rejectionReason: t.rejectionReason,
              lastSyncedAt: now,
              mode,
            },
          });
          created++;
          changed.push(row);
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }
    }
    if (req) await this.audit.record(auth, req, { action: 'whatsapp_template.sync', entityType: 'template', entityId: null, diff: { created, updated, mode } });
    const actor = await this.actor(auth);
    for (const row of changed.slice(0, 100)) await this.publish(auth.workspaceId, row, actor);
    const rows = await db.template.findMany({ where: { channel: 'whatsapp' }, orderBy: [{ updatedAt: 'desc' }], take: 500 });
    return { items: rows.map(toWhatsAppTemplate), created, updated, mode, syncedAt: now.toISOString(), rows };
  }

  /** POST /templates/sync (inbox, phase 5 contract): same sync, legacy Template DTOs. */
  async legacySync(auth: AuthContext, req: Request): Promise<{ items: Template[] }> {
    const r = await this.sync(auth, req);
    return { items: r.rows.map(toLegacyTemplate) };
  }
}
