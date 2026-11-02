import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  BusinessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  isWithinWorkingHours as sharedWithinHours,
  LOCATION_INTERVAL_SEC,
  LOCATION_MAX_AGE_SEC,
  TRACKING_CONSENT_VERSION,
  workingSlotsAt,
  type AttendanceCheck,
  type AttendanceRegister,
  type AttendanceSession,
  type BusinessHours,
  type EventActor,
  type FieldLive,
  type FieldRoute,
  type LocationBatch,
  type LocationBatchResult,
  type MyAttendanceToday,
  type TrackingConsent,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import type { AttendanceRegisterQuerySchema } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../infra/prisma/tenant.js';
import { publishSafe } from '../leads/lib/context.js';
import { addZonedDays, safeTimezone, zonedMidnight } from '../leads/lib/tz.js';
import { localDateOf, windowsOnDate } from '../presence/engine/working-hours.js';
import { PresenceService } from '../presence/presence.service.js';
import { routeLengthM, simplifyRoute } from './geo.js';

const FUTURE_SKEW_MS = 120_000;
const ROUTE_TOLERANCE_M = 10;
const ROUTE_MAX_POINTS = 5_000;
const SESSION_INCLUDE = { _count: { select: { pings: true } } } as const;
type SessionRow = Prisma.AttendanceSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

interface GateContext {
  userId: string;
  isFieldStaff: boolean;
  trackingEnabled: boolean;
  timezone: string;
  hours: BusinessHours;
  holidays: Array<{ date: string }>;
  consent: TrackingConsent;
}

export function toSession(s: SessionRow, now = Date.now()): AttendanceSession {
  const end = s.checkOutAt?.getTime() ?? now;
  return {
    id: s.id,
    userId: s.userId,
    date: s.date,
    checkInAt: s.checkInAt.toISOString(),
    checkIn: { lat: s.checkInLat, lng: s.checkInLng, accuracy: s.checkInAccuracy },
    checkOutAt: s.checkOutAt?.toISOString() ?? null,
    checkOut: s.checkOutAt && s.checkOutLat !== null && s.checkOutLng !== null ? { lat: s.checkOutLat, lng: s.checkOutLng, accuracy: s.checkOutAccuracy } : null,
    checkOutReason: (s.checkOutReason as AttendanceSession['checkOutReason']) ?? null,
    workedMin: Math.max(0, Math.floor((end - s.checkInAt.getTime()) / 60_000)),
    pointCount: s._count.pings,
  };
}

const SYSTEM_ACTOR: EventActor = { type: 'system', id: null, name: 'attendance' };

/**
 * Attendance and field tracking (D-063, SPEC 29.1). Applies to field staff of companies with the
 * `field_tracking` flag, after tracking consent. Check-in only inside working hours; location points
 * only while checked in and inside working hours (the shared `isWithinWorkingHours`, the same rule the
 * app uses to stop its foreground service). Rejected points are never stored. Sessions still open after
 * the working day are closed by the server (`end_of_day`).
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly presence: PresenceService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- gate

  private async trackingFlag(db: TenantPrisma): Promise<boolean> {
    const ws = await db.workspace.findFirst({ select: { plan: true } });
    if (!ws) return false;
    const [def, override] = await Promise.all([
      this.prisma.planDefinition.findUnique({ where: { key: ws.plan }, select: { features: true } }),
      db.featureFlagOverride.findFirst({ where: { flag: 'field_tracking' }, select: { enabled: true } }),
    ]);
    if (override) return override.enabled;
    return ((def?.features ?? {}) as Record<string, unknown>).field_tracking === true;
  }

  private async gate(auth: AuthContext): Promise<GateContext> {
    if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
    const db = this.prisma.forTenant(auth.workspaceId);
    const [user, ws, consentRow, trackingEnabled] = await Promise.all([
      db.user.findFirst({ where: { id: auth.userId, deletedAt: null }, select: { isFieldStaff: true, workingHours: true } }),
      db.workspace.findFirst({ select: { timezone: true, businessHours: true, holidays: true } }),
      db.trackingConsent.findFirst({ where: { userId: auth.userId }, orderBy: { at: 'desc' } }),
      this.trackingFlag(db),
    ]);
    if (!user) throw notFound('User');
    const own = BusinessHoursSchema.safeParse(user.workingHours);
    const company = BusinessHoursSchema.safeParse(ws?.businessHours);
    const holidays = Array.isArray(ws?.holidays) ? (ws.holidays as Array<{ date?: unknown }>).filter((h): h is { date: string } => typeof h?.date === 'string') : [];
    return {
      userId: auth.userId,
      isFieldStaff: user.isFieldStaff,
      trackingEnabled,
      timezone: safeTimezone(ws?.timezone),
      hours: own.success ? own.data : company.success ? company.data : DEFAULT_BUSINESS_HOURS,
      holidays,
      consent: {
        accepted: Boolean(consentRow?.accepted && consentRow.version === TRACKING_CONSENT_VERSION),
        version: consentRow?.version ?? null,
        at: consentRow?.at.toISOString() ?? null,
        currentVersion: TRACKING_CONSENT_VERSION,
      },
    };
  }

  /** Throws the contract error that tells the app why tracking is not allowed. */
  private assertTracking(g: GateContext): void {
    if (!g.isFieldStaff) throw new AppException('NOT_FIELD_STAFF', 'Attendance and location tracking are only for field staff');
    if (!g.trackingEnabled) throw new AppException('FEATURE_DISABLED', 'Field tracking is not enabled for your company');
    if (!g.consent.accepted) throw new AppException('TRACKING_CONSENT_REQUIRED', 'Accept location tracking first');
  }

  private inside(g: GateContext, at: number): boolean {
    return sharedWithinHours(g.hours, g.timezone, new Date(at), g.holidays);
  }

  private openSession(db: TenantPrisma, userId: string) {
    return db.attendanceSession.findFirst({ where: { userId, checkOutAt: null }, orderBy: { checkInAt: 'desc' }, include: SESSION_INCLUDE });
  }

  // ---------------------------------------------------------------- me

  async today(auth: AuthContext): Promise<MyAttendanceToday> {
    const g = await this.gate(auth);
    const db = this.prisma.forTenant(auth.workspaceId);
    const now = Date.now();
    const date = localDateOf(now, g.timezone);
    const [sessions, open] = await Promise.all([
      db.attendanceSession.findMany({ where: { userId: g.userId, date }, orderBy: { checkInAt: 'asc' }, include: SESSION_INCLUDE }),
      this.openSession(db, g.userId),
    ]);
    const inside = this.inside(g, now);
    const slots = workingSlotsAt(g.hours, g.timezone, new Date(now), g.holidays).slots;
    return {
      date,
      timezone: g.timezone,
      isFieldStaff: g.isFieldStaff,
      trackingEnabled: g.trackingEnabled,
      consent: g.consent,
      workingHours: slots,
      insideWorkingHours: inside,
      session: open ? toSession(open, now) : null,
      sessions: sessions.map((s) => toSession(s, now)),
      trackingActive: g.isFieldStaff && g.trackingEnabled && g.consent.accepted && !!open && inside,
      locationIntervalSec: LOCATION_INTERVAL_SEC,
    };
  }

  async checkIn(auth: AuthContext, body: AttendanceCheck): Promise<AttendanceSession> {
    const g = await this.gate(auth);
    this.assertTracking(g);
    const now = Date.now();
    if (!this.inside(g, now)) throw new AppException('OUTSIDE_WORKING_HOURS', 'Check-in is possible only inside your working hours');
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const open = await tx.attendanceSession.findFirst({ where: { userId: g.userId, checkOutAt: null }, select: { id: true } });
      if (open) throw new AppException('ATTENDANCE_STATE_INVALID', 'You are already checked in');
      return tx.attendanceSession.create({
        data: {
          workspaceId: auth.workspaceId,
          userId: g.userId,
          date: localDateOf(now, g.timezone),
          checkInAt: new Date(now),
          checkInLat: body.lat,
          checkInLng: body.lng,
          checkInAccuracy: body.accuracy ?? null,
          deviceId: body.deviceId ?? null,
          note: body.note ?? null,
        },
        include: SESSION_INCLUDE,
      });
    });
    const session = toSession(row, now);
    await this.presence.checkIn(auth.workspaceId, g.userId, now).catch((err: Error) => this.logger.warn(`presence checkIn failed: ${err.message}`));
    await this.publishSession(auth.workspaceId, 'attendance.checked_in', session, { type: 'user', id: g.userId, name: null });
    return session;
  }

  async checkOut(auth: AuthContext, body: AttendanceCheck): Promise<AttendanceSession> {
    if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
    const db = this.prisma.forTenant(auth.workspaceId);
    const open = await this.openSession(db, auth.userId);
    if (!open) throw new AppException('ATTENDANCE_STATE_INVALID', 'You are not checked in');
    const now = new Date();
    const { count } = await db.attendanceSession.updateMany({
      where: { id: open.id, checkOutAt: null },
      data: { checkOutAt: now, checkOutLat: body.lat, checkOutLng: body.lng, checkOutAccuracy: body.accuracy ?? null, checkOutReason: 'manual' },
    });
    if (count === 0) throw new AppException('ATTENDANCE_STATE_INVALID', 'You are not checked in');
    const row = await db.attendanceSession.findFirstOrThrow({ where: { id: open.id }, include: SESSION_INCLUDE });
    const session = toSession(row);
    await this.presence.checkOut(auth.workspaceId, auth.userId, now.getTime()).catch((err: Error) => this.logger.warn(`presence checkOut failed: ${err.message}`));
    await this.publishSession(auth.workspaceId, 'attendance.checked_out', session, { type: 'user', id: auth.userId, name: null });
    return session;
  }

  async location(auth: AuthContext, batch: LocationBatch): Promise<LocationBatchResult> {
    const g = await this.gate(auth);
    this.assertTracking(g);
    const db = this.prisma.forTenant(auth.workspaceId);
    const open = await this.openSession(db, g.userId);
    const now = Date.now();
    if (!open) throw new AppException('ATTENDANCE_STATE_INVALID', 'Check in before sending your location');
    const rejected: LocationBatchResult['rejected'] = [];
    const accepted: Prisma.LocationPingCreateManyInput[] = [];
    const seen = new Set<number>();
    for (const p of batch.points) {
      const at = Date.parse(p.at);
      const reject = (reason: LocationBatchResult['rejected'][number]['reason']) => rejected.push({ at: p.at, reason });
      if (p.isMock) reject('mock_location');
      else if (at > now + FUTURE_SKEW_MS) reject('in_future');
      else if (at < now - LOCATION_MAX_AGE_SEC * 1000) reject('too_old');
      else if (at < open.checkInAt.getTime()) reject('not_checked_in');
      else if (!this.inside(g, at)) reject('outside_working_hours');
      else if (!seen.has(at)) {
        seen.add(at);
        accepted.push({
          workspaceId: auth.workspaceId,
          userId: g.userId,
          sessionId: open.id,
          at: new Date(at),
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy ?? null,
          speed: p.speed ?? null,
          heading: p.heading ?? null,
          battery: p.battery ?? null,
        });
      }
    }
    if (accepted.length === 0 && !this.inside(g, now)) {
      // Nothing to keep and the working day is over: the app stops tracking on this code.
      throw new AppException('OUTSIDE_WORKING_HOURS', 'Location is accepted only inside working hours; tracking has stopped');
    }
    const { count } = accepted.length ? await db.locationPing.createMany({ data: accepted, skipDuplicates: true }) : { count: 0 };
    const duplicates = batch.points.length - rejected.length - count;
    if (count > 0) {
      const last = accepted.reduce((a, b) => ((b.at as Date) > (a.at as Date) ? b : a));
      await publishSafe(
        this.events,
        this.logger,
        'location.updated',
        auth.workspaceId,
        { userId: g.userId, sessionId: open.id, point: { lat: last.lat, lng: last.lng, accuracy: last.accuracy ?? null, at: (last.at as Date).toISOString(), battery: last.battery ?? null } },
        { actor: { type: 'user', id: g.userId, name: null } },
      );
    }
    return { accepted: count, duplicates: Math.max(0, duplicates), rejected };
  }

  async consentGet(auth: AuthContext): Promise<TrackingConsent> {
    return (await this.gate(auth)).consent;
  }

  async consentSet(auth: AuthContext, req: Request, body: { accepted: boolean; version: string; deviceId?: string }): Promise<TrackingConsent> {
    if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
    if (auth.impersonation) throw new AppException('FORBIDDEN', 'Only the employee can give consent');
    if (body.accepted && body.version !== TRACKING_CONSENT_VERSION) {
      throw new AppException('VALIDATION_FAILED', 'Accept the current consent text', { details: [{ path: 'version', message: `Current version is ${TRACKING_CONSENT_VERSION}` }] });
    }
    const db = this.prisma.forTenant(auth.workspaceId);
    await db.trackingConsent.create({
      data: {
        workspaceId: auth.workspaceId,
        userId: auth.userId,
        version: body.version,
        accepted: body.accepted,
        deviceId: body.deviceId ?? null,
        ip: req.ip ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : null,
      },
    });
    await this.audit.record(auth, req, { action: body.accepted ? 'tracking_consent.accept' : 'tracking_consent.withdraw', entityType: 'user', entityId: auth.userId, diff: { version: body.version } });
    if (!body.accepted) {
      // Withdrawing consent ends tracking now: close the open session.
      const open = await this.openSession(db, auth.userId);
      if (open) await this.closeSession(auth.workspaceId, open, new Date(), 'manual');
    }
    return (await this.gate(auth)).consent;
  }

  // ---------------------------------------------------------------- company views

  private async usersInScope(auth: AuthContext, teamId?: string, fieldStaffOnly?: boolean) {
    const db = this.prisma.forTenant(auth.workspaceId);
    const ids = await this.scope.visibleUserIds(auth);
    return db.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(ids ? { id: { in: ids } } : {}),
        ...(teamId ? { teamId } : {}),
        ...(fieldStaffOnly ? { isFieldStaff: true } : {}),
      },
      select: { ...USER_SUMMARY_SELECT, isFieldStaff: true, workingHours: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  async register(auth: AuthContext, q: z.output<typeof AttendanceRegisterQuerySchema>): Promise<AttendanceRegister> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const ws = await db.workspace.findFirst({ select: { timezone: true, businessHours: true, holidays: true } });
    const tz = safeTimezone(ws?.timezone);
    const date = q.date ?? localDateOf(Date.now(), tz);
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const dayStart = zonedMidnight(y, m, d, tz);
    const dayEnd = addZonedDays(dayStart, 1, tz);
    const holidays = Array.isArray(ws?.holidays) ? (ws.holidays as Array<{ date?: unknown }>).map((h) => h?.date).filter((x): x is string => typeof x === 'string') : [];
    const company = BusinessHoursSchema.safeParse(ws?.businessHours);
    const users = await this.usersInScope(auth, q.teamId, q.fieldStaffOnly);
    const ids = users.map((u) => u.id);
    const [sessions, events] = await Promise.all([
      db.attendanceSession.findMany({ where: { userId: { in: ids }, date }, orderBy: { checkInAt: 'asc' }, include: SESSION_INCLUDE }),
      // Office staff have no check-in: their day comes from the status history (first and last activity).
      db.presenceEvent.findMany({ where: { userId: { in: ids }, at: { gte: dayStart, lt: dayEnd } }, orderBy: { at: 'asc' }, select: { userId: true, status: true, at: true } }),
    ]);
    const now = Date.now();
    const items: AttendanceRegister['items'] = [];
    const summary = { present: 0, checkedOut: 0, absent: 0 };
    for (const u of users) {
      const own = sessions.filter((s) => s.userId === u.id).map((s) => toSession(s, now));
      const hours = BusinessHoursSchema.safeParse(u.workingHours);
      const windows = windowsOnDate(date, { hours: hours.success ? hours.data : company.success ? company.data : DEFAULT_BUSINESS_HOURS, timezone: tz, holidays });
      let status: AttendanceRegister['items'][number]['status'];
      let firstIn: string | null = own[0]?.checkInAt ?? null;
      let lastOut: string | null = own.length && own.every((s) => s.checkOutAt) ? (own.at(-1)!.checkOutAt ?? null) : null;
      let workedMin = own.reduce((sum, s) => sum + s.workedMin, 0);
      if (own.length) {
        status = own.some((s) => !s.checkOutAt) ? 'present' : 'checked_out';
      } else if (!u.isFieldStaff) {
        const day = officeDay(events.filter((e) => e.userId === u.id), Math.min(now, dayEnd.getTime()));
        if (day) {
          firstIn = day.firstIn;
          lastOut = day.lastOut;
          workedMin = day.workedMin;
          status = day.lastOut ? 'checked_out' : 'present';
        } else status = holidays.includes(date) ? 'holiday' : windows.length === 0 ? 'off_day' : 'absent';
      } else {
        status = holidays.includes(date) ? 'holiday' : windows.length === 0 ? 'off_day' : 'absent';
      }
      if (status === 'present') summary.present += 1;
      else if (status === 'checked_out') summary.checkedOut += 1;
      else if (status === 'absent') summary.absent += 1;
      items.push({ user: toUserSummary(u), isFieldStaff: u.isFieldStaff, status, firstCheckInAt: firstIn, lastCheckOutAt: lastOut, workedMin, sessions: own });
    }
    return { date, timezone: tz, items, summary };
  }

  async live(auth: AuthContext, teamId?: string): Promise<FieldLive> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const users = await this.usersInScope(auth, teamId, true);
    const byId = new Map(users.map((u) => [u.id, u]));
    const open = await db.attendanceSession.findMany({ where: { userId: { in: [...byId.keys()] }, checkOutAt: null }, orderBy: { checkInAt: 'desc' } });
    const latest = open.length
      ? await db.locationPing.findMany({ where: { sessionId: { in: open.map((s) => s.id) } }, orderBy: [{ userId: 'asc' }, { at: 'desc' }], distinct: ['userId'] })
      : [];
    const pingBy = new Map(latest.map((p) => [p.userId, p]));
    const views = await this.presence.views(auth.workspaceId, open.map((s) => s.userId));
    const now = Date.now();
    const seenUsers = new Set<string>();
    const items: FieldLive['items'] = [];
    for (const s of open) {
      if (seenUsers.has(s.userId)) continue;
      seenUsers.add(s.userId);
      const u = byId.get(s.userId);
      if (!u) continue;
      const p = pingBy.get(s.userId);
      const at = p?.at ?? s.checkInAt;
      items.push({
        user: toUserSummary(u),
        sessionId: s.id,
        lat: p?.lat ?? s.checkInLat,
        lng: p?.lng ?? s.checkInLng,
        accuracy: p ? p.accuracy : s.checkInAccuracy,
        at: at.toISOString(),
        battery: p?.battery ?? null,
        presence: views.get(s.userId)?.status ?? null,
        stale: now - at.getTime() > 2 * LOCATION_INTERVAL_SEC * 1000,
      });
    }
    return { items, generatedAt: new Date(now).toISOString() };
  }

  async route(auth: AuthContext, userId: string, dateQ?: string): Promise<FieldRoute> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const user = await db.user.findFirst({ where: { id: userId, deletedAt: null }, select: USER_SUMMARY_SELECT });
    if (!user || !(await this.scope.canSee(auth, userId))) throw notFound('User');
    const ws = await db.workspace.findFirst({ select: { timezone: true } });
    const tz = safeTimezone(ws?.timezone);
    const date = dateQ ?? localDateOf(Date.now(), tz);
    const sessions = await db.attendanceSession.findMany({ where: { userId, date }, orderBy: { checkInAt: 'asc' }, include: SESSION_INCLUDE });
    const raw = sessions.length
      ? await db.locationPing.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) } }, orderBy: { at: 'asc' }, take: 50_000 })
      : [];
    const points = raw.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, at: p.at.toISOString(), speed: p.speed, heading: p.heading, battery: p.battery, sessionId: p.sessionId }));
    // Simplify per session (a gap between sessions is not a straight line), loosening until it fits.
    let tolerance = ROUTE_TOLERANCE_M;
    let simplified = simplifyPerSession(points, tolerance);
    while (simplified.length > ROUTE_MAX_POINTS) {
      tolerance *= 2;
      simplified = simplifyPerSession(points, tolerance);
    }
    const distanceM = sessions.reduce((sum, s) => sum + routeLengthM(points.filter((p) => p.sessionId === s.id)), 0);
    return { user: toUserSummary(user), date, sessions: sessions.map((s) => toSession(s)), points: simplified, distanceM };
  }

  // ---------------------------------------------------------------- end of day

  /** Close sessions still open after their working day (checkOutReason end_of_day). Every 5 min. */
  @Interval(300_000)
  async closeFinishedDays(): Promise<number> {
    const open = await this.prisma.attendanceSession.findMany({ where: { checkOutAt: null }, select: { id: true, workspaceId: true }, take: 2_000 });
    let closed = 0;
    for (const s of open) {
      const db = this.prisma.forTenant(s.workspaceId);
      const row = await db.attendanceSession.findFirst({ where: { id: s.id }, include: { ...SESSION_INCLUDE, user: { select: { workingHours: true } } } });
      const ws = await db.workspace.findFirst({ select: { timezone: true, businessHours: true, holidays: true } });
      if (!row || !ws) continue;
      const tz = safeTimezone(ws.timezone);
      const own = BusinessHoursSchema.safeParse(row.user.workingHours);
      const company = BusinessHoursSchema.safeParse(ws.businessHours);
      const holidays = Array.isArray(ws.holidays) ? (ws.holidays as Array<{ date?: unknown }>).map((h) => h?.date).filter((x): x is string => typeof x === 'string') : [];
      const windows = windowsOnDate(row.date, { hours: own.success ? own.data : company.success ? company.data : DEFAULT_BUSINESS_HOURS, timezone: tz, holidays });
      const end = windows.length ? Math.max(...windows.map((w) => w.end)) : addZonedDays(zonedMidnight(...(row.date.split('-').map(Number) as [number, number, number]), tz), 1, tz).getTime();
      if (Date.now() < end || end < row.checkInAt.getTime()) continue;
      if (await this.closeSession(s.workspaceId, row, new Date(end), 'end_of_day')) closed += 1;
    }
    return closed;
  }

  private async closeSession(workspaceId: string, row: SessionRow, at: Date, reason: 'manual' | 'end_of_day' | 'admin'): Promise<boolean> {
    const db = this.prisma.forTenant(workspaceId);
    const { count } = await db.attendanceSession.updateMany({ where: { id: row.id, checkOutAt: null }, data: { checkOutAt: at, checkOutReason: reason } });
    if (count === 0) return false;
    const fresh = await db.attendanceSession.findFirstOrThrow({ where: { id: row.id }, include: SESSION_INCLUDE });
    await this.presence.checkOut(workspaceId, row.userId, at.getTime()).catch(() => undefined);
    await this.publishSession(workspaceId, 'attendance.checked_out', toSession(fresh), SYSTEM_ACTOR);
    return true;
  }

  private async publishSession(workspaceId: string, type: 'attendance.checked_in' | 'attendance.checked_out', session: AttendanceSession, actor: EventActor): Promise<void> {
    const user = await this.prisma.forTenant(workspaceId).user.findFirst({ where: { id: session.userId }, select: USER_SUMMARY_SELECT });
    if (!user) return;
    await publishSafe(this.events, this.logger, type, workspaceId, { session, user: toUserSummary(user) }, { actor });
  }
}

function simplifyPerSession<T extends { lat: number; lng: number; sessionId: string }>(points: T[], toleranceM: number): T[] {
  const out: T[] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || points[i]!.sessionId !== points[start]!.sessionId) {
      out.push(...simplifyRoute(points.slice(start, i), toleranceM));
      start = i;
    }
  }
  return out;
}

/** First activity, last offline after it, and online minutes from one day of status history. */
export function officeDay(events: Array<{ status: string; at: Date }>, until: number): { firstIn: string; lastOut: string | null; workedMin: number } | null {
  const first = events.find((e) => e.status !== 'offline');
  if (!first) return null;
  let worked = 0;
  let onlineSince: number | null = null;
  let lastOut: number | null = null;
  for (const e of events) {
    const t = e.at.getTime();
    if (e.status !== 'offline') {
      if (onlineSince === null) onlineSince = t;
      lastOut = null;
    } else if (onlineSince !== null) {
      worked += t - onlineSince;
      onlineSince = null;
      lastOut = t;
    }
  }
  if (onlineSince !== null) worked += Math.max(0, until - onlineSince);
  return { firstIn: first.at.toISOString(), lastOut: lastOut === null ? null : new Date(lastOut).toISOString(), workedMin: Math.floor(worked / 60_000) };
}
