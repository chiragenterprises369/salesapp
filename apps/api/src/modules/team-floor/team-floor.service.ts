import { Injectable } from '@nestjs/common';
import {
  PRESENCE_STATUSES,
  presenceToEmployeeStatus,
  SeatMapSchema,
  type AttentionItem,
  type PresenceStatus,
  type TeamFloorRef,
  type TeamFloorSnapshot,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { FloorsService } from '../floors/floors.service.js';
import { startOfZonedDay, startOfZonedMonth, zonedMonthKey, safeTimezone } from '../leads/lib/tz.js';
import { initialState, viewOf, type PresenceView } from '../presence/engine/status-engine.js';
import { OfficeMarkersService } from '../presence/office-markers.service.js';
import { PresenceService, toPresence } from '../presence/presence.service.js';
import { overdueAttention, overdueWhere, TASK_INCLUDE } from '../tasks/task.mapper.js';
import { assignSeats } from './seats.js';

const FLOOR_KINDS = ['employee', 'manager'] as const;
const MAX_PEOPLE = 200;

/**
 * Team Floor snapshot (SPEC 12, 29.2, 29.11): the people in the caller's scope with their server-decided
 * presence (the same views the `employee.status_changed` / `employee.zone_changed` events carry: status,
 * version, activity with the screen, office zone with source and confidence), seats on the published
 * custom floor, today's call numbers, waiting leads and "Needs you" items. Clients apply events on top
 * and refetch on `sync.required`.
 */
@Injectable()
export class TeamFloorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly presence: PresenceService,
    private readonly floors: FloorsService,
    private readonly markers: OfficeMarkersService,
  ) {}

  async snapshot(auth: AuthContext, teamId?: string): Promise<TeamFloorSnapshot> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const now = new Date();
    const ws = await db.workspace.findFirst({ select: { timezone: true } });
    const tz = safeTimezone(ws?.timezone);
    const visible = await this.scope.visibleUserIds(auth);
    if (teamId) await assertInTenant(db, { team: teamId });
    const people = await db.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { kind: { in: [...FLOOR_KINDS] } },
        ...(visible ? { id: { in: visible } } : {}),
        ...(teamId ? { OR: [{ teamId }, { managedTeams: { some: { id: teamId } } }] } : {}),
      },
      select: { ...USER_SUMMARY_SELECT, deskIndex: true, isFieldStaff: true },
      orderBy: [{ deskIndex: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
      take: MAX_PEOPLE,
    });
    const ids = people.map((p) => p.id);
    const todayStart = startOfZonedDay(now, tz);

    const [views, callStats, talkStats, openSessions, layout, zoneName, targets, monthCalls] = await Promise.all([
      this.views(wid, ids),
      ids.length ? db.call.groupBy({ by: ['userId'], where: { userId: { in: ids }, startedAt: { gte: todayStart } }, _count: { _all: true } }) : Promise.resolve([]),
      ids.length
        ? db.call.groupBy({ by: ['userId'], where: { userId: { in: ids }, startedAt: { gte: todayStart }, durationSec: { gt: 0 } }, _avg: { durationSec: true } })
        : Promise.resolve([]),
      ids.length ? db.attendanceSession.findMany({ where: { userId: { in: ids }, checkOutAt: null }, select: { userId: true } }) : Promise.resolve([]),
      this.floors.layoutRef(wid),
      this.markers.zoneNames(wid),
      ids.length ? db.target.findMany({ where: { userId: { in: ids }, metric: 'calls', period: zonedMonthKey(now, tz) }, select: { userId: true, value: true } }) : Promise.resolve([]),
      ids.length ? db.call.groupBy({ by: ['userId'], where: { userId: { in: ids }, startedAt: { gte: startOfZonedMonth(now, tz) } }, _count: { _all: true } }) : Promise.resolve([]),
    ]);

    const callsBy = new Map(callStats.map((c) => [c.userId, c._count._all]));
    const talkBy = new Map(talkStats.map((c) => [c.userId, Math.round(c._avg.durationSec ?? 0)]));
    const monthBy = new Map(monthCalls.map((c) => [c.userId, c._count._all]));
    const targetBy = new Map(targets.map((t) => [t.userId, t.value]));
    const checkedIn = new Set(openSessions.map((s) => s.userId));
    const { asset, ...floor } = layout;
    const seatMap = asset?.seatMap ? SeatMapSchema.safeParse(asset.seatMap) : null;
    const seats = assignSeats(seatMap?.success ? seatMap.data : null, people.map((p) => ({ id: p.id, deskIndex: p.deskIndex, name: p.name })));
    const nowMs = now.getTime();

    const counts = Object.fromEntries(PRESENCE_STATUSES.map((s) => [s, 0])) as Record<PresenceStatus, number>;
    const employees: TeamFloorSnapshot['employees'] = people.map((p, i) => {
      const v = views.get(p.id) ?? viewOf(initialState(p.id, now.getTime()));
      counts[v.status] += 1;
      const coarse = presenceToEmployeeStatus(v.status);
      const presence = toPresence(v, zoneName, nowMs);
      const target = targetBy.get(p.id);
      return {
        user: { ...toUserSummary(p), status: coarse },
        status: coarse,
        deskIndex: p.deskIndex ?? i,
        currentLeadId: v.activity.leadId,
        currentLeadName: v.activity.leadName,
        activeCall:
          v.status === 'on_call' && v.activity.callId && v.activity.startedAt !== null
            ? { callId: v.activity.callId, startedAt: new Date(v.activity.startedAt).toISOString(), leadName: v.activity.leadName }
            : null,
        callsToday: callsBy.get(p.id) ?? 0,
        avgTalkSec: talkBy.get(p.id) ?? 0,
        targetPct: target ? Math.round(((monthBy.get(p.id) ?? 0) / target) * 1000) / 10 : null,
        presence: { ...omitUserId(presence), seatId: seats.get(p.id) ?? null, isFieldStaff: p.isFieldStaff, checkedIn: checkedIn.has(p.id) },
      };
    });

    const [waiting, waitingCount, attention] = await Promise.all([
      visible === null && !teamId
        ? db.lead.findMany({ where: { deletedAt: null, ownerId: null, stage: { type: 'open' } }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, name: true, createdAt: true } })
        : Promise.resolve([]),
      visible === null && !teamId ? db.lead.count({ where: { deletedAt: null, ownerId: null, stage: { type: 'open' } } }) : Promise.resolve(0),
      this.attention(db, ids, visible === null && !teamId, now),
    ]);

    return {
      kpis: {
        active: employees.filter((e) => e.presence?.status !== 'offline').length,
        onCall: counts.on_call,
        idle: counts.available,
        busy: counts.in_meeting + counts.field_visit,
        callsToday: employees.reduce((s, e) => s + e.callsToday, 0),
        leadsWaiting: waitingCount,
      },
      employees,
      leadsWaiting: waiting.map((l) => ({ leadId: l.id, name: l.name, createdAt: l.createdAt.toISOString() })),
      attention,
      floor: floor satisfies TeamFloorRef,
      presenceCounts: counts,
      generatedAt: now.toISOString(),
    };
  }

  /** Presence views; people Redis does not know yet are evaluated once (seeded from the database). */
  private async views(workspaceId: string, ids: string[]): Promise<Map<string, PresenceView>> {
    const views = await this.presence.views(workspaceId, ids);
    const missing = ids.filter((id) => !views.has(id));
    for (let i = 0; i < missing.length; i += 20) {
      const chunk = missing.slice(i, i + 20);
      const done = await Promise.all(chunk.map((id) => this.presence.tick(workspaceId, id).then(async (v) => v ?? (await this.presence.view(workspaceId, id))).catch(() => null)));
      chunk.forEach((id, k) => {
        if (done[k]) views.set(id, done[k]!);
      });
    }
    return views;
  }

  private async attention(db: ReturnType<PrismaService['forTenant']>, ids: string[], all: boolean, now: Date): Promise<AttentionItem[]> {
    const [overdue, hot] = await Promise.all([
      ids.length ? db.task.findMany({ where: { ...overdueWhere(now), assigneeId: { in: ids } }, orderBy: { dueAt: 'asc' }, take: 20, include: TASK_INCLUDE }) : Promise.resolve([]),
      all
        ? db.lead.findMany({ where: { deletedAt: null, ownerId: null, temperature: 'hot', stage: { type: 'open' } }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, name: true, createdAt: true } })
        : Promise.resolve([]),
    ]);
    return [
      ...hot.map((l) => ({
        id: `hot_lead_unassigned:${l.id}`,
        kind: 'hot_lead_unassigned' as const,
        title: `Hot lead waiting: ${l.name}`.slice(0, 200),
        subtitle: null,
        href: `/app/leads?lead=${l.id}`,
        leadId: l.id,
        userId: null,
        severity: now.getTime() - l.createdAt.getTime() > 3_600_000 ? ('critical' as const) : ('warning' as const),
        createdAt: l.createdAt.toISOString(),
      })),
      ...overdue.map((t) => overdueAttention(t, now)),
    ];
  }
}

function omitUserId<T extends { userId: string }>(p: T): Omit<T, 'userId'> {
  const { userId: _u, ...rest } = p;
  return rest;
}
