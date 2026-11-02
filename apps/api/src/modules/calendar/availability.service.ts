import { Injectable } from '@nestjs/common';
import {
  expandOccurrences,
  MAX_CALENDAR_RANGE_DAYS,
  type AvailabilityQuery,
  type BusinessHours,
  type PresenceStatus,
  type TimeOff,
  type TimeOffCreate,
  type TimeOffListQuery,
  type UserAvailability,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { requirePermission } from '../leads/lib/context.js';
import { checkWorkingHours, localDateOf, windowsOnDate, type WorkingHoursConfig } from '../presence/engine/working-hours.js';
import { parseRecurrence, TIME_OFF_INCLUDE, toTimeOff } from './calendar.mapper.js';
import { tzOffsetMinutes } from './meetings.service.js';

const DAY = 86_400_000;

export interface NowAvailability {
  inWorkingHours: boolean;
  onTimeOff: boolean;
  inMeeting: boolean;
  presence: PresenceStatus | null;
}

/** Working hours, busy blocks and live status (calendar availability and lead routing). */
@Injectable()
export class AvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private async workspaceHours(workspaceId: string) {
    const ws = await this.prisma.forTenant(workspaceId).workspace.findFirst({ select: { timezone: true, businessHours: true, holidays: true } });
    const holidays = Array.isArray(ws?.holidays) ? (ws.holidays as Array<{ date?: unknown }>).map((h) => h?.date).filter((d): d is string => typeof d === 'string') : [];
    return { timezone: ws?.timezone ?? 'Asia/Kolkata', hours: (ws?.businessHours as BusinessHours | null) ?? ({} as BusinessHours), holidays };
  }

  private cfg(ws: { timezone: string; hours: BusinessHours; holidays: string[] }, userHours: unknown): WorkingHoursConfig {
    return { hours: (userHours as BusinessHours | null) ?? ws.hours, timezone: ws.timezone, holidays: ws.holidays };
  }

  /** Live availability of users now (lead routing). */
  async now(workspaceId: string, userIds: readonly string[], at = Date.now()): Promise<Map<string, NowAvailability>> {
    const out = new Map<string, NowAvailability>();
    if (!userIds.length) return out;
    const db = this.prisma.forTenant(workspaceId);
    const ws = await this.workspaceHours(workspaceId);
    const now = new Date(at);
    const [users, off, presences, meetings] = await Promise.all([
      db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, workingHours: true } }),
      db.timeOff.findMany({ where: { userId: { in: [...userIds] }, startAt: { lte: now }, endAt: { gt: now } }, select: { userId: true } }),
      db.presence.findMany({ where: { userId: { in: [...userIds] } }, select: { userId: true, status: true } }),
      db.meeting.findMany({
        where: {
          deletedAt: null,
          status: 'scheduled',
          startAt: { lte: now },
          OR: [{ endAt: { gt: now } }, { seriesEndAt: { gt: now } }],
          AND: [{ OR: [{ organizerId: { in: [...userIds] } }, { attendees: { some: { userId: { in: [...userIds] }, response: { not: 'declined' } } } }] }],
        },
        select: { startAt: true, endAt: true, recurrence: true, exceptionDates: true, timezone: true, organizerId: true, attendees: { select: { userId: true, response: true } } },
      }),
    ]);
    const offSet = new Set(off.map((o) => o.userId));
    const busy = new Set<string>();
    for (const m of meetings) {
      const occ = expandOccurrences({ startAt: m.startAt.getTime(), durationMs: m.endAt.getTime() - m.startAt.getTime(), recurrence: parseRecurrence(m.recurrence), exceptionDates: m.exceptionDates }, at, at + 1, tzOffsetMinutes(m.timezone, m.startAt.getTime()));
      if (!occ.length) continue;
      if (m.organizerId) busy.add(m.organizerId);
      for (const a of m.attendees) if (a.userId && a.response !== 'declined') busy.add(a.userId);
    }
    const presence = new Map(presences.map((p) => [p.userId, p.status]));
    for (const u of users) {
      out.set(u.id, { inWorkingHours: checkWorkingHours(at, this.cfg(ws, u.workingHours)).open, onTimeOff: offSet.has(u.id), inMeeting: busy.has(u.id), presence: presence.get(u.id) ?? null });
    }
    return out;
  }

  private async scopedUsers(auth: AuthContext, requested: readonly string[] | undefined) {
    const db = this.prisma.forTenant(auth.workspaceId);
    const visible = await this.scope.visibleUserIds(auth);
    const wanted = requested?.length ? [...new Set(requested.map((u) => (u === 'me' ? auth.userId : u)).filter((u): u is string => !!u))] : null;
    const ids = wanted ? (visible === null ? wanted : wanted.filter((w) => visible.includes(w) || w === auth.userId)) : visible;
    return db.user.findMany({ where: { isActive: true, deletedAt: null, ...(ids ? { id: { in: ids } } : {}) }, select: { ...USER_SUMMARY_SELECT, workingHours: true }, orderBy: { name: 'asc' }, take: 100 });
  }

  async availability(auth: AuthContext, q: AvailabilityQuery): Promise<{ items: UserAvailability[] }> {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!(to > from) || to - from > MAX_CALENDAR_RANGE_DAYS * DAY) throw new AppException('VALIDATION_FAILED', `Pick a range of at most ${MAX_CALENDAR_RANGE_DAYS} days`, { details: [{ path: 'to', message: 'Range too long' }] });
    const db = this.prisma.forTenant(auth.workspaceId);
    const users = await this.scopedUsers(auth, q.userId);
    const ids = users.map((u) => u.id);
    const ws = await this.workspaceHours(auth.workspaceId);
    const visibleMeetingOwners = await this.scope.visibleUserIds(auth);
    const [meetings, off, nowMap] = await Promise.all([
      db.meeting.findMany({
        where: {
          deletedAt: null,
          status: 'scheduled',
          startAt: { lt: new Date(to) },
          OR: [{ endAt: { gt: new Date(from) } }, { seriesEndAt: { gt: new Date(from) } }],
          AND: [{ OR: [{ organizerId: { in: ids } }, { attendees: { some: { userId: { in: ids } } } }] }],
        },
        select: { id: true, title: true, startAt: true, endAt: true, recurrence: true, exceptionDates: true, timezone: true, organizerId: true, attendees: { select: { userId: true, response: true } } },
        take: 3000,
      }),
      db.timeOff.findMany({ where: { userId: { in: ids }, startAt: { lt: new Date(to) }, endAt: { gt: new Date(from) } } }),
      this.now(auth.workspaceId, ids),
    ]);
    const items = users.map((u) => {
      const cfg = this.cfg(ws, u.workingHours);
      const windows: Array<{ start: string; end: string }> = [];
      for (let t = from - DAY; t < to + DAY; t += DAY) {
        for (const w of windowsOnDate(localDateOf(t, ws.timezone), cfg)) {
          if (w.end > from && w.start < to && !windows.some((x) => x.start === new Date(w.start).toISOString())) windows.push({ start: new Date(Math.max(w.start, from)).toISOString(), end: new Date(Math.min(w.end, to)).toISOString() });
        }
      }
      const busy: UserAvailability['busy'] = [];
      for (const m of meetings) {
        const attends = m.organizerId === u.id || m.attendees.some((a) => a.userId === u.id && a.response !== 'declined');
        if (!attends) continue;
        const canSeeTitle = visibleMeetingOwners === null || m.organizerId === auth.userId || m.attendees.some((a) => a.userId === auth.userId) || (m.organizerId !== null && visibleMeetingOwners.includes(m.organizerId));
        const duration = m.endAt.getTime() - m.startAt.getTime();
        for (const s of expandOccurrences({ startAt: m.startAt.getTime(), durationMs: duration, recurrence: parseRecurrence(m.recurrence), exceptionDates: m.exceptionDates }, from, to, tzOffsetMinutes(m.timezone, m.startAt.getTime()))) {
          busy.push({ start: new Date(s).toISOString(), end: new Date(s + duration).toISOString(), kind: 'meeting', title: canSeeTitle ? m.title : null, meetingId: canSeeTitle ? m.id : null });
        }
      }
      for (const t of off.filter((o) => o.userId === u.id)) busy.push({ start: t.startAt.toISOString(), end: t.endAt.toISOString(), kind: 'time_off', title: t.kind, meetingId: null });
      busy.sort((a, b) => a.start.localeCompare(b.start));
      const n = nowMap.get(u.id);
      return {
        user: toUserSummary(u),
        workingHours: windows.sort((a, b) => a.start.localeCompare(b.start)),
        busy,
        presence: n?.presence ?? null,
        availableNow: !!n && n.inWorkingHours && !n.onTimeOff && !n.inMeeting && n.presence !== 'offline',
      };
    });
    return { items };
  }

  // ---------------------------------------------------------------- time off

  async listTimeOff(auth: AuthContext, q: TimeOffListQuery): Promise<{ items: TimeOff[] }> {
    const users = await this.scopedUsers(auth, q.userId);
    const rows = await this.prisma.forTenant(auth.workspaceId).timeOff.findMany({
      where: { userId: { in: users.map((u) => u.id) }, ...(q.to ? { startAt: { lt: new Date(q.to) } } : {}), ...(q.from ? { endAt: { gt: new Date(q.from) } } : {}) },
      include: TIME_OFF_INCLUDE,
      orderBy: { startAt: 'asc' },
      take: 500,
    });
    return { items: rows.map(toTimeOff) };
  }

  async createTimeOff(auth: AuthContext, body: TimeOffCreate): Promise<TimeOff> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const userId = body.userId ?? auth.userId;
    if (!userId) throw notFound('User');
    if (userId !== auth.userId) {
      requirePermission(auth, 'team.manage', 'You can only add your own time off');
      if (!(await this.scope.canSee(auth, userId))) throw notFound('User');
    }
    if ((await db.user.count({ where: { id: userId, deletedAt: null } })) !== 1) throw notFound('User');
    const row = await db.timeOff.create({
      data: { workspaceId: auth.workspaceId, userId, kind: body.kind, startAt: new Date(body.startAt), endAt: new Date(body.endAt), note: body.note ?? null, createdById: auth.userId },
      include: TIME_OFF_INCLUDE,
    });
    return toTimeOff(row);
  }

  async deleteTimeOff(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.timeOff.findFirst({ where: { id } });
    if (!row) throw notFound('Time off');
    if (row.userId !== auth.userId) {
      requirePermission(auth, 'team.manage', 'You can only remove your own time off');
      if (!(await this.scope.canSee(auth, row.userId))) throw notFound('Time off');
    }
    await db.timeOff.deleteMany({ where: { id } });
    return { ok: true };
  }
}
