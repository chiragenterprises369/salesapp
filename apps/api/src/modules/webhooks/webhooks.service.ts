import { Injectable, Logger } from '@nestjs/common';
import {
  applyPayloadMapping,
  listPayloadPaths,
  WEBHOOK_TEST_EVENT,
  type InboundEndpointCreate,
  type MappingPreviewResponse,
  type OutboundEndpointCreate,
  type Page,
  type PayloadMapping,
  type WebhookCapture,
  type WebhookDelivery,
  type WebhookDeliveryQuery,
  type WebhookDirection,
  type WebhookEndpoint,
  type WebhookEndpointUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { encryptSecret, randomToken } from '../../infra/crypto/secrets.js';
import { assertPublicUrl, BlockedUrlError } from '../../infra/http/safe-http.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { isUniqueViolation, jsonOrNull } from '../crm/lib/db.js';
import { LEAD_LIST_INCLUDE, toLeadListItem } from '../leads/lead.mapper.js';
import { afterTimeCursor, nextTimeCursor } from '../leads/lib/cursor.js';
import { requestActor } from '../leads/lib/context.js';
import { InboundService } from './inbound.service.js';
import { OutboundDispatcher } from './outbound.service.js';
import { toDeliveryDto, toEndpointDto, type EndpointRow } from './webhook.mapper.js';

const newSecret = () => `whsec_${randomToken(24)}`;
const DAY_MS = 86_400_000;

/**
 * Webhook endpoints (inbound sources and outbound subscriptions), the delivery log, mapping preview, sample
 * capture, test send and replay (SPEC 15.5, change #19 wave C). Secrets are returned once (create, rotate) and stored
 * encrypted; lists show the last 4 characters.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dispatcher: OutboundDispatcher,
    private readonly inbound: InboundService,
  ) {}

  private db(auth: AuthContext) {
    return this.prisma.forTenant(auth.workspaceId);
  }

  private async load(auth: AuthContext, id: string): Promise<EndpointRow> {
    const row = await this.db(auth).webhookEndpoint.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('Webhook endpoint');
    return row;
  }

  private async stats(auth: AuthContext, ids: string[]): Promise<Map<string, { deliveries24h: number; failures24h: number }>> {
    const out = new Map<string, { deliveries24h: number; failures24h: number }>();
    if (!ids.length) return out;
    const rows = await this.db(auth).webhookDelivery.groupBy({ by: ['endpointId', 'status'], where: { endpointId: { in: ids }, createdAt: { gte: new Date(Date.now() - DAY_MS) } }, _count: { _all: true } });
    for (const r of rows) {
      const s = out.get(r.endpointId) ?? { deliveries24h: 0, failures24h: 0 };
      s.deliveries24h += r._count._all;
      if (r.status === 'failed' || r.status === 'dead') s.failures24h += r._count._all;
      out.set(r.endpointId, s);
    }
    return out;
  }

  private async dto(auth: AuthContext, row: EndpointRow): Promise<WebhookEndpoint> {
    return toEndpointDto(row, (await this.stats(auth, [row.id])).get(row.id));
  }

  private async checkUrl(url: string): Promise<void> {
    try {
      await assertPublicUrl(url);
    } catch (err) {
      if (err instanceof BlockedUrlError) throw new AppException('WEBHOOK_URL_BLOCKED', `This URL cannot receive webhooks: ${err.message}`, { details: [{ path: 'url', message: err.message }] });
      throw err;
    }
  }

  private async checkWorkflow(auth: AuthContext, workflowId: string | null | undefined): Promise<void> {
    if (workflowId) await assertInTenant(this.db(auth), { workflow: workflowId });
  }

  // ---------------------------------------------------------------- endpoints

  async list(auth: AuthContext, q: { direction?: WebhookDirection }): Promise<{ items: WebhookEndpoint[] }> {
    const rows = await this.db(auth).webhookEndpoint.findMany({ where: { deletedAt: null, ...(q.direction ? { direction: q.direction } : {}) }, orderBy: [{ direction: 'asc' }, { createdAt: 'desc' }] });
    const stats = await this.stats(auth, rows.map((r) => r.id));
    return { items: rows.map((r) => toEndpointDto(r, stats.get(r.id))) };
  }

  async get(auth: AuthContext, id: string): Promise<WebhookEndpoint> {
    return this.dto(auth, await this.load(auth, id));
  }

  async createInbound(auth: AuthContext, req: Request, body: InboundEndpointCreate): Promise<WebhookEndpoint & { secret: string }> {
    await this.checkWorkflow(auth, body.workflowId);
    const secret = newSecret();
    let row: EndpointRow;
    try {
      row = await this.db(auth).webhookEndpoint.create({
        data: {
          workspaceId: auth.workspaceId,
          direction: 'inbound',
          name: body.name,
          sourceKey: body.sourceKey,
          action: body.action,
          workflowId: body.workflowId ?? null,
          mapping: jsonOrNull(body.mapping ?? null),
          verification: body.verification,
          matchBy: body.matchBy,
          createIfMissing: body.createIfMissing,
          samplePayload: jsonOrNull(body.samplePayload ?? null),
          secretEncrypted: encryptSecret(secret),
          secretLast4: secret.slice(-4),
          createdById: auth.userId,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppException('CONFLICT', 'This source key is already used', { details: [{ path: 'sourceKey', message: 'Taken' }] });
      throw err;
    }
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'webhook.create', entityType: 'webhook_endpoint', entityId: row.id, diff: { name: row.name, direction: 'inbound', sourceKey: row.sourceKey, action: row.action } }, actor.summary?.name);
    return { ...(await this.dto(auth, row)), secret };
  }

  async createOutbound(auth: AuthContext, req: Request, body: OutboundEndpointCreate): Promise<WebhookEndpoint & { secret: string }> {
    await this.checkUrl(body.url);
    const secret = newSecret();
    const row = await this.db(auth).webhookEndpoint.create({
      data: { workspaceId: auth.workspaceId, direction: 'outbound', name: body.name, url: body.url, events: body.events, isActive: body.isActive, createIfMissing: false, secretEncrypted: encryptSecret(secret), secretLast4: secret.slice(-4), createdById: auth.userId },
    });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'webhook.create', entityType: 'webhook_endpoint', entityId: row.id, diff: { name: row.name, direction: 'outbound', host: new URL(body.url).host, events: body.events } }, actor.summary?.name);
    return { ...(await this.dto(auth, row)), secret };
  }

  async update(auth: AuthContext, req: Request, id: string, body: WebhookEndpointUpdate): Promise<WebhookEndpoint> {
    const row = await this.load(auth, id);
    const inbound = row.direction === 'inbound';
    const data: Prisma.WebhookEndpointUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.isActive !== undefined) {
      data.isActive = body.isActive;
      if (body.isActive) Object.assign(data, { disabledAt: null, disabledReason: null, consecutiveFailures: 0, deadStreak: 0 });
    }
    if (inbound) {
      if (body.action !== undefined) data.action = body.action;
      if (body.workflowId !== undefined) {
        await this.checkWorkflow(auth, body.workflowId);
        data.workflowId = body.workflowId;
      }
      const action = body.action ?? row.action;
      const workflowId = body.workflowId !== undefined ? body.workflowId : row.workflowId;
      if (action === 'start_workflow' && !workflowId) throw new AppException('VALIDATION_FAILED', 'Pick the workflow to start', { details: [{ path: 'workflowId', message: 'Required' }] });
      if (body.mapping !== undefined) data.mapping = body.mapping as Prisma.InputJsonObject;
      if (body.verification !== undefined) data.verification = body.verification;
      if (body.matchBy !== undefined) data.matchBy = body.matchBy;
      if (body.createIfMissing !== undefined) data.createIfMissing = body.createIfMissing;
      if (body.samplePayload !== undefined) Object.assign(data, { samplePayload: jsonOrNull(body.samplePayload), sampleCapturedAt: body.samplePayload === null ? null : new Date() });
    } else {
      if (body.url !== undefined) {
        await this.checkUrl(body.url);
        data.url = body.url;
      }
      if (body.events !== undefined) data.events = body.events;
    }
    const updated = await this.db(auth).webhookEndpoint.update({ where: { id }, data });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'webhook.update', entityType: 'webhook_endpoint', entityId: id, diff: { fields: Object.keys(data) } }, actor.summary?.name);
    return this.dto(auth, updated);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const row = await this.load(auth, id);
    const db = this.db(auth);
    await db.webhookEndpoint.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, sourceKey: null } });
    await db.webhookDelivery.updateMany({ where: { endpointId: id, status: { in: ['pending', 'failed'] }, nextAttemptAt: { not: null } }, data: { status: 'failed', nextAttemptAt: null, error: 'Endpoint deleted' } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'webhook.delete', entityType: 'webhook_endpoint', entityId: id, diff: { name: row.name, direction: row.direction } }, actor.summary?.name);
    return { ok: true };
  }

  async rotateSecret(auth: AuthContext, req: Request, id: string, body: { graceHours: number }): Promise<{ secret: string; previousSecretExpiresAt: string | null }> {
    const row = await this.load(auth, id);
    const secret = newSecret();
    const now = new Date();
    const previousSecretExpiresAt = body.graceHours > 0 ? new Date(now.getTime() + body.graceHours * 3_600_000) : null;
    await this.db(auth).webhookEndpoint.update({
      where: { id },
      data: { secretEncrypted: encryptSecret(secret), secretLast4: secret.slice(-4), secretRotatedAt: now, previousSecretEncrypted: previousSecretExpiresAt ? row.secretEncrypted : null, previousSecretExpiresAt },
    });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'webhook.rotate_secret', entityType: 'webhook_endpoint', entityId: id, diff: { graceHours: body.graceHours } }, actor.summary?.name);
    return { secret, previousSecretExpiresAt: previousSecretExpiresAt?.toISOString() ?? null };
  }

  async capture(auth: AuthContext, id: string, body: WebhookCapture): Promise<WebhookEndpoint> {
    const row = await this.load(auth, id);
    if (row.direction !== 'inbound') throw new AppException('VALIDATION_FAILED', 'Sample capture is for inbound sources');
    const updated = await this.db(auth).webhookEndpoint.update({ where: { id }, data: { captureUntil: body.enabled ? new Date(Date.now() + body.minutes * 60_000) : null } });
    return this.dto(auth, updated);
  }

  /** One signed attempt now, no retries; `event` = a sample body of that event (latest lead for lead events). */
  async testSend(auth: AuthContext, id: string, body: { event?: string }): Promise<WebhookDelivery> {
    const row = await this.load(auth, id);
    if (row.direction !== 'outbound') throw new AppException('VALIDATION_FAILED', 'Test send is for outbound subscriptions');
    if (!row.isActive) throw new AppException('WEBHOOK_ENDPOINT_DISABLED', 'Switch the webhook on before a test send');
    const db = this.db(auth);
    const event = body.event ?? WEBHOOK_TEST_EVENT;
    let payload: Record<string, unknown> = { message: 'Test delivery from Vistar', endpointId: row.id };
    if (body.event && body.event !== WEBHOOK_TEST_EVENT) {
      const leadRow = ['lead.created', 'lead.updated', 'lead.assigned', 'stage.changed'].includes(body.event) ? await db.lead.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, include: LEAD_LIST_INCLUDE }) : null;
      const lead = leadRow ? toLeadListItem(leadRow) : null;
      payload = lead
        ? body.event === 'lead.assigned'
          ? { lead, fromUserId: null, toUserId: lead.owner?.id ?? null, rule: 'manual' }
          : body.event === 'stage.changed'
            ? { lead, fromStageId: lead.stageId, toStageId: lead.stageId, position: 'a0' }
            : body.event === 'lead.updated'
              ? { lead, changed: ['requirement'] }
              : { lead }
        : { sample: true, note: `Sample body of ${body.event}; real deliveries carry the payload documented for this event` };
    }
    const actor = await requestActor(db, auth);
    const envelope = { id: randomUUID(), type: event, workspaceId: auth.workspaceId, occurredAt: new Date().toISOString(), actor: actor.event, payload, test: true };
    const deliveryId = await this.dispatcher.createManual(auth.workspaceId, row.id, { event, eventId: null, body: envelope, replayOfId: null });
    const result = await this.dispatcher.attempt(deliveryId, auth.workspaceId, { force: true });
    return result ?? this.delivery(auth, deliveryId);
  }

  preview(body: { samplePayload: unknown; mapping: PayloadMapping }): MappingPreviewResponse {
    const { lead, errors } = applyPayloadMapping(body.samplePayload, body.mapping);
    return { lead: lead as unknown as Record<string, unknown>, errors, paths: listPayloadPaths(body.samplePayload) };
  }

  // ---------------------------------------------------------------- deliveries

  async deliveries(auth: AuthContext, q: WebhookDeliveryQuery): Promise<Page<WebhookDelivery>> {
    const where: Prisma.WebhookDeliveryWhereInput = {
      ...(q.endpointId ? { endpointId: q.endpointId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.direction ? { direction: q.direction } : {}),
      ...(q.event ? { event: q.event } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...afterTimeCursor(q.cursor),
    };
    const rows = await this.db(auth).webhookDelivery.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include: { endpoint: { select: { name: true } } } });
    const page = rows.slice(0, q.limit);
    return { items: page.map((r) => toDeliveryDto(r, r.endpoint.name)), nextCursor: nextTimeCursor(rows, q.limit) };
  }

  async delivery(auth: AuthContext, id: string): Promise<WebhookDelivery> {
    const row = await this.db(auth).webhookDelivery.findFirst({ where: { id }, include: { endpoint: { select: { name: true } } } });
    if (!row) throw notFound('Delivery');
    return toDeliveryDto(row, row.endpoint.name);
  }

  async replay(auth: AuthContext, req: Request, id: string): Promise<WebhookDelivery> {
    const db = this.db(auth);
    const original = await db.webhookDelivery.findFirst({ where: { id }, include: { endpoint: true } });
    if (!original) throw notFound('Delivery');
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'webhook.replay', entityType: 'webhook_delivery', entityId: id, diff: { direction: original.direction, endpointId: original.endpointId } }, actor.summary?.name);
    if (original.direction === 'inbound') return this.inbound.replay(original, original.endpoint);
    if (original.endpoint.deletedAt) throw notFound('Webhook endpoint');
    if (original.requestBody === null || original.status === 'pending') throw new AppException('WEBHOOK_REPLAY_NOT_ALLOWED', 'This delivery has not run yet');
    const newId = await this.dispatcher.createManual(auth.workspaceId, original.endpointId, { event: original.event ?? WEBHOOK_TEST_EVENT, eventId: original.eventId, body: original.requestBody, replayOfId: original.id });
    const result = await this.dispatcher.attempt(newId, auth.workspaceId, { force: true });
    return result ?? this.delivery(auth, newId);
  }
}
