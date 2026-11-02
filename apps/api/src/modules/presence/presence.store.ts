import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../../infra/redis/redis.module.js';
import type { PresenceState } from './engine/status-engine.js';

/**
 * Redis storage for presence (shared by every API instance):
 *   vistar:presence:state:<workspaceId>:<userId>  JSON PresenceState (7 day TTL, refreshed on write)
 *   vistar:presence:due                           sorted set, member "<workspaceId>:<userId>", score = next deadline (ms)
 *   vistar:presence:lock:<userId>                 per-user mutex (SET NX PX), so one instance applies one input at a time
 *   vistar:presence:sweeper                       sweeper lease (SET NX PX): one sweep per tick across instances
 * Without Redis (tests, quick dev) everything lives in process memory with the same semantics.
 */
const STATE_TTL_SEC = 7 * 24 * 3600;
const LOCK_TTL_MS = 3_000;
const LOCK_WAIT_MS = LOCK_TTL_MS + 500;
const K = {
  state: (wid: string, uid: string) => `vistar:presence:state:${wid}:${uid}`,
  due: 'vistar:presence:due',
  lock: (uid: string) => `vistar:presence:lock:${uid}`,
  sweeper: 'vistar:presence:sweeper',
};
const RELEASE_LUA = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export const dueMember = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;
export function parseDueMember(member: string): { workspaceId: string; userId: string } | null {
  const i = member.indexOf(':');
  if (i <= 0) return null;
  return { workspaceId: member.slice(0, i), userId: member.slice(i + 1) };
}

@Injectable()
export class PresenceStore {
  private readonly memState = new Map<string, string>();
  private readonly memDue = new Map<string, number>();
  private readonly memLocks = new Map<string, string>();
  private memSweeperUntil = 0;
  /** In-process queue per user: inputs of one user never race inside this process. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  private client(): Redis | null {
    return this.redis && this.redis.status === 'ready' ? this.redis : null;
  }

  get usingRedis(): boolean {
    return this.client() !== null;
  }

  async read(workspaceId: string, userId: string): Promise<PresenceState | null> {
    const r = this.client();
    const raw = r ? await r.get(K.state(workspaceId, userId)) : (this.memState.get(K.state(workspaceId, userId)) ?? null);
    return raw ? (JSON.parse(raw) as PresenceState) : null;
  }

  async readMany(workspaceId: string, userIds: readonly string[]): Promise<Map<string, PresenceState>> {
    const out = new Map<string, PresenceState>();
    if (!userIds.length) return out;
    const keys = userIds.map((u) => K.state(workspaceId, u));
    const r = this.client();
    const raws = r ? await r.mget(...keys) : keys.map((k) => this.memState.get(k) ?? null);
    raws.forEach((raw, i) => {
      if (raw) out.set(userIds[i]!, JSON.parse(raw) as PresenceState);
    });
    return out;
  }

  /**
   * Read-modify-write one user's state under the per-user lock. `fn` gets the current state (null =
   * none yet) and returns the next state and its deadline (null = nothing pending), or null to skip.
   */
  async mutate<T>(
    workspaceId: string,
    userId: string,
    fn: (current: PresenceState | null) => Promise<{ state: PresenceState; deadline: number | null; result: T } | null>,
  ): Promise<T | null> {
    const key = `${workspaceId}:${userId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.locked(workspaceId, userId, fn));
    this.chains.set(key, run);
    try {
      return await run;
    } finally {
      if (this.chains.get(key) === run) this.chains.delete(key);
    }
  }

  private async locked<T>(
    workspaceId: string,
    userId: string,
    fn: (current: PresenceState | null) => Promise<{ state: PresenceState; deadline: number | null; result: T } | null>,
  ): Promise<T | null> {
    const token = await this.acquire(userId);
    try {
      const current = await this.read(workspaceId, userId);
      const next = await fn(current);
      if (!next) return null;
      await this.write(workspaceId, userId, next.state, next.deadline);
      return next.result;
    } finally {
      await this.release(userId, token);
    }
  }

  private async write(workspaceId: string, userId: string, state: PresenceState, deadline: number | null): Promise<void> {
    const raw = JSON.stringify(state);
    const member = dueMember(workspaceId, userId);
    const r = this.client();
    if (r) {
      const tx = r.multi().set(K.state(workspaceId, userId), raw, 'EX', STATE_TTL_SEC);
      if (deadline === null) tx.zrem(K.due, member);
      else tx.zadd(K.due, deadline, member);
      await tx.exec();
      return;
    }
    this.memState.set(K.state(workspaceId, userId), raw);
    if (deadline === null) this.memDue.delete(member);
    else this.memDue.set(member, deadline);
  }

  private async acquire(userId: string): Promise<string> {
    const token = randomUUID();
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const r = this.client();
      if (r) {
        if ((await r.set(K.lock(userId), token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK') return token;
      } else if (!this.memLocks.has(userId)) {
        this.memLocks.set(userId, token);
        return token;
      }
      if (Date.now() - started > LOCK_WAIT_MS) {
        // The holder crashed or Redis is slow: the PX expiry frees the lock within LOCK_TTL_MS.
        throw new Error('presence lock busy');
      }
      await new Promise((res) => setTimeout(res, Math.min(50, 5 + attempt * 5)));
    }
  }

  private async release(userId: string, token: string): Promise<void> {
    const r = this.client();
    if (r) {
      await r.eval(RELEASE_LUA, 1, K.lock(userId), token).catch(() => undefined);
      return;
    }
    if (this.memLocks.get(userId) === token) this.memLocks.delete(userId);
  }

  /** Members whose deadline has passed (oldest first). */
  async due(now: number, limit = 500): Promise<Array<{ workspaceId: string; userId: string }>> {
    const r = this.client();
    const members = r
      ? await r.zrangebyscore(K.due, '-inf', now, 'LIMIT', 0, limit)
      : [...this.memDue.entries()].filter(([, t]) => t <= now).sort((a, b) => a[1] - b[1]).slice(0, limit).map(([m]) => m);
    return members.map(parseDueMember).filter((m): m is { workspaceId: string; userId: string } => m !== null);
  }

  /** Lease for one sweep. Several instances may race; exactly one wins per period. */
  async acquireSweeper(periodMs: number): Promise<boolean> {
    const r = this.client();
    if (r) return (await r.set(K.sweeper, randomUUID(), 'PX', Math.max(100, periodMs - 200), 'NX')) === 'OK';
    const now = Date.now();
    if (now < this.memSweeperUntil) return false;
    this.memSweeperUntil = now + Math.max(100, periodMs - 200);
    return true;
  }

  /** Test helper: forget everything for a workspace (memory and Redis). */
  async clearWorkspace(workspaceId: string): Promise<void> {
    for (const k of [...this.memState.keys()]) if (k.startsWith(`vistar:presence:state:${workspaceId}:`)) this.memState.delete(k);
    for (const m of [...this.memDue.keys()]) if (m.startsWith(`${workspaceId}:`)) this.memDue.delete(m);
    const r = this.client();
    if (!r) return;
    const keys = await r.keys(`vistar:presence:state:${workspaceId}:*`);
    if (keys.length) await r.del(...keys);
    const members = (await r.zrange(K.due, 0, -1)).filter((m) => m.startsWith(`${workspaceId}:`));
    if (members.length) await r.zrem(K.due, ...members);
  }
}
