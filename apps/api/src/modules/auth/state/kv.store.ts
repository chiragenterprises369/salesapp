import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../../infra/redis/redis.module.js';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/**
 * Small TTL key-value store for auth state (status cache, revoked session families, 2FA challenge
 * nonces). Uses Redis when it is configured and connected; otherwise (or if a Redis call fails) it
 * falls back to process memory, so the API keeps working without Redis.
 */
@Injectable()
export class KvStore {
  private readonly logger = new Logger(KvStore.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private lastWarnAt = 0;

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  private client(): Redis | null {
    return this.redis && this.redis.status === 'ready' ? this.redis : null;
  }

  private warn(op: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = now;
    this.logger.warn(`Redis ${op} failed (${(err as Error).name}); using in-memory auth state`);
  }

  private memGet(key: string): string | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return entry.value;
  }

  private memSet(key: string, value: string, ttlSec: number): void {
    if (this.memory.size > 20_000) {
      const now = Date.now();
      for (const [k, v] of this.memory) if (v.expiresAt <= now) this.memory.delete(k);
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  async mget(keys: string[]): Promise<Array<string | null>> {
    const r = this.client();
    if (r && keys.length) {
      try {
        return await r.mget(...keys);
      } catch (err) {
        this.warn('mget', err);
      }
    }
    return keys.map((k) => this.memGet(k));
  }

  async get(key: string): Promise<string | null> {
    const [v] = await this.mget([key]);
    return v ?? null;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    const r = this.client();
    if (r) {
      try {
        await r.set(key, value, 'EX', ttlSec);
        return;
      } catch (err) {
        this.warn('set', err);
      }
    }
    this.memSet(key, value, ttlSec);
  }

  /** Set only if absent. Returns true when this call created the key. */
  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    const r = this.client();
    if (r) {
      try {
        return (await r.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
      } catch (err) {
        this.warn('set NX', err);
      }
    }
    if (this.memGet(key) !== null) return false;
    this.memSet(key, value, ttlSec);
    return true;
  }

  /** Increment a counter; the TTL starts with the first increment. */
  async incr(key: string, ttlSec: number): Promise<number> {
    const r = this.client();
    if (r) {
      try {
        const n = await r.incr(key);
        if (n === 1) await r.expire(key, ttlSec);
        return n;
      } catch (err) {
        this.warn('incr', err);
      }
    }
    const entry = this.memory.get(key);
    const current = entry && entry.expiresAt > Date.now() ? Number(entry.value) : 0;
    const next = current + 1;
    if (entry && entry.expiresAt > Date.now()) entry.value = String(next);
    else this.memSet(key, String(next), ttlSec);
    return next;
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    for (const k of keys) this.memory.delete(k);
    const r = this.client();
    if (r) {
      try {
        await r.del(...keys);
      } catch (err) {
        this.warn('del', err);
      }
    }
  }
}
