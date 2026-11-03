import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IndiamartConfigSchema } from '@vistar/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { describeHttpError } from '../../infra/http/safe-http.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { IntegrationStore, type IntegrationRow } from './integration-store.js';
import { integrationActor, LeadIntakeService } from './lead-intake.service.js';
import { INDIAMART_MIN_INTERVAL_MS, pullLive, pullMock, pullWindow, recordsOf, recordToLead, type IndiamartRecord } from './providers/indiamart.js';

export interface IndiamartSyncOutcome {
  ok: boolean;
  message: string;
  fetched: number;
  created: number;
  skipped: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  row: IntegrationRow;
}

interface SyncState {
  lastWindowEnd?: string;
  lastPullAt?: string;
}

const SYNC_LEASE_MS = 2 * 60_000;
const ERROR_BACKOFF_MS = 15 * 60_000;

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * IndiaMART Lead Manager: pull (cron per connected workspace every pullIntervalMin, min 5; "Sync now") and the push
 * receiver. Each enquiry becomes a routed lead (source indiamart, sourceRef = UNIQUE_QUERY_ID; repeats are skipped).
 * One pull at a time per workspace (syncLockedUntil claim), and never two within 5 minutes (IndiaMART rule).
 */
@Injectable()
export class IndiamartService {
  private readonly logger = new Logger(IndiamartService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IntegrationStore,
    private readonly intake: LeadIntakeService,
  ) {}

  private async ingest(workspaceId: string, row: IntegrationRow, records: IndiamartRecord[], via: 'pull' | 'push'): Promise<{ created: number; skipped: number; lastLeadId: string | null; duplicate: boolean }> {
    const cfg = IndiamartConfigSchema.partial().safeParse(row.config);
    const tags = ['indiamart', ...((cfg.success ? cfg.data.tags : undefined) ?? [])];
    const actor = integrationActor(row.id, via === 'push' ? 'IndiaMART push' : 'IndiaMART');
    let created = 0;
    let skipped = 0;
    let lastLeadId: string | null = null;
    let duplicate = false;
    for (const r of records) {
      try {
        const res = await this.intake.create(workspaceId, recordToLead(r, tags), { source: 'indiamart', actor });
        if (res.created) created++;
        else skipped++;
        duplicate = res.duplicate;
        lastLeadId = res.leadId;
      } catch (err) {
        skipped++;
        this.logger.warn(`IndiaMART record skipped (${(err as { code?: string }).code ?? (err as Error).name})`);
      }
    }
    return { created, skipped, lastLeadId, duplicate };
  }

  private async leads30d(workspaceId: string): Promise<number> {
    return this.store.db(workspaceId).lead.count({ where: { source: 'indiamart', deletedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
  }

  /**
   * One pull. `manual` (Sync now / connect test): 429 RATE_LIMITED within 5 minutes of the last pull; the cron just skips.
   * Status: connected after a good pull, needs_attention on IndiaMART's rate limit, error otherwise (retried after a back-off).
   */
  async pull(workspaceId: string, manual: boolean): Promise<IndiamartSyncOutcome | null> {
    const db = this.store.db(workspaceId);
    const row = await db.integration.findFirst({ where: { provider: 'indiamart' } });
    if (!row || row.status === 'not_connected') throw new AppException('INTEGRATION_NOT_CONNECTED', 'Connect IndiaMART first');
    const state = (row.syncState ?? {}) as SyncState;
    const now = new Date();
    const lastPullAt = state.lastPullAt ? new Date(state.lastPullAt) : null;
    if (lastPullAt && now.getTime() - lastPullAt.getTime() < INDIAMART_MIN_INTERVAL_MS) {
      if (!manual) return null;
      const wait = Math.ceil((INDIAMART_MIN_INTERVAL_MS - (now.getTime() - lastPullAt.getTime())) / 60_000);
      throw new AppException('RATE_LIMITED', `IndiaMART allows one pull every 5 minutes. Try again in ${wait} min`);
    }
    // Claim (one pull at a time across API instances).
    const claimed = await db.integration.updateMany({
      where: { id: row.id, OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }] },
      data: { syncLockedUntil: new Date(now.getTime() + SYNC_LEASE_MS) },
    });
    if (claimed.count !== 1) {
      if (!manual) return null;
      throw new AppException('CONFLICT', 'A pull is already running. Try again in a minute');
    }
    const { start, end } = pullWindow(state.lastWindowEnd ? new Date(state.lastWindowEnd) : null, now);
    const cfg = IndiamartConfigSchema.safeParse(row.config);
    const intervalMs = Math.max(5, cfg.success ? cfg.data.pullIntervalMin : 15) * 60_000;
    const pullEnabled = cfg.success ? cfg.data.pullEnabled : true;
    try {
      let result;
      try {
        result =
          row.mode === 'mock'
            ? pullMock(workspaceId, start, end)
            : await pullLive(getEnv().INDIAMART_API_URL, this.store.secretsOf(row).crmKey ?? '', start, end);
      } catch (err) {
        result = { code: 0, message: describeHttpError(err), records: [] };
      }
      const okCodes = result.code === 200 || result.code === 204;
      const ingest = okCodes ? await this.ingest(workspaceId, row, result.records, 'pull') : { created: 0, skipped: 0, lastLeadId: null, duplicate: false };
      const message = okCodes
        ? result.records.length
          ? `${ingest.created} new lead${ingest.created === 1 ? '' : 's'} from ${result.records.length} enquir${result.records.length === 1 ? 'y' : 'ies'}${ingest.skipped ? ` (${ingest.skipped} already imported)` : ''}`
          : 'No new enquiries'
        : result.code === 429
          ? 'IndiaMART rate limit: pulls are limited to one every 5 minutes'
          : result.code === 401
            ? `IndiaMART rejected the Pull API key${result.message ? `: ${result.message.slice(0, 160)}` : ''}`
            : `IndiaMART pull failed${result.message ? `: ${result.message.slice(0, 160)}` : ''}`;
      const check = { ok: okCodes, message, latencyMs: null, attention: result.code === 429 ? message : null };
      const stats = { lastPulledCount: result.records.length, lastCreatedCount: ingest.created, leadsImported30d: await this.leads30d(workspaceId) };
      const nextState: SyncState = { lastPullAt: now.toISOString(), lastWindowEnd: okCodes ? end.toISOString() : state.lastWindowEnd };
      const updated = await this.store.applyCheck(db, row, { ...check, stats }, {
        lastSyncAt: now,
        nextSyncAt: pullEnabled ? new Date(now.getTime() + (okCodes ? intervalMs : Math.max(intervalMs, ERROR_BACKOFF_MS))) : null,
        syncState: nextState as Prisma.InputJsonObject,
        syncLockedUntil: null,
      });
      await this.store.publish(workspaceId, updated, 'indiamart');
      return { ok: okCodes, message, fetched: result.records.length, created: ingest.created, skipped: ingest.skipped, windowStart: start, windowEnd: end, row: updated };
    } catch (err) {
      await db.integration.updateMany({ where: { id: row.id }, data: { syncLockedUntil: null } });
      throw err;
    }
  }

  /** Cron: every minute, pull the workspaces whose nextSyncAt passed (HUB_BACKGROUND_JOBS=on). */
  @Interval('indiamart-pull', 60_000)
  async tick(): Promise<void> {
    if (getEnv().HUB_BACKGROUND_JOBS !== 'on' || this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.integration.findMany({
        where: { provider: 'indiamart', status: { not: 'not_connected' }, nextSyncAt: { lte: new Date() }, OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: new Date() } }] },
        select: { workspaceId: true },
        orderBy: { nextSyncAt: 'asc' },
        take: 20,
      });
      for (const { workspaceId } of due) {
        try {
          await this.pull(workspaceId, false);
        } catch (err) {
          this.logger.warn(`IndiaMART pull for a workspace failed: ${(err as { code?: string }).code ?? (err as Error).name}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Push API receiver: key in ?key= (constant-time), body { CODE, STATUS, RESPONSE: {...} }. */
  async receivePush(workspaceId: string, key: string | undefined, body: unknown): Promise<{ ok: true; duplicate: boolean; leadId: string | null }> {
    const db = this.store.db(workspaceId);
    const row = await db.integration.findFirst({ where: { provider: 'indiamart' } }).catch(() => null);
    if (!row || row.status === 'not_connected') throw notFound('Source');
    const token = this.store.tokensOf(row).pushKey;
    if (!key || !token || !safeEqual(key, token)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid push key');
    const cfg = IndiamartConfigSchema.partial().safeParse(row.config);
    if (cfg.success && cfg.data.pushEnabled === false) throw new AppException('WEBHOOK_ENDPOINT_DISABLED', 'IndiaMART push is turned off for this workspace');
    const records = recordsOf(body);
    if (!records.length) throw new AppException('VALIDATION_FAILED', 'No IndiaMART lead in the body (expected RESPONSE with UNIQUE_QUERY_ID)');
    const res = await this.ingest(workspaceId, row, records, 'push');
    const stats = { ...((row.stats ?? {}) as Record<string, unknown>), lastPushAt: new Date().toISOString(), leadsImported30d: await this.leads30d(workspaceId) };
    const updated = await db.integration.update({ where: { id: row.id }, data: { stats: stats as Prisma.InputJsonObject, lastSyncAt: new Date() } });
    await this.store.publish(workspaceId, updated, 'indiamart');
    return { ok: true, duplicate: res.created === 0 && res.duplicate, leadId: res.lastLeadId };
  }
}
