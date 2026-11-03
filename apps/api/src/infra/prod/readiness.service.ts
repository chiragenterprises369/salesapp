import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from '../../config/env.js';
import { StorageService } from '../../modules/storage/storage.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { REDIS } from '../redis/redis.module.js';
import { appVersion } from './prod-env.js';

export interface Readiness {
  ok: boolean;
  db: boolean;
  redis: boolean;
  storage: boolean;
  draining: boolean;
  version: string;
  uptimeSec: number;
}

/** Optional storage probe exposed by StorageService (CONFIG-API, request P5). */
interface StorageHealth {
  healthCheck(): Promise<{ ok: boolean; driver?: string; message?: string }>;
}

const PROBE_TIMEOUT_MS = 2_000;
const STORAGE_CACHE_MS = 30_000;

function withTimeout<T>(p: Promise<T>, fallback: T, ms = PROBE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    t.unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/**
 * Readiness (change #20): database (SELECT 1), Redis (PING; required in production, optional in development) and
 * storage (the storage service's own probe when it has one, else the local folder is writable or S3 settings are
 * present), plus the draining flag set on SIGTERM. Liveness stays /api/health.
 */
@Injectable()
export class ReadinessService {
  private draining = false;
  private storageCache: { at: number; ok: boolean } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis | null,
    private readonly moduleRef: ModuleRef,
  ) {}

  startDraining(): void {
    this.draining = true;
  }

  isDraining(): boolean {
    return this.draining;
  }

  async check(): Promise<Readiness> {
    const env = getEnv();
    const [db, redis, storage] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`.then(() => true), false),
      this.redis ? withTimeout(this.redis.ping().then((r) => r === 'PONG'), false) : Promise.resolve(env.NODE_ENV !== 'production'),
      this.storageOk(),
    ]);
    return { ok: db && redis && storage && !this.draining, db, redis, storage, draining: this.draining, version: appVersion(), uptimeSec: Math.round(process.uptime()) };
  }

  private async storageOk(): Promise<boolean> {
    if (this.storageCache && Date.now() - this.storageCache.at < STORAGE_CACHE_MS) return this.storageCache.ok;
    const ok = await withTimeout(this.probeStorage(), false, 5_000);
    this.storageCache = { at: Date.now(), ok };
    return ok;
  }

  private async probeStorage(): Promise<boolean> {
    const service = this.storageService();
    if (service) return (await service.healthCheck()).ok;
    const env = getEnv();
    if (env.STORAGE_DRIVER === 's3') return !!(env.S3_BUCKET && env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
    const root = env.STORAGE_LOCAL_ROOT ? path.resolve(env.STORAGE_LOCAL_ROOT) : null;
    if (!root) return env.NODE_ENV !== 'production';
    await mkdir(root, { recursive: true });
    await access(root, fsConstants.W_OK);
    return true;
  }

  private storageService(): StorageHealth | null {
    try {
      const candidate = this.moduleRef.get(StorageService, { strict: false }) as unknown as Partial<StorageHealth> | null;
      return candidate && typeof candidate.healthCheck === 'function' ? (candidate as StorageHealth) : null;
    } catch {
      return null;
    }
  }
}
