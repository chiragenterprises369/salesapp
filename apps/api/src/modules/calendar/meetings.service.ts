import { Injectable, Logger } from '@nestjs/common';
import {
  expandOccurrences,
  MAX_CALENDAR_RANGE_DAYS,
  seriesEnd,
  type Meeting,
  type MeetingCancel,
  type MeetingCreate,
  type MeetingListQuery,
  type MeetingRespond,
  type MeetingUpdate,
  type Recurrence,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, forbidden, notFound } from '../../common/errors/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant, type TenantPrisma } from '../../infra/prisma/tenant.js';
import { publishSafe, requestActor, requirePermission, type TenantDb } from '../leads/lib/context.js';
import { safeTimezone, zonedParts } from '../leads/lib/tz.js';
import { MEETING_INCLUDE, parseRecurrence, toMeeting, type MeetingRow } from './calendar.mapper.js';

const DAY = 86_400_000;
const versionConflict = () => new AppException('VERSION_CONFLICT', 'Someone else changed this meeting. Reload to see the latest version.');

/** UTC offset (minutes) of a timezone at an instant (recurrence steps keep the wall-clock time). */
export function tzOffsetMinutes(tz: string, at: number): number {
  const p = zonedParts(new Date(at), safeTimezone(tz));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** Local YYYY-MM-DD of an instant (exception dates). */
export function localDate(tz: string, at: number): string {
  return new Date(at + tzOffsetMinutes(tz, at) * 60_000).toISOString().slice(0, 10);
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
  ) {}

  /** Organizer or an attending user in the caller's scope (attendees always see their meetings). */
  async visibleWhere(auth: AuthContext): Promise<Prisma.MeetingWhereInput> {
    const ids = await this.scope.visibleUserIds(auth);
    if (ids === null) return { deletedAt: null };
    const set = [...new Set([...ids, ...(auth.userId ? [auth.userId] : [])])];
    return { deletedAt: null, OR: [{ organizerId: { in: set } }, { attendees: { some: { userId: { in: set } } } }] };
  }

  async loadVisible(db: TenantDb, auth: AuthContext, id: string): Promise<MeetingRow> {
    const row = await db.meeting.findFirst({ where: { AND: [{ id }, await this.visibleWhere(auth)] }, include: MEETING_INCLUDE });
    if (!row) throw notFound('Meeting');
    return row;
  }

  /** Organizer, or a manager/admin whose scope includes the organizer. */
  private async assertCanEdit(auth: AuthContext, m: { organizerId: string | null }): Promise<void> {
    if (m.organizerId && m.organizerId === auth.userId) return;
    if (auth.dataScope !== 'own' && (await this.scope.canSee(auth, m.organizerId))) return;
    throw forbidden('Only the organizer can change this meeting');
  }

  private async timezone(db: TenantDb): Promise<string> {
    return (await db.workspace.findFirst({ select: { timezone: true } }))?.timezone ?? 'Asia/Kolkata';
  }

  private seriesEndAt(startAt: Date, endAt: Date, recurrence: Recurrence | null, tz: string): Date | null {
    const end = seriesEnd({ startAt: startAt.getTime(), durationMs: endAt.getTime() - startAt.getTime(), recurrence }, tzOffsetMinutes(tz, startAt.getTime()));
    return end === null ? null : new Date(end);
  }

  private async publish(auth: AuthContext, type: 'meeting.created' | 'meeting.updated', row: MeetingRow, changed: string[] = []): Promise<void> {
    const actor = await requestActor(this.prisma.forTenant(auth.workspaceId), auth);
    const meeting = toMeeting(row);
    if (type === 'meeting.created') await publishSafe(this.events, this.logger, type, auth.workspaceId, { meeting }, { actor: actor.event });
    else await publishSafe(this.events, this.logger, type, auth.workspaceId, { meeting, changed }, { actor: actor.event });
  }

  // ---------------------------------------------------------------- list

  async list(auth: AuthContext, q: MeetingListQuery): Promise<{ items: Meeting[] }> {
    const from = Date.parse(q.from);
    const to = Date.parse(q.to);
    if (!(to > from) || to - from > MAX_CALENDAR_RANGE_DAYS * DAY) {
      throw new AppException('VALIDATION_FAILED', `Pick a range of at most ${MAX_CALENDAR_RANGE_DAYS} days`, { details: [{ path: 'to', message: 'Range too long' }] });
    }
    const db = this.prisma.forTenant(auth.workspaceId);
    const users = q.userId?.length ? q.userId : ['me'];
    const who = users.includes('all') ? null : [...new Set(users.map((u) => (u === 'me' ? auth.userId : u)).filter((u): u is string => !!u))];
    const where: Prisma.MeetingWhereInput = {
      AND: [
        await this.visibleWhere(auth),
        { startAt: { lt: new Date(to) } },
        { OR: [{ recurrence: { equals: Prisma.DbNull }, endAt: { gt: new Date(from) } }, { NOT: { recurrence: { equals: Prisma.DbNull } }, OR: [{ seriesEndAt: null }, { seriesEndAt: { gt: new Date(from) } }] }] },
        ...(who ? [{ OR: [{ organizerId: { in: who } }, { attendees: { some: { userId: { in: who } } } }] }] : []),
        ...(q.leadId ? [{ leadId: q.leadId }] : []),
        ...(q.contactId ? [{ contactId: q.contactId }] : []),
        ...(q.accountId ? [{ companyId: q.accountId }] : []),
        ...(q.dealId ? [{ dealId: q.dealId }] : []),
        ...(q.status?.length ? [{ status: { in: q.status } }] : []),
      ],
    };
    const rows = await db.meeting.findMany({ where, include: MEETING_INCLUDE, orderBy: [{ startAt: 'asc' }, { id: 'asc' }], take: 2000 });
    const items: Meeting[] = [];
    for (const m of rows) {
      const recurrence = parseRecurrence(m.recurrence);
      const starts = expandOccurrences(
        { startAt: m.startAt.getTime(), durationMs: m.endAt.getTime() - m.startAt.getTime(), recurrence, exceptionDates: m.exceptionDates },
        from,
        to,
        tzOffsetMinutes(m.timezone, m.startAt.getTime()),
      );
      for (const s of starts) items.push(toMeeting(m, recurrence ? s : null));
    }
    items.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return { items: items.slice(0, 2000) };
  }

  async get(auth: AuthContext, id: string): Promise<Meeting> {
    return toMeeting(await this.loadVisible(this.prisma.forTenant(auth.workspaceId), auth, id));
  }

  // ---------------------------------------------------------------- create

  private async attendeeRows(db: TenantDb, workspaceId: string, organizerId: string | null, body: Pick<MeetingCreate, 'attendeeUserIds' | 'attendeeContactIds' | 'guests'>) {
    const userIds = [...new Set([...(organizerId ? [organizerId] : []), ...(body.attendeeUserIds ?? [])])];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, name: true, email: true } }) : [];
    if (users.length !== userIds.length) throw notFound('User');
    const contactIds = [...new Set(body.attendeeContactIds ?? [])];
    const contacts = contactIds.length ? await db.contact.findMany({ where: { id: { in: contactIds }, deletedAt: null }, select: { id: true, name: true, email: true } }) : [];
    if (contacts.length !== contactIds.length) throw notFound('Contact');
    return [
      ...users.map((u) => ({ workspaceId, userId: u.id, contactId: null, name: u.name, email: u.email, response: u.id === organizerId ? ('accepted' as const) : ('pending' as const) })),
      ...contacts.map((c) => ({ workspaceId, userId: null, contactId: c.id, name: c.name, email: c.email, response: 'pending' as const })),
      ...(body.guests ?? []).map((g) => ({ workspaceId, userId: null, contactId: null, name: g.name, email: g.email, response: 'pending' as const })),
    ];
  }

  async create(auth: AuthContext, body: MeetingCreate): Promise<Meeting> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const organizerId = body.organizerId ?? auth.userId;
    if (organizerId !== auth.userId) {
      requirePermission(auth, 'calendar.update', 'You cannot schedule meetings for others');
      if (!(await this.scope.canSee(auth, organizerId))) throw notFound('User');
    }
    await assertInTenant(db as TenantPrisma, { lead: body.leadId, contact: body.contactId, company: body.accountId, deal: body.dealId });
    const tz = body.timezone ?? (await this.timezone(db));
    const startAt = new Date(body.startAt);
    const endAt = new Date(body.endAt);
    const recurrence = body.recurrence ?? null;
    const attendees = await this.attendeeRows(db, wid, organizerId, body);
    const id = await db.$transaction(async (tx) => {
      const m = await tx.meeting.create({
        data: {
          workspaceId: wid,
          title: body.title,
          description: body.description ?? null,
          mode: body.mode,
          location: body.location ?? null,
          videoUrl: body.videoUrl ?? null,
          startAt,
          endAt,
          allDay: body.allDay,
          timezone: safeTimezone(tz),
          organizerId,
          leadId: body.leadId ?? null,
          contactId: body.contactId ?? null,
          companyId: body.accountId ?? null,
          dealId: body.dealId ?? null,
          reminders: [...new Set(body.reminders)].sort((a, b) => a - b),
          recurrence: recurrence ? (recurrence as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
          seriesEndAt: this.seriesEndAt(startAt, endAt, recurrence, tz),
          createdById: auth.userId,
        },
        select: { id: true },
      });
      if (attendees.length) await tx.meetingAttendee.createMany({ data: attendees.map((a) => ({ ...a, meetingId: m.id })) });
      if (body.contactId) await tx.contact.updateMany({ where: { id: body.contactId }, data: { lastActivityAt: new Date() } });
      if (body.accountId) await tx.company.updateMany({ where: { id: body.accountId }, data: { lastActivityAt: new Date() } });
      return m.id;
    });
    const row = await db.meeting.findUniqueOrThrow({ where: { id }, include: MEETING_INCLUDE });
    await this.publish(auth, 'meeting.created', row);
    return toMeeting(row);
  }

  // ---------------------------------------------------------------- update

  async update(auth: AuthContext, id: string, body: MeetingUpdate): Promise<Meeting> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const m = await this.loadVisible(db, auth, id);
    await this.assertCanEdit(auth, m);
    if (body.expectedVersion !== undefined && body.expectedVersion !== m.version) throw versionConflict();
    await assertInTenant(db as TenantPrisma, { lead: body.leadId, contact: body.contactId, company: body.accountId, deal: body.dealId });
    const recurrence = parseRecurrence(m.recurrence);

    if (body.scope === 'occurrence' && recurrence && body.occurrenceStart) {
      return this.detach(auth, db, m, body);
    }

    const startAt = body.startAt ? new Date(body.startAt) : m.startAt;
    const endAt = body.endAt ? new Date(body.endAt) : body.startAt ? new Date(startAt.getTime() + (m.endAt.getTime() - m.startAt.getTime())) : m.endAt;
    if (endAt <= startAt) throw new AppException('VALIDATION_FAILED', 'The end must be after the start', { details: [{ path: 'endAt', message: 'Before start' }] });
    const nextRecurrence = body.recurrence !== undefined ? body.recurrence : recurrence;
    const tz = body.timezone ?? m.timezone;
    const changed = Object.keys(body).filter((k) => !['scope', 'occurrenceStart', 'expectedVersion'].includes(k));
    const replaceAttendees = body.attendeeUserIds !== undefined || body.attendeeContactIds !== undefined || body.guests !== undefined || (body.organizerId !== undefined && body.organizerId !== m.organizerId);
    const organizerId = body.organizerId ?? m.organizerId;
    if (organizerId !== m.organizerId && organizerId && !(await this.scope.canSee(auth, organizerId))) throw notFound('User');
    const attendees = replaceAttendees
      ? await this.attendeeRows(db, wid, organizerId, {
          attendeeUserIds: body.attendeeUserIds ?? m.attendees.filter((a) => a.userId && a.userId !== m.organizerId).map((a) => a.userId!),
          attendeeContactIds: body.attendeeContactIds ?? m.attendees.filter((a) => a.contactId).map((a) => a.contactId!),
          guests: body.guests ?? m.attendees.filter((a) => !a.userId && !a.contactId).map((a) => ({ name: a.name, email: a.email })),
        })
      : null;
    await db.$transaction(async (tx) => {
      const res = await tx.meeting.updateMany({
        where: { id, version: m.version, deletedAt: null },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.mode !== undefined ? { mode: body.mode } : {}),
          ...(body.location !== undefined ? { location: body.location } : {}),
          ...(body.videoUrl !== undefined ? { videoUrl: body.videoUrl } : {}),
          ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
          ...(body.timezone !== undefined ? { timezone: safeTimezone(body.timezone) } : {}),
          ...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.accountId !== undefined ? { companyId: body.accountId } : {}),
          ...(body.dealId !== undefined ? { dealId: body.dealId } : {}),
          ...(body.reminders !== undefined ? { reminders: [...new Set(body.reminders)].sort((a, b) => a - b) } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
          ...(body.recurrence !== undefined ? { recurrence: body.recurrence ? (body.recurrence as unknown as Prisma.InputJsonObject) : Prisma.DbNull } : {}),
          organizerId,
          startAt,
          endAt,
          seriesEndAt: this.seriesEndAt(startAt, endAt, nextRecurrence, tz),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();
      if (attendees) {
        await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
        if (attendees.length) await tx.meetingAttendee.createMany({ data: attendees.map((a) => ({ ...a, meetingId: id })) });
      }
    });
    const row = await db.meeting.findUniqueOrThrow({ where: { id }, include: MEETING_INCLUDE });
    await this.publish(auth, 'meeting.updated', row, changed);
    return toMeeting(row);
  }

  /** One occurrence of a series becomes its own meeting (copy + changes); the series skips that date. */
  private async detach(auth: AuthContext, db: TenantPrisma, m: MeetingRow, body: MeetingUpdate): Promise<Meeting> {
    const wid = auth.workspaceId;
    const occ = Date.parse(body.occurrenceStart!);
    const duration = m.endAt.getTime() - m.startAt.getTime();
    const recurrence = parseRecurrence(m.recurrence);
    const valid = expandOccurrences({ startAt: m.startAt.getTime(), durationMs: duration, recurrence, exceptionDates: m.exceptionDates }, occ, occ + 1, tzOffsetMinutes(m.timezone, m.startAt.getTime()));
    if (!valid.includes(occ)) throw new AppException('VALIDATION_FAILED', 'That occurrence is not part of this series', { details: [{ path: 'occurrenceStart', message: 'Unknown occurrence' }] });
    const startAt = body.startAt ? new Date(body.startAt) : new Date(occ);
    const endAt = body.endAt ? new Date(body.endAt) : new Date(startAt.getTime() + duration);
    const day = localDate(m.timezone, occ);
    const newId = await db.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: m.id }, data: { exceptionDates: [...new Set([...m.exceptionDates, day])], version: { increment: 1 } } });
      const copy = await tx.meeting.create({
        data: {
          workspaceId: wid,
          title: body.title ?? m.title,
          description: body.description !== undefined ? body.description : m.description,
          mode: body.mode ?? m.mode,
          location: body.location !== undefined ? body.location : m.location,
          videoUrl: body.videoUrl !== undefined ? body.videoUrl : m.videoUrl,
          startAt,
          endAt,
          allDay: body.allDay ?? m.allDay,
          timezone: m.timezone,
          status: body.status ?? 'scheduled',
          organizerId: m.organizerId,
          leadId: body.leadId !== undefined ? body.leadId : m.leadId,
          contactId: body.contactId !== undefined ? body.contactId : m.contactId,
          companyId: body.accountId !== undefined ? body.accountId : m.companyId,
          dealId: body.dealId !== undefined ? body.dealId : m.dealId,
          reminders: body.reminders ?? m.reminders,
          recurrence: Prisma.DbNull,
          seriesId: m.id,
          outcome: body.outcome !== undefined ? body.outcome : null,
          createdById: auth.userId,
        },
        select: { id: true },
      });
      await tx.meetingAttendee.createMany({ data: m.attendees.map((a) => ({ workspaceId: wid, meetingId: copy.id, userId: a.userId, contactId: a.contactId, name: a.name, email: a.email, response: a.response })) });
      return copy.id;
    });
    const series = await db.meeting.findUniqueOrThrow({ where: { id: m.id }, include: MEETING_INCLUDE });
    const row = await db.meeting.findUniqueOrThrow({ where: { id: newId }, include: MEETING_INCLUDE });
    await this.publish(auth, 'meeting.updated', series, ['exceptionDates']);
    await this.publish(auth, 'meeting.created', row);
    return toMeeting(row);
  }

  // ---------------------------------------------------------------- cancel, respond, delete

  async cancel(auth: AuthContext, id: string, body: MeetingCancel): Promise<Meeting> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const m = await this.loadVisible(db, auth, id);
    await this.assertCanEdit(auth, m);
    if (body.occurrenceStart && m.recurrence) {
      const day = localDate(m.timezone, Date.parse(body.occurrenceStart));
      await db.meeting.updateMany({ where: { id }, data: { exceptionDates: [...new Set([...m.exceptionDates, day])], version: { increment: 1 } } });
    } else {
      await db.meeting.updateMany({ where: { id }, data: { status: 'cancelled', cancelReason: body.reason ?? null, version: { increment: 1 } } });
    }
    const row = await db.meeting.findUniqueOrThrow({ where: { id }, include: MEETING_INCLUDE });
    await this.publish(auth, 'meeting.updated', row, [body.occurrenceStart ? 'exceptionDates' : 'status']);
    return toMeeting(row);
  }

  async respond(auth: AuthContext, id: string, body: MeetingRespond): Promise<Meeting> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const m = await this.loadVisible(db, auth, id);
    const mine = m.attendees.find((a) => a.userId === auth.userId);
    if (!mine) throw new AppException('VALIDATION_FAILED', 'You are not invited to this meeting');
    await db.meetingAttendee.updateMany({ where: { id: mine.id }, data: { response: body.response, respondedAt: new Date() } });
    await db.meeting.updateMany({ where: { id }, data: { version: { increment: 1 } } });
    const row = await db.meeting.findUniqueOrThrow({ where: { id }, include: MEETING_INCLUDE });
    await this.publish(auth, 'meeting.updated', row, ['attendees']);
    return toMeeting(row);
  }

  async remove(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const m = await this.loadVisible(db, auth, id);
    await this.assertCanEdit(auth, m);
    await db.meeting.updateMany({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'meeting.deleted', wid, { meetingId: id, organizerId: m.organizerId, attendeeUserIds: m.attendees.map((a) => a.userId).filter((u): u is string => !!u) }, { actor: actor.event });
    return { ok: true };
  }

  /** Meetings linked to a record (related lists): upcoming first, then up to 20 past ones. */
  async related(auth: AuthContext, where: Prisma.MeetingWhereInput): Promise<Meeting[]> {
    if (!auth.permissions.includes('calendar.read')) return [];
    const db = this.prisma.forTenant(auth.workspaceId);
    const now = new Date();
    const base = { AND: [where, await this.visibleWhere(auth)] };
    const [upcoming, past] = await Promise.all([
      db.meeting.findMany({ where: { AND: [base, { OR: [{ endAt: { gte: now } }, { seriesEndAt: { gte: now } }] }] }, include: MEETING_INCLUDE, orderBy: { startAt: 'asc' }, take: 30 }),
      db.meeting.findMany({ where: { AND: [base, { endAt: { lt: now } }, { OR: [{ seriesEndAt: null }, { seriesEndAt: { lt: now } }] }] }, include: MEETING_INCLUDE, orderBy: { startAt: 'desc' }, take: 20 }),
    ]);
    return [...upcoming, ...past].map((m) => toMeeting(m));
  }
}
