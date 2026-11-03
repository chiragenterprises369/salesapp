import { Injectable } from '@nestjs/common';
import { LeadCreateSchema, type LeadCreate, type LeadSource, type LeadUpdate, type MappedLead, type WebhookMatchKey } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { LeadsService } from '../leads/leads.service.js';
import type { RequestActor, TenantDb } from '../leads/lib/context.js';

/** Auth context for machine intake (webhooks, IndiaMART, WhatsApp): scope all, lead create/update/assign only. */
export function intakeAuth(workspaceId: string): AuthContext {
  return {
    audience: 'workspace',
    userId: null,
    workspaceId,
    roleId: null,
    kind: null,
    dataScope: 'all',
    permissions: ['leads.create', 'leads.update', 'leads.assign', 'leads.read'],
    sessionId: null,
    via: 'jwt',
    apiKeyId: null,
    impersonation: null,
  };
}

/** Event / activity actor for an integration (the source is named in the timeline, not a user). */
export const integrationActor = (id: string | null, name: string): RequestActor => ({
  event: { type: 'integration', id, name },
  summary: null,
  activityActorType: 'system',
  activityActorId: null,
});

export interface IntakeResult {
  leadId: string | null;
  created: boolean;
  updated: boolean;
  duplicate: boolean;
}

/**
 * Turns mapped payloads into leads through LeadsService (lead routing, custom field validation, contact linking,
 * events and notifications all apply). Duplicate source references (IndiaMART UNIQUE_QUERY_ID, sourceRef from a
 * mapping) answer `duplicate: true` with the existing lead.
 */
@Injectable()
export class LeadIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  /** Mapped values -> LeadCreate (owner by e-mail, stage by name; unknown ones are ignored so routing applies). */
  async toCreate(db: TenantDb, m: MappedLead, opts: { source: LeadSource; tags?: readonly string[] }): Promise<LeadCreate> {
    const name = m.name?.trim() || m.phone || m.email;
    if (!name) throw new AppException('VALIDATION_FAILED', 'The payload has no name, phone or e-mail for the lead', { details: [{ path: 'name', message: 'No value for the lead name' }] });
    let ownerId: string | undefined;
    if (m.ownerEmail) {
      const owner = await db.user.findFirst({ where: { email: { equals: m.ownerEmail, mode: 'insensitive' }, isActive: true, deletedAt: null }, select: { id: true } });
      ownerId = owner?.id;
    }
    let stageId: string | undefined;
    if (m.stageName) {
      const stage = await db.stage.findFirst({
        where: { name: { equals: m.stageName, mode: 'insensitive' }, archivedAt: null, pipeline: { isDefault: true, entity: 'lead', archivedAt: null } },
        select: { id: true },
      });
      stageId = stage?.id;
    }
    const tags = [...new Set([...(m.tags ?? []), ...(opts.tags ?? [])].map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
    const parsed = LeadCreateSchema.safeParse({
      name: name.slice(0, 120),
      source: m.source ?? opts.source,
      valueInr: m.valueInr ?? 0,
      tags,
      customFields: m.customFields ?? {},
      ...(m.companyName ? { companyName: m.companyName } : {}),
      ...(m.phone ? { phone: m.phone } : {}),
      ...(m.email ? { email: m.email } : {}),
      ...(m.city ? { city: m.city } : {}),
      ...(m.state ? { state: m.state } : {}),
      ...(m.sourceRef ? { sourceRef: m.sourceRef } : {}),
      ...(m.productInterest ? { productInterest: m.productInterest } : {}),
      ...(m.requirement ? { requirement: m.requirement } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...(stageId ? { stageId } : {}),
    });
    if (!parsed.success) {
      throw new AppException('VALIDATION_FAILED', 'The mapped lead is invalid', { details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    return parsed.data;
  }

  /** Existing open-or-closed (not deleted) lead by the match keys in order. */
  async findMatch(db: TenantDb, m: MappedLead, matchBy: readonly WebhookMatchKey[]): Promise<string | null> {
    for (const key of matchBy) {
      if (key === 'phone' && m.phone) {
        const hit = await db.lead.findFirst({ where: { phone: m.phone, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (hit) return hit.id;
      }
      if (key === 'email' && m.email) {
        const hit = await db.lead.findFirst({ where: { email: { equals: m.email, mode: 'insensitive' }, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (hit) return hit.id;
      }
    }
    return null;
  }

  async create(workspaceId: string, m: MappedLead, opts: { source: LeadSource; tags?: readonly string[]; actor: RequestActor; notify?: boolean }): Promise<IntakeResult> {
    const db = this.prisma.forTenant(workspaceId);
    const input = await this.toCreate(db, m, opts);
    if (input.sourceRef) {
      const existing = await db.lead.findFirst({ where: { source: input.source, sourceRef: input.sourceRef }, select: { id: true } });
      if (existing) return { leadId: existing.id, created: false, updated: false, duplicate: true };
    }
    try {
      const lead = await this.leads.create(intakeAuth(workspaceId), input, { actor: opts.actor, notify: opts.notify });
      return { leadId: lead.id, created: true, updated: false, duplicate: false };
    } catch (err) {
      if (err instanceof AppException && err.code === 'LEAD_DUPLICATE' && input.sourceRef) {
        const existing = await db.lead.findFirst({ where: { source: input.source, sourceRef: input.sourceRef }, select: { id: true } });
        return { leadId: existing?.id ?? null, created: false, updated: false, duplicate: true };
      }
      throw err;
    }
  }

  /** Update the matched lead with the mapped values (tags are added, custom fields patched); create when none matches and createIfMissing. */
  async upsert(
    workspaceId: string,
    m: MappedLead,
    opts: { source: LeadSource; tags?: readonly string[]; actor: RequestActor; matchBy: readonly WebhookMatchKey[]; createIfMissing: boolean },
  ): Promise<IntakeResult> {
    const db = this.prisma.forTenant(workspaceId);
    const leadId = await this.findMatch(db, m, opts.matchBy);
    if (!leadId) {
      if (!opts.createIfMissing) return { leadId: null, created: false, updated: false, duplicate: false };
      return this.create(workspaceId, m, opts);
    }
    const current = await db.lead.findFirst({ where: { id: leadId }, select: { tags: true } });
    const patch: LeadUpdate = {};
    if (m.name) patch.name = m.name.slice(0, 120);
    for (const f of ['companyName', 'phone', 'email', 'city', 'state', 'productInterest', 'requirement'] as const) if (m[f]) patch[f] = m[f];
    if (m.valueInr !== undefined) patch.valueInr = m.valueInr;
    const extra = [...(m.tags ?? []), ...(opts.tags ?? [])];
    if (extra.length) patch.tags = [...new Set([...(current?.tags ?? []), ...extra])].slice(0, 30);
    if (Object.keys(m.customFields ?? {}).length) patch.customFields = m.customFields as LeadUpdate['customFields'];
    if (Object.keys(patch).length) await this.leads.update(intakeAuth(workspaceId), leadId, patch, { actor: opts.actor });
    return { leadId, created: false, updated: Object.keys(patch).length > 0, duplicate: false };
  }
}
