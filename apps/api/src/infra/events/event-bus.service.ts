import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS_CHANNEL, parseDomainEvent, type DomainEvent, type EventActor, type EventName, type EventPayload } from '@vistar/shared';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getEnv } from '../../config/env.js';
import { createRedis } from '../redis/redis.module.js';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Domain event bus.
 * - publish() AFTER the DB transaction commits, never inside a $transaction callback.
 * - With REDIS_URL: events go through Redis pub/sub channel `vistar:events`, so every API instance,
 *   worker and the simulator see them. Without Redis: in-process only (tests, quick dev).
 * - Subscribers receive every event (including ones this process published).
 * - Side effects that must run exactly once (outbound webhooks, workflow triggers) must enqueue a
 *   BullMQ job with a deterministic jobId (e.g. `${event.id}:${endpointId}`) for dedupe.
 */
@Injectable()
export class EventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private readonly local = new EventEmitter().setMaxListeners(100);
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  /** Outside production every event is validated against the shared contract. */
  private readonly validate = getEnv().NODE_ENV !== 'production';

  async onModuleInit(): Promise<void> {
    this.pub = createRedis('pubsub');
    this.sub = createRedis('pubsub');
    if (!this.sub) {
      this.logger.warn('REDIS_URL not set: event bus is in-process only');
      return;
    }
    await this.sub.subscribe(EVENT_BUS_CHANNEL);
    this.sub.on('message', (channel, raw) => {
      if (channel !== EVENT_BUS_CHANNEL) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        this.local.emit('event', this.validate ? parseDomainEvent(parsed) : (parsed as DomainEvent));
      } catch (err) {
        this.logger.error(`Dropped malformed event: ${(err as Error).message}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.pub?.quit().catch(() => undefined), this.sub?.quit().catch(() => undefined)]);
  }

  async publish<E extends EventName>(
    type: E,
    workspaceId: string,
    payload: EventPayload<E>,
    opts: { actor?: EventActor | null; userId?: string | null } = {},
  ): Promise<DomainEvent<E>> {
    const event: DomainEvent<E> = {
      id: randomUUID(),
      type,
      workspaceId,
      occurredAt: new Date().toISOString(),
      actor: opts.actor ?? null,
      userId: opts.userId ?? null,
      payload,
    };
    if (this.validate) parseDomainEvent(event); // throws on contract violations (caller bug)
    if (this.pub) await this.pub.publish(EVENT_BUS_CHANNEL, JSON.stringify(event));
    else this.local.emit('event', event);
    return event;
  }

  /** Subscribe to all events. Returns an unsubscribe function. Handler errors are logged, not thrown. */
  subscribe(handler: EventHandler): () => void {
    const wrapped = (event: DomainEvent) => {
      Promise.resolve(handler(event)).catch((err: Error) => this.logger.error(`Handler failed for ${event.type}: ${err.message}`, err.stack));
    };
    this.local.on('event', wrapped);
    return () => this.local.off('event', wrapped);
  }
}
