import { Injectable, Logger, type RawBodyRequest } from '@nestjs/common';
import {
  applyPayloadMapping,
  parseSignatureHeader,
  PayloadMappingSchema,
  WEBHOOK_HEADERS,
  WEBHOOK_IDEMPOTENCY_TTL_SEC,
  WEBHOOK_TOLERANCE_SEC,
  type ErrorCode,
  type PayloadMapping,
  type WebhookDelivery,
  type WebhookMatchKey,
} from '@vistar/shared';
import type { Request } from 'express';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { decryptSecret, hmacSha256Hex, safeEqualHex } from '../../infra/crypto/secrets.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AccountStatusService } from '../auth/state/account-status.service.js';
import { KvStore } from '../auth/state/kv.store.js';
import { integrationActor, LeadIntakeService } from '../integrations/lead-intake.service.js';
import { publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { DEFAULT_INBOUND_MAPPING, redactHeaders, toDeliveryDto, toEndpointDto, type DeliveryRow, type EndpointRow } from './webhook.mapper.js';

export interface InboundResult {
  ok: true;
  duplicate: boolean;
  leadId: string | null;
  runId: string | null;
  deliveryId: string;
  captured: boolean;
}

interface ProcessResult {
  action: string;
  leadId: string | null;
  runId: string | null;
  duplicate: boolean;
}

/** Rejected (unverified) requests logged per source per minute; more are refused without a log row. */
const REJECT_LOG_PER_MIN = 30;
const IDEMPOTENCY_LOCK_SEC = 120;
const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Inbound webhooks (POST /api/hooks/{workspaceId}/{sourceKey}; SPEC 15.5, change #19 wave C, D-069).
 * Order: source lookup -> active -> verification (HMAC over "t.rawBody" with 300 s tolerance, current or previous secret
 * during a rotation grace; or the token) -> Idempotency-Key (24 h: same body = duplicate, other body = 409; a short
 * lock against concurrent retries) -> capture mode (store the sample, do nothing else) -> action through
 * LeadIntakeService (create_lead with routing, update_lead by phone / e-mail, start_workflow = lead + queued run).
 * Every request that passed the source lookup is in the delivery log (unverified ones rate limited).
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: LeadIntakeService,
    private readonly kv: KvStore,
    private readonly status: AccountStatusService,
    private readonly events: EventBus,
  ) {}

  private verify(ep: EndpointRow, raw: Buffer | undefined, req: Request, queryToken: string | undefined): { ok: true } | { ok: false; code: 'WEBHOOK_SIGNATURE_INVALID' | 'WEBHOOK_TIMESTAMP_EXPIRED'; message: string } {
    const now = Date.now();
    const secrets = [decryptSecret(ep.secretEncrypted)];
    if (ep.previousSecretEncrypted && ep.previousSecretExpiresAt && ep.previousSecretExpiresAt.getTime() > now) secrets.push(decryptSecret(ep.previousSecretEncrypted));
    if (ep.verification === 'token') {
      const header = req.headers[WEBHOOK_HEADERS.token];
      const given = (typeof header === 'string' ? header : undefined) ?? queryToken;
      if (given && secrets.some((s) => safeEqual(given, s))) return { ok: true };
      return { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Invalid or missing X-Vistar-Token' };
    }
    const header = req.headers[WEBHOOK_HEADERS.signature];
    const parsed = parseSignatureHeader(typeof header === 'string' ? header : undefined);
    if (!parsed || !raw) return { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Missing or malformed X-Vistar-Signature (t=<unix>,v1=<hex>)' };
    if (Math.abs(Math.floor(now / 1000) - parsed.timestamp) > WEBHOOK_TOLERANCE_SEC) return { ok: false, code: 'WEBHOOK_TIMESTAMP_EXPIRED', message: `Signature timestamp is more than ${WEBHOOK_TOLERANCE_SEC} s away from now` };
    const signed = Buffer.concat([Buffer.from(`${parsed.timestamp}.`), raw]);
    for (const s of secrets) {
      const expected = hmacSha256Hex(s, signed);
      if (parsed.signatures.some((sig) => safeEqualHex(sig, expected))) return { ok: true };
    }
    return { ok: false, code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Signature does not match' };
  }

  private async record(ep: EndpointRow, id: string, fields: Partial<Prisma.WebhookDeliveryUncheckedCreateInput> & { status: 'success' | 'failed' }): Promise<DeliveryRow> {
    const now = new Date();
    const row = await this.prisma.forTenant(ep.workspaceId).webhookDelivery.create({
      data: {
        id,
        workspaceId: ep.workspaceId,
        endpointId: ep.id,
        direction: 'inbound',
        event: 'inbound',
        attempt: 1,
        attempts: [{ attempt: 1, at: now.toISOString(), ok: fields.status === 'success', responseStatus: fields.responseStatus ?? null, latencyMs: fields.latencyMs ?? null, error: fields.error ?? null }],
        ...fields,
      },
    });
    await this.prisma.forTenant(ep.workspaceId).webhookEndpoint.updateMany({
      where: { id: ep.id },
      data: fields.status === 'success' ? { lastDeliveryAt: now, lastSuccessAt: now } : { lastDeliveryAt: now, lastFailureAt: now },
    });
    await publishSafe(this.events, this.logger, 'webhook.delivery_updated', ep.workspaceId, { delivery: toDeliveryDto(row, ep.name) }, { actor: SYSTEM_ACTOR });
    return row;
  }

  async receive(workspaceId: string, sourceKey: string, req: RawBodyRequest<Request>, queryToken: string | undefined): Promise<{ status: number; body: InboundResult }> {
    const ws = await this.status.workspaceStatus(workspaceId);
    if (!ws || ws === 'deleted') throw notFound('Webhook source');
    if (ws === 'suspended') throw new AppException('AUTH_ACCOUNT_DISABLED', 'This workspace is suspended');
    const db = this.prisma.forTenant(workspaceId);
    const ep = await db.webhookEndpoint.findFirst({ where: { sourceKey, direction: 'inbound', deletedAt: null } });
    if (!ep) throw notFound('Webhook source');

    const started = Date.now();
    const deliveryId = randomUUID();
    const raw = req.rawBody;
    const body: unknown = req.body;
    const headers = redactHeaders(req.headers as Record<string, unknown>);
    const keyHeader = req.headers[WEBHOOK_HEADERS.idempotencyKey];
    const idempotencyKey = typeof keyHeader === 'string' && keyHeader.trim() ? keyHeader.trim().slice(0, 200) : null;
    const requestBody = (body ?? null) as Prisma.InputJsonValue;
    const fail = async (code: ErrorCode, message: string, httpStatus: number, signatureValid: boolean | null): Promise<never> => {
      await this.record(ep, deliveryId, { status: 'failed', requestHeaders: headers, requestBody, responseStatus: httpStatus, responseBody: JSON.stringify({ error: { code, message } }), latencyMs: Date.now() - started, error: message, signatureValid, idempotencyKey });
      throw new AppException(code, message);
    };

    if (!ep.isActive) await fail('WEBHOOK_ENDPOINT_DISABLED', 'This webhook source is paused', 410, null);

    const verified = this.verify(ep, raw, req, queryToken);
    if (!verified.ok) {
      const minute = Math.floor(Date.now() / 60_000);
      const n = await this.kv.incr(`hook:rejected:${ep.id}:${minute}`, 70);
      if (n <= REJECT_LOG_PER_MIN) await fail(verified.code, verified.message, 401, false);
      throw new AppException(verified.code, verified.message);
    }
    if (!raw || body === null || typeof body !== 'object') await fail('VALIDATION_FAILED', 'Send a JSON object with Content-Type: application/json', 400, true);
    const bodyHash = sha256(raw!);

    // idempotency
    let lockKey: string | null = null;
    if (idempotencyKey) {
      const prior = await db.webhookDelivery.findFirst({
        where: { endpointId: ep.id, direction: 'inbound', idempotencyKey, status: 'success', replayOfId: null, createdAt: { gte: new Date(Date.now() - WEBHOOK_IDEMPOTENCY_TTL_SEC * 1000) } },
        orderBy: { createdAt: 'asc' },
      });
      if (prior) {
        if (prior.bodyHash && prior.bodyHash !== bodyHash) await fail('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was used with a different body', 409, true);
        const prev = (prior.result ?? {}) as Partial<InboundResult & ProcessResult>;
        const result: InboundResult = { ok: true, duplicate: true, leadId: prev.leadId ?? null, runId: prev.runId ?? null, deliveryId, captured: false };
        await this.record(ep, deliveryId, { status: 'success', requestHeaders: headers, requestBody, bodyHash, responseStatus: 200, responseBody: JSON.stringify(result), latencyMs: Date.now() - started, signatureValid: true, idempotencyKey, result: { action: prev.action ?? ep.action, leadId: result.leadId, runId: result.runId, duplicate: true, captured: false } });
        return { status: 200, body: result };
      }
      lockKey = `hook:idem:${ep.id}:${sha256(idempotencyKey)}`;
      if (!(await this.kv.setNx(lockKey, deliveryId, IDEMPOTENCY_LOCK_SEC))) await fail('IDEMPOTENCY_CONFLICT', 'A request with this Idempotency-Key is still being processed', 409, true);
    }

    try {
      // capture mode: store the sample, do nothing else
      if (ep.captureUntil && ep.captureUntil.getTime() > Date.now()) {
        const updated = await db.webhookEndpoint.update({ where: { id: ep.id }, data: { samplePayload: requestBody, sampleCapturedAt: new Date(), captureUntil: null } });
        const result: InboundResult = { ok: true, duplicate: false, leadId: null, runId: null, deliveryId, captured: true };
        await this.record(ep, deliveryId, { status: 'success', requestHeaders: headers, requestBody, bodyHash, responseStatus: 202, responseBody: JSON.stringify(result), latencyMs: Date.now() - started, signatureValid: true, idempotencyKey, result: { action: 'capture', leadId: null, runId: null, duplicate: false, captured: true } });
        await publishSafe(this.events, this.logger, 'webhook.endpoint_updated', workspaceId, { endpoint: toEndpointDto(updated), reason: 'sample_captured' }, { actor: SYSTEM_ACTOR });
        return { status: 202, body: result };
      }

      let processed: ProcessResult;
      try {
        processed = await this.process(ep, body, deliveryId);
      } catch (err) {
        const code = err instanceof AppException ? err.code : 'INTERNAL_ERROR';
        const message = err instanceof AppException ? err.message : 'Processing failed';
        const httpStatus = err instanceof AppException ? err.getStatus() : 500;
        await this.record(ep, deliveryId, { status: 'failed', requestHeaders: headers, requestBody, bodyHash, responseStatus: httpStatus, responseBody: JSON.stringify({ error: { code, message, details: err instanceof AppException ? err.details : undefined } }), latencyMs: Date.now() - started, error: message, signatureValid: true, idempotencyKey });
        throw err;
      }
      const result: InboundResult = { ok: true, duplicate: processed.duplicate, leadId: processed.leadId, runId: processed.runId, deliveryId, captured: false };
      await this.record(ep, deliveryId, { status: 'success', requestHeaders: headers, requestBody, bodyHash, responseStatus: processed.duplicate ? 200 : 202, responseBody: JSON.stringify(result), latencyMs: Date.now() - started, signatureValid: true, idempotencyKey, result: { ...processed, captured: false } });
      return { status: processed.duplicate ? 200 : 202, body: result };
    } finally {
      if (lockKey) await this.kv.del(lockKey);
    }
  }

  /** Run the source's action on a payload (also used by replay). */
  async process(ep: EndpointRow, payload: unknown, deliveryId: string): Promise<ProcessResult> {
    const parsedMapping = PayloadMappingSchema.safeParse(ep.mapping ?? DEFAULT_INBOUND_MAPPING);
    const mapping: PayloadMapping = parsedMapping.success ? parsedMapping.data : DEFAULT_INBOUND_MAPPING;
    const { lead } = applyPayloadMapping(payload, mapping);
    const actor = integrationActor(ep.id, ep.name);
    const matchBy = (ep.matchBy.length ? ep.matchBy : ['phone', 'email']) as WebhookMatchKey[];
    const action = ep.action ?? 'create_lead';
    if (action === 'create_lead') {
      const res = await this.intake.create(ep.workspaceId, lead, { source: 'webhook', actor });
      return { action, leadId: res.leadId, runId: null, duplicate: res.duplicate };
    }
    if (action === 'update_lead') {
      const res = await this.intake.upsert(ep.workspaceId, lead, { source: 'webhook', actor, matchBy, createIfMissing: ep.createIfMissing });
      return { action, leadId: res.leadId, runId: null, duplicate: res.duplicate };
    }
    // start_workflow: the engine is not built yet; the run is recorded as queued for it.
    const db = this.prisma.forTenant(ep.workspaceId);
    const wf = ep.workflowId ? await db.workflow.findFirst({ where: { id: ep.workflowId, deletedAt: null } }) : null;
    if (!wf || wf.status !== 'active' || !wf.activeVersionId) throw new AppException('WORKFLOW_NOT_ACTIVE', 'The workflow of this source is not active');
    let leadId: string | null = null;
    if (lead.name || lead.phone || lead.email) leadId = (await this.intake.upsert(ep.workspaceId, lead, { source: 'webhook', actor, matchBy, createIfMissing: ep.createIfMissing })).leadId;
    const run = await db.workflowRun.create({
      data: {
        workspaceId: ep.workspaceId,
        workflowId: wf.id,
        versionId: wf.activeVersionId,
        leadId,
        status: 'queued',
        triggerEvent: { type: 'webhook', endpointId: ep.id, deliveryId, payload: (payload ?? null) as Prisma.InputJsonValue },
        idempotencyKey: `hook:${deliveryId}`,
      },
    });
    return { action, leadId, runId: run.id, duplicate: false };
  }

  /** Replay a verified inbound delivery: the stored body runs again as a new delivery (replayOfId set). */
  async replay(original: DeliveryRow, ep: EndpointRow): Promise<WebhookDelivery> {
    if (original.signatureValid !== true || original.requestBody === null) throw new AppException('WEBHOOK_REPLAY_NOT_ALLOWED', 'Only verified requests can be replayed');
    if (ep.deletedAt) throw notFound('Webhook source');
    const started = Date.now();
    const id = randomUUID();
    const base = { requestHeaders: (original.requestHeaders ?? {}) as Prisma.InputJsonObject, requestBody: original.requestBody as Prisma.InputJsonValue, bodyHash: original.bodyHash, signatureValid: true, idempotencyKey: original.idempotencyKey, replayOfId: original.id };
    try {
      const processed = await this.process(ep, original.requestBody, id);
      const result = { ok: true, duplicate: processed.duplicate, leadId: processed.leadId, runId: processed.runId, deliveryId: id, captured: false };
      const row = await this.record(ep, id, { ...base, status: 'success', responseStatus: processed.duplicate ? 200 : 202, responseBody: JSON.stringify(result), latencyMs: Date.now() - started, result: { ...processed, captured: false } });
      return toDeliveryDto(row, ep.name);
    } catch (err) {
      const message = err instanceof AppException ? err.message : 'Processing failed';
      const row = await this.record(ep, id, { ...base, status: 'failed', responseStatus: err instanceof AppException ? err.getStatus() : 500, responseBody: JSON.stringify({ error: { message } }), latencyMs: Date.now() - started, error: message });
      return toDeliveryDto(row, ep.name);
    }
  }
}
