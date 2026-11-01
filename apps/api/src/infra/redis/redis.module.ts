import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getEnv } from '../../config/env.js';

export const REDIS = Symbol('REDIS');

/**
 * Create a Redis connection. BullMQ workers/queues need their own connections with
 * `maxRetriesPerRequest: null` (use purpose 'bullmq'). Returns null when REDIS_URL is unset.
 */
export function createRedis(purpose: 'default' | 'bullmq' | 'pubsub' = 'default'): Redis | null {
  const url = getEnv().REDIS_URL;
  if (!url) return null;
  return new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: purpose === 'bullmq' ? null : 3,
    enableReadyCheck: true,
    connectionName: `vistar-${purpose}`,
  });
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}
  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}

/** Shared general-purpose Redis client (cache, rate limits, presence, idempotency keys). */
@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: () => createRedis('default') }, RedisLifecycle],
  exports: [REDIS],
})
export class RedisModule {}
