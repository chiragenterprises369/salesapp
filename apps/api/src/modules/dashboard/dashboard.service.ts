import { Injectable } from '@nestjs/common';
import {
  formatDuration,
  type AttentionItem,
  type DashboardQuery,
  type DashboardSummary,
  type FeedItem,
  type LeadSource,
  type UserSummary,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant, type TenantPrisma } from '../../infra/prisma/tenant.js';
import type { TenantDb } from '../leads/lib/context.js';
import { addZonedDays, startOfNextZonedMonth, startOfZonedDay, startOfZonedMonth, zonedMonthKey } from '../leads/lib/tz.js';
import { overdueAttention, overdueWhere, TASK_INCLUDE } from '../tasks/task.mapper.js';
import { workspaceTimezone } from '../tasks/tasks.service.js';
import { DashboardSql, type UserFilter } from './dashboard.sql.js';

const DAY_MS = 86_400_000;
const SPARK_POINTS = 7;
const SALES_KINDS = ['employee', 'manager'] as const;
const SOURCE_LABEL: Record<LeadSource, string> = {
  indiamart: 'IndiaMART',
  website: 'the website',
  whatsapp: 'WhatsApp',
  manual: 'manual entry',
  webhook: 'a webhook',
  import: 'an import',
  api: 'the API',
};

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /**
   * Users whose records the dashboard aggregates: the caller's data scope, narrowed to one team when
   * `teamId` is given. null = whole workspace.
   */
  async subjectUsers(db: TenantPrisma, auth: AuthContext, teamId?: string): Promise<UserFilter> {
    const visible = await this.scope.visibleUserIds(auth);
    if (!teamId) return visible;
    await assertInTenant(db, { team: teamId });
    const members = (await db.user.findMany({ where: { OR: [{ teamId }, { managedTeams: { some: { id: teamId } } }] }, select: { id: true } })).map((u) => u.id);
    return visible === null ? members : members.filter((id) => visible.includes(id));
  }

  async summary(auth: AuthContext, q: DashboardQuery): Promise<DashboardSummary> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const tz = await workspaceTimezone(db);
    const now = new Date();
    const from = q.from ? new Date(q.from) : startOfZonedDay(now, tz);
    const to = q.to ? new Date(q.to) : addZonedDays(now, 1, tz);
    if (to.getTime() <= from.getTime()) throw new AppException('VALIDATION_FAILED', 'The end of the range must be after its start', { details: [{ path: 'to', message: 'Must be after from' }] });
    const len = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - len);
    const compare = q.compare === 'previous_period';
    // One-day ranges show the trailing 7 periods (days); longer ranges are split into 7 equal parts.
    const sparkStart = len <= DAY_MS ? new Date(to.getTime() - SPARK_POINTS * len) : from;

    const users = await this.subjectUsers(db, auth, q.teamId);
    const sql = new DashboardSql(this.prisma, wid, users);

    const metric = async <T>(fn: (s: Date, e: Date, n: number) => Promise<T>) => {
      const [cur, prev, spark] = await Promise.all([fn(from, to, 1), compare ? fn(prevFrom, from, 1) : Promise.resolve(null), fn(sparkStart, to, SPARK_POINTS)]);
      return { cur, prev, spark };
    };
    const [leads, calls, closed, revenue, response] = await Promise.all([
      metric((s, e, n) => sql.newLeads(s, e, n)),
      metric((s, e, n) => sql.calls(s, e, n)),
      metric((s, e, n) => sql.closed(s, e, n)),
      metric((s, e, n) => sql.revenue(s, e, n)),
      metric((s, e, n) => sql.response(s, e, n)),
    ]);

    const answeredPct = (c: { total: number[]; answered: number[] }) => pct(sum(c.answered), sum(c.total));
    const conversion = (c: { won: number[]; lost: number[] }) => pct(sum(c.won), sum(c.won) + sum(c.lost));
    const avgResponse = (r: { s: number[]; c: number[] }) => (sum(r.c) ? Math.round(sum(r.s) / sum(r.c)) : 0);
    const kpis: DashboardSummary['kpis'] = {
      newLeads: { value: sum(leads.cur), previous: leads.prev ? sum(leads.prev) : null, sparkline: leads.spark },
      callsToday: { value: sum(calls.cur.total), previous: calls.prev ? sum(calls.prev.total) : null, sparkline: calls.spark.total },
      answeredPct: {
        value: answeredPct(calls.cur),
        previous: calls.prev ? answeredPct(calls.prev) : null,
        sparkline: calls.spark.total.map((t, i) => pct(calls.spark.answered[i] ?? 0, t)),
      },
      conversionPct: {
        value: conversion(closed.cur),
        previous: closed.prev ? conversion(closed.prev) : null,
        sparkline: closed.spark.won.map((w, i) => pct(w, w + (closed.spark.lost[i] ?? 0))),
      },
      revenueInr: { value: sum(revenue.cur), previous: revenue.prev ? sum(revenue.prev) : null, sparkline: revenue.spark },
      avgResponseSec: {
        value: avgResponse(response.cur),
        previous: response.prev ? avgResponse(response.prev) : null,
        sparkline: response.spark.c.map((c, i) => (c ? Math.round((response.spark.s[i] ?? 0) / c) : 0)),
      },
    };

    const leadScope: Prisma.LeadWhereInput = { deletedAt: null, ...(users === null ? {} : { ownerId: { in: users } }) };
    const [funnel, sources, callsPerHour, leaderboard, feed, attention] = await Promise.all([
      this.funnel(db, leadScope),
      this.sources(db, leadScope, from, to),
      sql.callsPerHour(from, to, tz),
      this.leaderboard(db, sql, users, from, to, tz),
      this.feed(db, users),
      this.attention(db, users, now),
    ]);
    return { kpis, funnel, sources, callsPerHour, leaderboard, feed, attention, generatedAt: now.toISOString() };
  }

  /** Current pipeline snapshot (default pipeline), scoped. */
  private async funnel(db: TenantDb, leadScope: Prisma.LeadWhereInput): Promise<DashboardSummary['funnel']> {
    const pipeline =
      (await db.pipeline.findFirst({ where: { isDefault: true, archivedAt: null } })) ?? (await db.pipeline.findFirst({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } }));
    if (!pipeline) return [];
    const [stages, groups] = await Promise.all([
      db.stage.findMany({ where: { pipelineId: pipeline.id, archivedAt: null }, orderBy: { order: 'asc' } }),
      db.lead.groupBy({ by: ['stageId'], where: { ...leadScope, pipelineId: pipeline.id }, _count: { _all: true }, _sum: { valueInr: true } }),
    ]);
    const byStage = new Map(groups.map((g) => [g.stageId, g]));
    return stages.map((s) => ({ stageId: s.id, name: s.name, count: byStage.get(s.id)?._count._all ?? 0, valueInr: byStage.get(s.id)?._sum.valueInr ?? 0 }));
  }

  /** Leads created in the range per source, plus value won in the range per source. */
  private async sources(db: TenantDb, leadScope: Prisma.LeadWhereInput, from: Date, to: Date): Promise<DashboardSummary['sources']> {
    const [created, won] = await Promise.all([
      db.lead.groupBy({ by: ['source'], where: { ...leadScope, createdAt: { gte: from, lt: to } }, _count: { _all: true } }),
      db.lead.groupBy({ by: ['source'], where: { ...leadScope, wonAt: { gte: from, lt: to } }, _sum: { valueInr: true } }),
    ]);
    const out = new Map<LeadSource, { source: LeadSource; count: number; wonValueInr: number }>();
    for (const c of created) out.set(c.source, { source: c.source, count: c._count._all, wonValueInr: 0 });
    for (const w of won) {
      const e = out.get(w.source) ?? { source: w.source, count: 0, wonValueInr: 0 };
      e.wonValueInr = w._sum.valueInr ?? 0;
      out.set(w.source, e);
    }
    return [...out.values()].sort((a, b) => b.count - a.count || b.wonValueInr - a.wonValueInr);
  }

  private async leaderboard(db: TenantDb, sql: DashboardSql, users: UserFilter, from: Date, to: Date, tz: string): Promise<DashboardSummary['leaderboard']> {
    const people = await db.user.findMany({
      where: { isActive: true, deletedAt: null, role: { kind: { in: [...SALES_KINDS] } }, ...(users === null ? {} : { id: { in: users } }) },
      select: USER_SUMMARY_SELECT,
      take: 200,
    });
    if (!people.length) return [];
    const ids = people.map((p) => p.id);
    const monthStart = startOfZonedMonth(from, tz);
    const [won, monthWon, calls, targets] = await Promise.all([
      sql.wonByOwner(from, to),
      sql.wonByOwner(monthStart, startOfNextZonedMonth(from, tz)),
      db.call.groupBy({ by: ['userId'], where: { userId: { in: ids }, startedAt: { gte: from, lt: to } }, _count: { _all: true } }),
      db.target.findMany({ where: { metric: 'revenue_inr', period: zonedMonthKey(from, tz), subjectKey: { in: ids.map((id) => `user:${id}`) } } }),
    ]);
    const callsBy = new Map(calls.map((c) => [c.userId, c._count._all]));
    const targetBy = new Map(targets.map((t) => [t.subjectKey.slice(5), t.value]));
    const rows = people.map((p) => {
      const target = targetBy.get(p.id);
      return {
        user: toUserSummary(p),
        revenueInr: won.get(p.id)?.revenue ?? 0,
        dealsWon: won.get(p.id)?.deals ?? 0,
        calls: callsBy.get(p.id) ?? 0,
        targetPct: target ? pct(monthWon.get(p.id)?.revenue ?? 0, target) : null,
      };
    });
    rows.sort((a, b) => b.revenueInr - a.revenueInr || b.dealsWon - a.dealsWon || b.calls - a.calls || a.user.name.localeCompare(b.user.name));
    return rows.slice(0, 50).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  /** Latest activities on visible leads, rendered as sentences. */
  private async feed(db: TenantDb, users: UserFilter): Promise<FeedItem[]> {
    const rows = await db.activity.findMany({
      where: {
        type: { in: ['lead_created', 'assigned', 'stage_changed', 'call', 'message', 'task_completed', 'workflow_step'] },
        lead: { deletedAt: null, ...(users === null ? {} : { ownerId: { in: users } }) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 60,
      include: { lead: { select: { name: true } } },
    });
    const userIds = new Set<string>();
    for (const r of rows) {
      if (r.actorId) userIds.add(r.actorId);
      const to = (r.payload as { toUserId?: unknown }).toUserId;
      if (typeof to === 'string') userIds.add(to);
    }
    const [people, stages] = await Promise.all([
      userIds.size ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_SUMMARY_SELECT }) : Promise.resolve([]),
      db.stage.findMany({ select: { id: true, name: true } }),
    ]);
    const userBy = new Map<string, UserSummary>(people.map((p) => [p.id, toUserSummary(p)]));
    const stageBy = new Map(stages.map((s) => [s.id, s.name]));

    const items: FeedItem[] = [];
    for (const r of rows) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const actor = r.actorId ? (userBy.get(r.actorId) ?? null) : null;
      const who = actor?.name ?? 'Vistar';
      const lead = r.lead.name;
      let kind: FeedItem['kind'] | null = null;
      let text = '';
      switch (r.type) {
        case 'lead_created':
          kind = 'lead_created';
          text = `New lead ${lead} from ${SOURCE_LABEL[p.source as LeadSource] ?? 'a new source'}`;
          break;
        case 'assigned': {
          kind = 'lead_assigned';
          const toName = typeof p.toUserId === 'string' ? userBy.get(p.toUserId)?.name : null;
          text = toName ? `${who} assigned ${lead} to ${toName}` : `${who} unassigned ${lead}`;
          break;
        }
        case 'stage_changed':
          kind = 'stage_moved';
          text = `${who} moved ${lead} to ${stageBy.get(String(p.toStageId)) ?? 'another stage'}`;
          break;
        case 'call':
          kind = 'call_ended';
          text = `${actor?.name ?? 'Someone'} finished a call with ${lead} (${formatDuration(Number(p.durationSec ?? 0))})`;
          break;
        case 'message':
          if (p.direction !== 'inbound') break;
          kind = 'message_received';
          text = `${lead} sent a message`;
          break;
        case 'task_completed':
          kind = 'task_completed';
          text = `${who} completed "${String(p.title ?? 'a task')}" for ${lead}`;
          break;
        case 'workflow_step':
          if (p.status !== 'failed') break;
          kind = 'workflow_failed';
          text = `Workflow ${String(p.workflowName ?? '')} failed for ${lead}`.replace(/\s+/g, ' ');
          break;
        default:
          break;
      }
      if (!kind) continue;
      items.push({ id: r.id, kind, text, actor, leadId: r.leadId, createdAt: r.createdAt.toISOString() });
      if (items.length >= 20) break;
    }
    return items;
  }

  private async attention(db: TenantDb, users: UserFilter, now: Date): Promise<AttentionItem[]> {
    const [hot, overdue, failed] = await Promise.all([
      // Unassigned leads are only visible with workspace-wide scope and no team filter.
      users === null
        ? db.lead.findMany({
            where: { deletedAt: null, ownerId: null, temperature: 'hot', stage: { type: 'open' } },
            orderBy: [{ createdAt: 'desc' }],
            take: 10,
            select: { id: true, name: true, companyName: true, source: true, createdAt: true },
          })
        : Promise.resolve([]),
      db.task.findMany({
        where: { ...overdueWhere(now), ...(users === null ? { assigneeId: { not: null } } : { assigneeId: { in: users } }) },
        orderBy: [{ dueAt: 'asc' }],
        take: 20,
        include: TASK_INCLUDE,
      }),
      db.workflowRun.findMany({
        where: {
          status: 'failed',
          isTest: false,
          updatedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
          ...(users === null ? {} : { lead: { ownerId: { in: users } } }),
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 10,
        include: { workflow: { select: { name: true } }, lead: { select: { name: true, ownerId: true } } },
      }),
    ]);
    const items: AttentionItem[] = [
      ...hot.map((l) => ({
        id: `hot_lead_unassigned:${l.id}`,
        kind: 'hot_lead_unassigned' as const,
        title: `Hot lead waiting: ${l.name}`.slice(0, 200),
        subtitle: [l.companyName, SOURCE_LABEL[l.source]].filter(Boolean).join(' · ') || null,
        href: `/app/leads?lead=${l.id}`,
        leadId: l.id,
        userId: null,
        severity: now.getTime() - l.createdAt.getTime() > 3_600_000 ? ('critical' as const) : ('warning' as const),
        createdAt: l.createdAt.toISOString(),
      })),
      ...overdue.map((t) => overdueAttention(t, now)),
      ...failed.map((r) => ({
        id: `workflow_failed:${r.id}`,
        kind: 'workflow_failed' as const,
        title: `Workflow failed: ${r.workflow.name}`.slice(0, 200),
        subtitle: [r.lead?.name, r.error?.slice(0, 140)].filter(Boolean).join(' · ') || null,
        href: `/app/workflows/${r.workflowId}?run=${r.id}`,
        leadId: r.leadId,
        userId: r.lead?.ownerId ?? null,
        severity: 'critical' as const,
        createdAt: (r.finishedAt ?? r.updatedAt).toISOString(),
      })),
    ];
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    return items.sort((a, b) => rank[a.severity] - rank[b.severity] || b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  }
}
