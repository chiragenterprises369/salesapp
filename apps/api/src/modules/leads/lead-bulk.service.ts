import { Injectable, Logger } from '@nestjs/common';
import type { BulkResult, Lead as LeadDto, LeadBulkAction, LeadMerge } from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Lead as LeadRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { loadFieldDefs } from '../customization/custom-values.js';
import { ActivityService } from './activity.service.js';
import { LEAD_LIST_INCLUDE, parseCustomFields, toLeadListItem } from './lead.mapper.js';
import { endOfColumnKeys } from './lead-position.js';
import { buildLeadWhere } from './lead-query.js';
import { scoreLead } from './lead-score.js';
import { activeStageOrThrow, stageDates, syncDealsForStage } from './lead-stage.js';
import { LeadsService, normalizeTags } from './leads.service.js';
import { publishSafe, requestActor, requirePermission, type RequestActor } from './lib/context.js';

type Failed = BulkResult['failed'][number];

/** Fields whose value can be taken from a duplicate when merging (LeadMerge.fieldWinners). */
const MERGE_FIELDS = [
  'name',
  'companyName',
  'phone',
  'email',
  'city',
  'state',
  'productInterest',
  'requirement',
  'valueInr',
  'ownerId',
  'nextFollowUpAt',
  'contactId',
  'companyId',
] as const satisfies ReadonlyArray<keyof LeadRow>;
type MergeField = (typeof MERGE_FIELDS)[number];

const BULK_TX = { timeout: 60_000, maxWait: 10_000 };

@Injectable()
export class LeadBulkService {
  private readonly logger = new Logger(LeadBulkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly activities: ActivityService,
    private readonly leads: LeadsService,
  ) {}

  async bulk(auth: AuthContext, req: Request, body: LeadBulkAction): Promise<BulkResult> {
    if (body.action === 'assign') requirePermission(auth, 'leads.assign', 'You cannot reassign leads');
    if (body.action === 'delete') requirePermission(auth, 'leads.delete', 'You cannot delete leads');
    if (body.action === 'whatsapp_template') requirePermission(auth, 'messages.send', 'You cannot send WhatsApp messages');

    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const ids = [...new Set(body.leadIds)];
    const base = await buildLeadWhere(auth, this.scope, {});
    const leads = await db.lead.findMany({ where: { AND: [base, { id: { in: ids } }] } });
    const found = new Set(leads.map((l) => l.id));
    const failed: Failed[] = ids.filter((id) => !found.has(id)).map((id) => ({ id, code: 'NOT_FOUND', message: 'Lead not found' }));
    const actor = await requestActor(db, auth);
    const now = new Date();

    switch (body.action) {
      case 'whatsapp_template':
        // Wave 2 (realtime-integrations) sends templates; until then every lead fails cleanly.
        return {
          succeeded: 0,
          failed: [...failed, ...leads.map((l) => ({ id: l.id, code: 'INTEGRATION_NOT_CONNECTED', message: 'Connect WhatsApp to send templates' }))],
        };

      case 'delete': {
        if (leads.length) {
          await db.lead.updateMany({ where: { id: { in: [...found] }, deletedAt: null }, data: { deletedAt: now, version: { increment: 1 } } });
          await this.audit.record(auth, req, { action: 'lead.bulk_delete', entityType: 'lead', diff: { count: leads.length, leadIds: [...found] } }, actor.summary?.name);
          await publishSafe(this.events, this.logger, 'lead.deleted', wid, { leadIds: [...found] }, { actor: actor.event });
        }
        return { succeeded: leads.length, failed };
      }

      case 'assign': {
        const ownerId = body.ownerId;
        if (ownerId) await this.leads.assertAssignable(db, ownerId);
        const targets = leads.filter((l) => l.ownerId !== ownerId);
        if (targets.length) {
          const targetIds = targets.map((l) => l.id);
          await db.$transaction(async (tx) => {
            await tx.lead.updateMany({ where: { id: { in: targetIds } }, data: { ownerId, version: { increment: 1 } } });
            await tx.activity.createMany({
              data: targets.map((l) => this.activities.data(wid, actor, l.id, 'assigned', { fromUserId: l.ownerId, toUserId: ownerId, rule: 'manual' }, now)),
            });
          }, BULK_TX);
          const from = new Map(targets.map((l) => [l.id, l.ownerId]));
          const updated = await db.lead.findMany({ where: { id: { in: targetIds } }, include: LEAD_LIST_INCLUDE });
          for (const lead of updated) {
            await publishSafe(
              this.events,
              this.logger,
              'lead.assigned',
              wid,
              { lead: toLeadListItem(lead), fromUserId: from.get(lead.id) ?? null, toUserId: ownerId, rule: 'manual' },
              { actor: actor.event },
            );
          }
          await this.leads.notifyAssigned(auth, actor, updated, ownerId);
        }
        return { succeeded: leads.length, failed };
      }

      case 'change_stage': {
        const stage = await activeStageOrThrow(db, body.stageId);
        const movers = leads.filter((l) => l.stageId !== stage.id);
        if (movers.length) {
          await db.$transaction(async (tx) => {
            const keys = await endOfColumnKeys(tx, stage.id, movers.length);
            for (const [i, l] of movers.entries()) {
              await tx.lead.update({
                where: { id: l.id },
                data: { stageId: stage.id, pipelineId: stage.pipelineId, position: keys[i]!, lastActivityAt: now, ...stageDates(stage.type, now), version: { increment: 1 } },
              });
            }
            await syncDealsForStage(tx, wid, movers, stage.type, now);
            await tx.activity.createMany({
              data: movers.map((l) => this.activities.data(wid, actor, l.id, 'stage_changed', { fromStageId: l.stageId, toStageId: stage.id }, now)),
            });
          }, BULK_TX);
          const from = new Map(movers.map((l) => [l.id, l.stageId]));
          for (const lead of await db.lead.findMany({ where: { id: { in: movers.map((l) => l.id) } }, include: LEAD_LIST_INCLUDE })) {
            await publishSafe(
              this.events,
              this.logger,
              'stage.changed',
              wid,
              { lead: toLeadListItem(lead), fromStageId: from.get(lead.id) ?? null, toStageId: stage.id, position: lead.position },
              { actor: actor.event },
            );
          }
        }
        return { succeeded: leads.length, failed };
      }

      case 'add_tags':
      case 'remove_tags': {
        const tags = normalizeTags(body.tags);
        const changes = leads
          .map((l) => {
            const next = body.action === 'add_tags' ? normalizeTags([...l.tags, ...tags]) : l.tags.filter((t) => !tags.includes(t));
            return { lead: l, next };
          })
          .filter((c) => c.next.length !== c.lead.tags.length);
        if (changes.length) {
          await db.$transaction(async (tx) => {
            for (const { lead, next } of changes) {
              const scored = scoreLead({ ...lead, tags: next }, now);
              await tx.lead.update({
                where: { id: lead.id },
                data: { tags: next, score: scored.score, temperature: scored.temperature, scoreBreakdown: scored.breakdown, version: { increment: 1 } },
              });
            }
            await tx.activity.createMany({
              data: changes.map((c) => this.activities.data(wid, actor, c.lead.id, 'field_updated', { field: 'tags', from: c.lead.tags, to: c.next }, now)),
            });
          }, BULK_TX);
          if (body.action === 'add_tags') await this.leads.ensureTags(db, wid, tags);
          for (const lead of await db.lead.findMany({ where: { id: { in: changes.map((c) => c.lead.id) } }, include: LEAD_LIST_INCLUDE })) {
            await publishSafe(this.events, this.logger, 'lead.updated', wid, { lead: toLeadListItem(lead), changed: ['tags', 'score', 'temperature'] }, { actor: actor.event });
          }
        }
        return { succeeded: leads.length, failed };
      }
    }
  }

  // ------------------------------------------------------------------ merge

  async merge(auth: AuthContext, req: Request, body: LeadMerge): Promise<LeadDto> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const dupIds = [...new Set(body.duplicateIds)];
    if (dupIds.includes(body.primaryId)) throw new AppException('LEAD_MERGE_INVALID', 'A lead cannot be merged into itself');

    const base = await buildLeadWhere(auth, this.scope, {});
    const rows = await db.lead.findMany({ where: { AND: [base, { id: { in: [body.primaryId, ...dupIds] } }] } });
    if (rows.length !== dupIds.length + 1) throw notFound('Lead');
    const byId = new Map(rows.map((l) => [l.id, l]));
    const primary = byId.get(body.primaryId)!;
    const dups = dupIds.map((id) => byId.get(id)!);

    const patch: Partial<Pick<LeadRow, MergeField>> = {};
    for (const [field, winnerId] of Object.entries(body.fieldWinners)) {
      if (!(MERGE_FIELDS as readonly string[]).includes(field)) throw new AppException('LEAD_MERGE_INVALID', 'One of the selected fields cannot be merged');
      const winner = byId.get(winnerId);
      if (!winner) throw new AppException('LEAD_MERGE_INVALID', 'Field winners must be the primary lead or one of the duplicates');
      if (winner.id !== primary.id) (patch as Record<string, unknown>)[field] = winner[field as MergeField];
    }
    if (patch.ownerId !== undefined && patch.ownerId !== primary.ownerId) requirePermission(auth, 'leads.assign', 'You cannot reassign leads');

    const now = new Date();
    const tags = normalizeTags([...primary.tags, ...dups.flatMap((d) => d.tags)]);
    // The primary keeps all its values; duplicates only contribute values of active lead fields (no unknown or archived keys).
    const defs = await loadFieldDefs(db, 'lead');
    const activeKeys = new Set(defs.filter((d) => !d.archivedAt).map((d) => d.key));
    const fromDups = Object.assign({}, ...[...dups].reverse().map((d) => parseCustomFields(d.customFields))) as Record<string, unknown>;
    const customFields = {
      ...Object.fromEntries(Object.entries(fromDups).filter(([k, v]) => activeKeys.has(k) && v !== null)),
      ...parseCustomFields(primary.customFields),
    } as Prisma.JsonObject;
    const merged = { ...primary, ...patch, tags };
    const scored = scoreLead(merged, now);
    const actor: RequestActor = await requestActor(db, auth);

    const { lead, activityRows } = await db.$transaction(async (tx) => {
      const res = await tx.lead.updateMany({
        where: { id: primary.id, version: primary.version, deletedAt: null },
        data: { ...patch, tags, customFields, score: scored.score, temperature: scored.temperature, scoreBreakdown: scored.breakdown, version: { increment: 1 } },
      });
      if (res.count !== 1) throw new AppException('VERSION_CONFLICT', 'Someone else changed this lead. Reload and try again.');
      const repoint = { where: { leadId: { in: dupIds } }, data: { leadId: primary.id } };
      await tx.activity.updateMany(repoint);
      await tx.task.updateMany(repoint);
      await tx.call.updateMany(repoint);
      await tx.deal.updateMany(repoint);
      await tx.file.updateMany(repoint);
      await tx.conversation.updateMany(repoint);
      await tx.lead.updateMany({ where: { id: { in: dupIds } }, data: { deletedAt: now, mergedIntoId: primary.id, version: { increment: 1 } } });
      const activityRows = await tx.activity.createManyAndReturn({ data: [this.activities.data(wid, actor, primary.id, 'merged', { mergedLeadIds: dupIds }, now)] });
      return { lead: await this.leads.detail(tx, primary.id), activityRows };
    }, BULK_TX);

    await this.leads.ensureTags(db, wid, tags);
    await this.audit.record(auth, req, { action: 'lead.merge', entityType: 'lead', entityId: primary.id, diff: { mergedIds: dupIds, fields: Object.keys(patch) } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'lead.merged', wid, { primaryId: primary.id, mergedIds: dupIds }, { actor: actor.event });
    await publishSafe(this.events, this.logger, 'lead.updated', wid, { lead: toLeadListItem(lead), changed: [...Object.keys(patch), 'tags', 'customFields', 'score'] }, { actor: actor.event });
    await this.activities.publishCreated(db, wid, activityRows, actor);
    return this.leads.present(db, auth, lead, defs);
  }
}
