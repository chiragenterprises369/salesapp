import { Inject, Injectable } from '@nestjs/common';
import { CAPTURE_RATE_LIMITS } from '@vistar/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.module.js';

/**
 * Fixed-window counters for public form submissions (CAPTURE_RATE_LIMITS): per IP and form per minute and
 * per hour, and per form per minute. Redis when configured (shared by API instances), else in memory.
 */
@Injectable()
export class CaptureRateLimiter {
  private readonly memory = new Map<string, { count: number; until: number }>();

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  private async hit(key: string, ttlSec: number): Promise<number> {
    if (this.redis) {
      try {
        const n = await this.redis.incr(key);
        if (n === 1) await this.redis.expire(key, ttlSec);
        return n;
      } catch {
        // fall through to memory: a Redis hiccup must not open the form to floods
      }
    }
    const now = Date.now();
    const cur = this.memory.get(key);
    if (!cur || cur.until <= now) {
      if (this.memory.size > 50_000) this.memory.clear();
      this.memory.set(key, { count: 1, until: now + ttlSec * 1000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }

  /** true = allowed. Every call counts (also the rejected ones). */
  async allow(formId: string, ipHash: string, now = Date.now()): Promise<boolean> {
    const minute = Math.floor(now / 60_000);
    const hour = Math.floor(now / 3_600_000);
    const [perMinute, perHour, perForm] = await Promise.all([
      this.hit(`vistar:capture:${formId}:ip:${ipHash}:m:${minute}`, 70),
      this.hit(`vistar:capture:${formId}:ip:${ipHash}:h:${hour}`, 3_700),
      this.hit(`vistar:capture:${formId}:all:m:${minute}`, 70),
    ]);
    return perMinute <= CAPTURE_RATE_LIMITS.perIpPerMinute && perHour <= CAPTURE_RATE_LIMITS.perIpPerHour && perForm <= CAPTURE_RATE_LIMITS.perFormPerMinute;
  }
}
