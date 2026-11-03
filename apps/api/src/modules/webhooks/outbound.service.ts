import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  OUTBOUND_USER_AGENT,
  OUTBOUND_WEBHOOK_EVENTS,
  WEBHOOK_AUTO_DISABLE_AFTER_DEAD,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_RETRY_DELAYS_SEC,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_TIMEOUT_MS,
  type DomainEvent,
  type OutboundWebhookEvent,
  type WebhookDelivery,
} from '@vistar/shared';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { decryptSecret } from '../../infra/crypto/secrets.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { describeHttpError, safeFetch } from '../../infra/http/safe-http.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { createRedis } from '../../infra/redis/redis.module.js';
import { publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { stableUuid } from '../realtime/ids.js';
import { AdminNotifier } from './admin-notifier.js';
import { attemptsOf, isTestDelivery, redactHeaders, signatureHeader, toDeliveryDto, toEndpointDto, type DeliveryRow, type EndpointRow } from './webhook.mapper.js';

const QUEUE = 'vistar-webhooks';
const LOCK_MS = 60_000;
const OUTBOUND = new Set<string>(OUTBOUND_WEBHOOK_EVENTS);
const TIMER_MAX_DELAY_MS = 10 * 60_000;

interface DeliverJob {
  deliveryId: string;
  workspaceId: string;
  attempt: number;
}

/**
 * Outbound webhooks (SPEC 15.5, change #19 wave C, D-069). Every domain event in OUTBOUND_WEBHOOK_EVENTS becomes one
 * delivery per subscribed active endpoint (deterministic id + unique (endpointId, dedupeKey = event id), so N API
 * instances on the bus still create one). Attempts are signed POSTs through the SSRF-safe client; failures retry after
 * WEBHOOK_RETRY_DELAYS_SEC, the last failure is dead (dead-letter). Scheduling: BullMQ delayed jobs (jobId
 * `<deliveryId>-<attempt>`) when Redis is configured, in-process timers otherwise, plus a sweeper every 30 s that runs
 * anything overdue (recovery after restarts). A per-row claim (lockedUntil) keeps one attempt at a time.
 * WEBHOOK_AUTO_DISABLE_AFTER_DEAD dead deliveries in a row switch the endpoint off and notify company admins.
 */
@Injectable()
export class OutboundDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundDispatcher.name);
  private unsubscribe: (() => void) | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly timers = new Set<NodeJS.Timeout>();
  private sweeping = false;
  /** Tests: deliveries are still created, but nothing runs until processDue() / attemptNow() is called. */
  private paused = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly notifier: AdminNotifier,
  ) {}

  onModuleInit(): void {
    // Deliveries are always recorded; attempts run in the background only with HUB_BACKGROUND_JOBS=on (tests: off).
    this.unsubscribe = this.events.subscribe((e) => this.onEvent(e));
    if (getEnv().HUB_BACKGROUND_JOBS !== 'on') return;
    const conn = createRedis('bullmq');
    const workerConn = createRedis('bullmq');
    if (conn && workerConn) {
      this.queue = new Queue(QUEUE, { connection: conn as never });
      this.worker = new Worker<DeliverJob>(QUEUE, async (job) => void (await this.attempt(job.data.deliveryId, job.data.workspaceId, { expectedAttempt: job.data.attempt })), { connection: workerConn as never, concurrency: 5 });
      this.worker.on('error', (err) => this.logger.warn(`Webhook worker: ${err.name}`));
      this.queue.on('error', (err) => this.logger.warn(`Webhook queue: ${err.name}`));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.unsubscribe?.();
    for (const t of this.timers) clearTimeout(t);
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /** Test hook: stop scheduling (deliveries are still recorded). */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  // ---------------------------------------------------------------- fan-out

  private async onEvent(event: DomainEvent): Promise<void> {
    if (!OUTBOUND.has(event.type)) return;
    const db = this.prisma.forTenant(event.workspaceId);
    const endpoints = await db.webhookEndpoint.findMany({ where: { direction: 'outbound', isActive: true, deletedAt: null, events: { has: event.type } }, select: { id: true } });
    if (!endpoints.length) return;
    const body = { id: event.id, type: event.type, workspaceId: event.workspaceId, occurredAt: event.occurredAt, actor: event.actor, payload: event.payload } as unknown as Prisma.InputJsonObject;
    const now = new Date();
    for (const ep of endpoints) {
      const id = stableUuid('webhook-delivery', event.id, ep.id);
      const created = await db.webhookDelivery.createMany({
        data: [{ id, workspaceId: event.workspaceId, endpointId: ep.id, direction: 'outbound', event: event.type, eventId: event.id, dedupeKey: event.id, status: 'pending', attempt: 0, requestBody: body, idempotencyKey: event.id, nextAttemptAt: now }],
        skipDuplicates: true,
      });
      if (created.count) this.schedule(id, event.workspaceId, 1, 0);
    }
  }

  /** Create the delivery of a test send or a replay (not deduplicated). */
  async createManual(workspaceId: string, endpointId: string, input: { event: string; eventId: string | null; body: unknown; replayOfId: string | null }): Promise<string> {
    const id = randomUUID();
    await this.prisma.forTenant(workspaceId).webhookDelivery.create({
      data: { id, workspaceId, endpointId, direction: 'outbound', event: input.event, eventId: input.eventId, status: 'pending', attempt: 0, requestBody: input.body as Prisma.InputJsonValue, idempotencyKey: id, replayOfId: input.replayOfId, nextAttemptAt: new Date() },
    });
    return id;
  }

  // ---------------------------------------------------------------- scheduling

  private schedule(deliveryId: string, workspaceId: string, attempt: number, delayMs: number): void {
    if (this.paused || getEnv().HUB_BACKGROUND_JOBS !== 'on') return;
    if (this.queue) {
      this.queue
        .add('deliver', { deliveryId, workspaceId, attempt } satisfies DeliverJob, { jobId: `${deliveryId}-${attempt}`, delay: Math.max(0, delayMs), removeOnComplete: 1000, removeOnFail: 1000 })
        .catch((err: Error) => {
          this.logger.warn(`Webhook job not queued (${err.name}); the sweeper will pick it up`);
        });
      return;
    }
    if (delayMs > TIMER_MAX_DELAY_MS) return; // the sweeper runs it when due
    const t = setTimeout(() => {
      this.timers.delete(t);
      void this.attempt(deliveryId, workspaceId, { expectedAttempt: attempt }).catch((err: Error) => this.logger.warn(`Webhook attempt failed: ${err.name}`));
    }, delayMs);
    t.unref();
    this.timers.add(t);
  }

  /** Sweeper: run every overdue delivery (all workspaces). */
  @Interval('webhook-sweeper', 30_000)
  async sweep(): Promise<void> {
    if (this.paused || getEnv().HUB_BACKGROUND_JOBS !== 'on' || this.sweeping) return;
    await this.processDue();
  }

  /** Run overdue deliveries now (also the test entry point with a faked clock; `workspaceId` limits it to one tenant). Returns how many attempts ran. */
  async processDue(opts: { workspaceId?: string; limit?: number } = {}): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const now = new Date();
      const due = await this.prisma.webhookDelivery.findMany({
        where: { ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}), direction: 'outbound', status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        select: { id: true, workspaceId: true },
        orderBy: { nextAttemptAt: 'asc' },
        take: opts.limit ?? 50,
      });
      let ran = 0;
      for (const d of due) if (await this.attempt(d.id, d.workspaceId)) ran++;
      return ran;
    } finally {
      this.sweeping = false;
    }
  }

  // ---------------------------------------------------------------- one attempt

  /**
   * One signed attempt. `expectedAttempt` (jobs): skip when that attempt already ran; `force`: ignore nextAttemptAt
   * (test send, replay). Returns the delivery after the attempt, or null when nothing ran.
   */
  async attempt(deliveryId: string, workspaceId: string, opts: { expectedAttempt?: number; force?: boolean } = {}): Promise<WebhookDelivery | null> {
    const db = this.prisma.forTenant(workspaceId);
    const now = new Date();
    const claim = await db.webhookDelivery.updateMany({
      where: {
        id: deliveryId,
        direction: 'outbound',
        status: { in: ['pending', 'failed'] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        ...(opts.expectedAttempt ? { attempt: opts.expectedAttempt - 1 } : {}),
        ...(opts.force ? {} : { nextAttemptAt: { lte: new Date(now.getTime() + 1000) } }),
      },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (claim.count !== 1) return null;
    try {
      const d = await db.webhookDelivery.findFirst({ where: { id: deliveryId }, include: { endpoint: true } });
      if (!d) return null;
      const ep = d.endpoint;
      if (ep.deletedAt || !ep.isActive || !ep.url) {
        const stopped = await db.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', nextAttemptAt: null, lockedUntil: null, error: ep.deletedAt ? 'Endpoint deleted' : 'Endpoint is switched off' } });
        await this.publishDelivery(stopped, ep.name);
        return toDeliveryDto(stopped, ep.name);
      }
      return await this.send(d, ep, now);
    } catch (err) {
      await db.webhookDelivery.updateMany({ where: { id: deliveryId }, data: { lockedUntil: null } });
      throw err;
    }
  }

  private secretsFor(ep: EndpointRow, now: Date): string[] {
    const list = [decryptSecret(ep.secretEncrypted)];
    if (ep.previousSecretEncrypted && ep.previousSecretExpiresAt && ep.previousSecretExpiresAt.getTime() > now.getTime()) list.push(decryptSecret(ep.previousSecretEncrypted));
    return list;
  }

  private async send(d: DeliveryRow, ep: EndpointRow, now: Date): Promise<WebhookDelivery> {
    const db = this.prisma.forTenant(d.workspaceId);
    const test = isTestDelivery(d);
    const attemptNo = d.attempt + 1;
    const raw = JSON.stringify(d.requestBody ?? {});
    const t = Math.floor(now.getTime() / 1000);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': OUTBOUND_USER_AGENT,
      'x-vistar-event': d.event ?? WEBHOOK_TEST_EVENT,
      'x-vistar-delivery': d.id,
      'x-vistar-timestamp': String(t),
      'x-vistar-signature': signatureHeader(this.secretsFor(ep, now), t, raw),
      'idempotency-key': d.idempotencyKey ?? d.id,
    };
    const started = Date.now();
    let status: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      const res = await safeFetch({ url: ep.url!, method: 'POST', headers, body: raw, timeoutMs: WEBHOOK_TIMEOUT_MS, maxResponseBytes: WEBHOOK_MAX_RESPONSE_BYTES });
      status = res.status;
      responseBody = res.body;
      if (status < 200 || status >= 300) error = `Endpoint returned HTTP ${status}`;
    } catch (err) {
      error = describeHttpError(err);
    }
    const latencyMs = Date.now() - started;
    const ok = error === null;
    const max = test ? 1 : WEBHOOK_MAX_ATTEMPTS;
    const final = ok || attemptNo >= max;
    const nextAttemptAt = final ? null : new Date(now.getTime() + WEBHOOK_RETRY_DELAYS_SEC[attemptNo - 1]! * 1000);
    const deliveryStatus = ok ? 'success' : final ? (test ? 'failed' : 'dead') : 'failed';
    const attempts = [...attemptsOf(d), { attempt: attemptNo, at: now.toISOString(), ok, responseStatus: status, latencyMs, error }].slice(-20);
    const saved = await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: deliveryStatus,
        attempt: attemptNo,
        attempts: attempts as unknown as Prisma.InputJsonArray,
        requestHeaders: redactHeaders(headers),
        responseStatus: status,
        responseBody,
        latencyMs,
        error,
        nextAttemptAt,
        lockedUntil: null,
      },
    });

    if (!test) await this.track(ep, ok, deliveryStatus === 'dead', error, now);
    else await db.webhookEndpoint.updateMany({ where: { id: ep.id }, data: { lastDeliveryAt: now } });
    await this.publishDelivery(saved, ep.name);
    if (nextAttemptAt) this.schedule(d.id, d.workspaceId, attemptNo + 1, nextAttemptAt.getTime() - Date.now());
    return toDeliveryDto(saved, ep.name);
  }

  /** Failure counters and the auto-disable rule. */
  private async track(ep: EndpointRow, ok: boolean, dead: boolean, error: string | null, now: Date): Promise<void> {
    const db = this.prisma.forTenant(ep.workspaceId);
    const updated = await db.webhookEndpoint.update({
      where: { id: ep.id },
      data: ok
        ? { consecutiveFailures: 0, deadStreak: 0, lastSuccessAt: now, lastDeliveryAt: now }
        : { consecutiveFailures: { increment: 1 }, lastFailureAt: now, lastDeliveryAt: now, ...(dead ? { deadStreak: { increment: 1 } } : {}) },
    });
    if (!dead || updated.deadStreak < WEBHOOK_AUTO_DISABLE_AFTER_DEAD || !updated.isActive) return;
    const reason = `${updated.deadStreak} deliveries in a row failed after every retry${error ? ` (last error: ${error})` : ''}`.slice(0, 300);
    const off = await db.webhookEndpoint.update({ where: { id: ep.id }, data: { isActive: false, disabledAt: now, disabledReason: reason } });
    await publishSafe(this.events, this.logger, 'webhook.endpoint_updated', ep.workspaceId, { endpoint: toEndpointDto(off), reason: 'auto_disabled' }, { actor: SYSTEM_ACTOR });
    await this.notifier.notifyAdmins(ep.workspaceId, {
      type: 'system',
      title: `Webhook "${ep.name}" was switched off`.slice(0, 200),
      body: `${reason}. Fix the receiver, then switch the webhook on again in Webhooks and logs.`.slice(0, 1000),
      path: `/webhooks?endpoint=${ep.id}`,
      data: { kind: 'webhook_disabled', endpointId: ep.id },
    });
  }

  private async publishDelivery(row: DeliveryRow, endpointName: string): Promise<void> {
    await publishSafe(this.events, this.logger, 'webhook.delivery_updated', row.workspaceId, { delivery: toDeliveryDto(row, endpointName) }, { actor: SYSTEM_ACTOR });
  }

  /** Event type check for test sends of a sample event. */
  static isOutboundEvent(e: string): e is OutboundWebhookEvent {
    return OUTBOUND.has(e);
  }
}
