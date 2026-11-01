import { Injectable } from '@nestjs/common';
import { SETTING_KEYS, type MyToday } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { LEAD_LIST_INCLUDE, toLeadListItem } from '../leads/lead.mapper.js';
import { startOfNextZonedMonth, startOfZonedMonth, zonedMonthKey, zonedToday } from '../leads/lib/tz.js';
import { TASK_INCLUDE, toTask } from '../tasks/task.mapper.js';
import { workspaceTimezone } from '../tasks/tasks.service.js';
import { DashboardSql } from './dashboard.sql.js';

const DAY_MS = 86_400_000;
const LIST_LIMIT = 50;

/** Employee Home (`GET /me/today`). Always the caller's own records, whatever their data scope. */
@Injectable()
export class MyTodayService {
  constructor(private readonly prisma: PrismaService) {}

  async today(auth: AuthContext): Promise<MyToday> {
    const uid = auth.userId;
    if (!uid) throw new AppException('FORBIDDEN', 'Employee Home needs a signed-in user');
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const tz = await workspaceTimezone(db);
    const now = new Date();
    const today = zonedToday(tz, now);
    const monthStart = startOfZonedMonth(now, tz);
    const monthEnd = startOfNextZonedMonth(now, tz);
    const dayAgo = new Date(now.getTime() - DAY_MS);

    const dueOpen = {
      assigneeId: uid,
      deletedAt: null,
      status: 'open' as const,
      dueAt: { lt: today.end },
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
    };
    const assignedActs = await db.activity.findMany({
      where: { type: 'assigned', createdAt: { gte: dayAgo }, payload: { path: ['toUserId'], equals: uid } },
      select: { leadId: true },
      take: 500,
    });

    const own = new DashboardSql(this.prisma, wid, [uid]);
    const [tasksDue, callsToMake, followUps, newAssigned, targets, callsToday, talk, contactedCalls, contactedActs, wonMonth, monthCalls, convertedMonth, showRank] =
      await Promise.all([
        db.task.findMany({ where: { ...dueOpen, type: { not: 'call' } }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: LIST_LIMIT, include: TASK_INCLUDE }),
        db.task.findMany({ where: { ...dueOpen, type: 'call' }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: LIST_LIMIT, include: TASK_INCLUDE }),
        db.lead.findMany({
          where: { ownerId: uid, deletedAt: null, nextFollowUpAt: { lt: today.end }, stage: { type: 'open' } },
          orderBy: [{ nextFollowUpAt: 'asc' }, { id: 'asc' }],
          take: LIST_LIMIT,
          include: LEAD_LIST_INCLUDE,
        }),
        db.lead.findMany({
          where: { ownerId: uid, deletedAt: null, OR: [{ createdAt: { gte: dayAgo } }, { id: { in: [...new Set(assignedActs.map((a) => a.leadId))] } }] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIST_LIMIT,
          include: LEAD_LIST_INCLUDE,
        }),
        db.target.findMany({ where: { subjectKey: `user:${uid}`, period: zonedMonthKey(now, tz) } }),
        db.call.count({ where: { userId: uid, startedAt: { gte: today.start, lt: today.end } } }),
        db.call.aggregate({ where: { userId: uid, startedAt: { gte: today.start, lt: today.end } }, _sum: { durationSec: true } }),
        db.call.findMany({ where: { userId: uid, leadId: { not: null }, startedAt: { gte: today.start, lt: today.end } }, select: { leadId: true }, distinct: ['leadId'] }),
        db.activity.findMany({
          where: { actorId: uid, type: { in: ['call', 'message', 'email', 'note'] }, createdAt: { gte: today.start, lt: today.end }, lead: { deletedAt: null } },
          select: { leadId: true },
          distinct: ['leadId'],
        }),
        own.wonByOwner(monthStart, monthEnd),
        db.call.count({ where: { userId: uid, startedAt: { gte: monthStart, lt: monthEnd } } }),
        db.lead.count({ where: { ownerId: uid, deletedAt: null, wonAt: { gte: monthStart, lt: monthEnd } } }),
        db.setting.findFirst({ where: { scope: 'workspace', scopeId: wid, key: SETTING_KEYS.workspace.showEmployeeRank } }),
      ]);

    const mine = wonMonth.get(uid) ?? { revenue: 0, deals: 0 };
    const achieved: Record<MyToday['targets'][number]['metric'], number> = {
      revenue_inr: mine.revenue,
      deals_won: mine.deals,
      calls: monthCalls,
      leads_converted: convertedMonth,
    };
    const contacted = new Set([...contactedCalls.map((c) => c.leadId), ...contactedActs.map((a) => a.leadId)].filter(Boolean));

    return {
      tasksDue: tasksDue.map(toTask),
      followUps: followUps.map(toLeadListItem),
      callsToMake: callsToMake.map(toTask),
      newAssigned: newAssigned.map(toLeadListItem),
      targets: targets.map((t) => ({ metric: t.metric, period: t.period, target: t.value, achieved: achieved[t.metric] })),
      stats: {
        callsToday,
        talkSecToday: talk._sum.durationSec ?? 0,
        leadsContactedToday: contacted.size,
        wonInrThisMonth: mine.revenue,
        rank: showRank?.value === false ? null : await this.rank(wid, uid, monthStart, monthEnd, mine.revenue),
      },
      generatedAt: now.toISOString(),
    };
  }

  /** Competition rank by won revenue this month among active sales users (1 + number of people ahead). */
  private async rank(wid: string, uid: string, start: Date, end: Date, mine: number): Promise<number> {
    const db = this.prisma.forTenant(wid);
    const sales = await db.user.findMany({ where: { isActive: true, deletedAt: null, role: { kind: { in: ['employee', 'manager'] } } }, select: { id: true } });
    const byOwner = await new DashboardSql(this.prisma, wid, sales.map((s) => s.id)).wonByOwner(start, end);
    return 1 + [...byOwner.entries()].filter(([id, v]) => id !== uid && v.revenue > mine).length;
  }
}
