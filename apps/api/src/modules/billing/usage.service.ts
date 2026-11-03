import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  MONTHLY_USAGE_METRICS,
  planLimitFor,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  usagePeriodOf,
  usageState,
  type BillingUsage,
  type PlanDefinition,
  type UsageMeter,
  type UsageMetric,
} from '@vistar/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

const MB = 1024 * 1024;
const FLUSH_MS = 30_000;

/** First instant of the current calendar month in India time (UTC Date). */
export function istMonthStart(now: Date = new Date()): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

/**
 * Usage metering (D-072). Totals (seats = active users, leads, storage, API keys) and this month's WhatsApp
 * messages (outbound, not internal notes) and workflow runs (not tests) are counted from the tables, so the
 * numbers always equal the database. API calls (requests made with an API key) are counted by
 * ApiCallMeterInterceptor into UsageCounter (metric api_calls), buffered per instance and flushed every 30 s.
 * The daily reconcile writes every metric into UsageCounter for the Super Admin and history.
 */
@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageService.name);
  private readonly apiCalls = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.flushApiCalls(), FLUSH_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flushApiCalls();
  }

  /** Count one request made with an API key (cheap: in memory until the next flush). */
  countApiCall(workspaceId: string): void {
    this.apiCalls.set(workspaceId, (this.apiCalls.get(workspaceId) ?? 0) + 1);
  }

  async flushApiCalls(): Promise<void> {
    if (!this.apiCalls.size) return;
    const batch = [...this.apiCalls.entries()];
    this.apiCalls.clear();
    const period = usagePeriodOf();
    for (const [workspaceId, value] of batch) {
      try {
        await this.prisma.usageCounter.upsert({
          where: { workspaceId_period_metric: { workspaceId, period, metric: 'api_calls' } },
          create: { workspaceId, period, metric: 'api_calls', value },
          update: { value: { increment: value } },
        });
      } catch (err) {
        // workspace deleted meanwhile, or the database is briefly away: keep the count for the next flush
        if ((err as { code?: string }).code !== 'P2003') this.apiCalls.set(workspaceId, (this.apiCalls.get(workspaceId) ?? 0) + value);
        this.logger.warn(`API call usage not saved yet: ${(err as Error).name}`);
      }
    }
  }

  /** Current value of one metric. Seats here = active users (pending invites are added by the seat check). */
  async used(workspaceId: string, metric: UsageMetric, now: Date = new Date()): Promise<number> {
    const db = this.prisma.forTenant(workspaceId);
    const since = istMonthStart(now);
    switch (metric) {
      case 'seats':
        return db.user.count({ where: { isActive: true, deletedAt: null } });
      case 'leads':
        return db.lead.count({ where: { deletedAt: null } });
      case 'storage_mb': {
        const agg = await db.file.aggregate({ where: { deletedAt: null }, _sum: { size: true } });
        return Math.ceil((agg._sum.size ?? 0) / MB);
      }
      case 'api_keys':
        return db.apiKey.count({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
      case 'whatsapp_messages':
        return db.message.count({ where: { direction: 'outbound', isInternalNote: false, createdAt: { gte: since }, conversation: { channel: 'whatsapp' } } });
      case 'workflow_runs':
        return db.workflowRun.count({ where: { isTest: false, startedAt: { gte: since } } });
      case 'api_calls': {
        const row = await db.usageCounter.findFirst({ where: { period: usagePeriodOf(now), metric: 'api_calls' }, select: { value: true } });
        return (row?.value ?? 0) + (this.apiCalls.get(workspaceId) ?? 0);
      }
    }
  }

  /** Seats taken or reserved: active users plus pending, unexpired invites. */
  async seatsReserved(workspaceId: string, now: Date = new Date()): Promise<number> {
    const db = this.prisma.forTenant(workspaceId);
    const [users, invites] = await Promise.all([
      db.user.count({ where: { isActive: true, deletedAt: null } }),
      db.invite.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    return users + invites;
  }

  meter(metric: UsageMetric, used: number, plan: PlanDefinition, extraSeats: number): UsageMeter {
    const limit = planLimitFor(plan.limits, metric, extraSeats);
    const { percent, state } = usageState(used, limit);
    return {
      metric,
      label: USAGE_METRIC_LABELS[metric],
      unit: metric === 'storage_mb' ? 'mb' : 'count',
      window: MONTHLY_USAGE_METRICS.includes(metric) ? 'month' : 'total',
      used,
      limit,
      percent,
      state,
    };
  }

  async usage(workspaceId: string, plan: PlanDefinition, extraSeats: number, now: Date = new Date()): Promise<BillingUsage> {
    const values = await Promise.all(USAGE_METRICS.map((m) => this.used(workspaceId, m, now)));
    return {
      period: usagePeriodOf(now),
      meters: USAGE_METRICS.map((m, i) => this.meter(m, values[i]!, plan, extraSeats)),
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Daily snapshot into UsageCounter for every live workspace (one grouped query per metric, one upsert
   * statement). api_calls is left alone (it is counted live). Returns the snapshot for usage alerts.
   */
  async reconcile(now: Date = new Date()): Promise<Map<string, Record<UsageMetric, number>>> {
    await this.flushApiCalls();
    const period = usagePeriodOf(now);
    const since = istMonthStart(now);
    const live = await this.prisma.workspace.findMany({ where: { deletedAt: null, status: { not: 'deleted' } }, select: { id: true } });
    const ids = live.map((w) => w.id);
    const result = new Map<string, Record<UsageMetric, number>>();
    if (!ids.length) return result;
    const inIds = { workspaceId: { in: ids } };
    const [seats, leads, files, keys, messages, runs, calls] = await Promise.all([
      this.prisma.user.groupBy({ by: ['workspaceId'], where: { ...inIds, isActive: true, deletedAt: null }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['workspaceId'], where: { ...inIds, deletedAt: null }, _count: { _all: true } }),
      this.prisma.file.groupBy({ by: ['workspaceId'], where: { ...inIds, deletedAt: null }, _sum: { size: true } }),
      this.prisma.apiKey.groupBy({ by: ['workspaceId'], where: { ...inIds, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, _count: { _all: true } }),
      this.prisma.message.groupBy({ by: ['workspaceId'], where: { ...inIds, direction: 'outbound', isInternalNote: false, createdAt: { gte: since }, conversation: { channel: 'whatsapp' } }, _count: { _all: true } }),
      this.prisma.workflowRun.groupBy({ by: ['workspaceId'], where: { ...inIds, isTest: false, startedAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.usageCounter.findMany({ where: { ...inIds, period, metric: 'api_calls' }, select: { workspaceId: true, value: true } }),
    ]);
    const count = (rows: Array<{ workspaceId: string; _count: { _all: number } }>) => new Map(rows.map((r) => [r.workspaceId, r._count._all]));
    const bySeats = count(seats);
    const byLeads = count(leads);
    const byKeys = count(keys);
    const byMessages = count(messages);
    const byRuns = count(runs);
    const byFiles = new Map(files.map((r) => [r.workspaceId, Math.ceil((r._sum.size ?? 0) / MB)]));
    const byCalls = new Map(calls.map((r) => [r.workspaceId, r.value]));
    const w: string[] = [];
    const m: string[] = [];
    const v: number[] = [];
    for (const id of ids) {
      const values: Record<UsageMetric, number> = {
        seats: bySeats.get(id) ?? 0,
        leads: byLeads.get(id) ?? 0,
        storage_mb: byFiles.get(id) ?? 0,
        api_keys: byKeys.get(id) ?? 0,
        whatsapp_messages: byMessages.get(id) ?? 0,
        workflow_runs: byRuns.get(id) ?? 0,
        api_calls: byCalls.get(id) ?? 0,
      };
      result.set(id, values);
      for (const metric of USAGE_METRICS) {
        if (metric === 'api_calls') continue;
        w.push(id);
        m.push(metric);
        v.push(values[metric]);
      }
    }
    for (let i = 0; i < w.length; i += 3000) {
      await this.prisma.$executeRaw`
        INSERT INTO "UsageCounter" ("id", "workspaceId", "period", "metric", "value", "updatedAt")
        SELECT gen_random_uuid(), t.w, ${period}, t.m, t.v, now()
        FROM unnest(${w.slice(i, i + 3000)}::uuid[], ${m.slice(i, i + 3000)}::text[], ${v.slice(i, i + 3000)}::int[]) AS t(w, m, v)
        ON CONFLICT ("workspaceId", "period", "metric") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
    }
    return result;
  }
}
