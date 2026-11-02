import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { expandOccurrences, formatDuration } from '@vistar/shared';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { isUniqueViolation } from '../crm/lib/db.js';
import { publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MEETING_INCLUDE, parseRecurrence, toMeeting } from './calendar.mapper.js';
import { tzOffsetMinutes } from './meetings.service.js';

/** Reminders fire when their time has passed by at most this much (a missed minute still fires once). */
const GRACE_MS = 3 * 60_000;
const MAX_LEAD_MS = 10_080 * 60_000;

/**
 * Every minute: for scheduled meetings whose reminder time (occurrence start minus `reminders[i]`
 * minutes) fell in the last GRACE_MS, notify the organizer and the attending users (not declined) once.
 * A MeetingReminderLog row (unique per meeting, occurrence and offset) is claimed first, so several API
 * instances never send twice. Notification `meeting_reminder` + event `meeting.reminder` (user room).
 */
@Injectable()
export class MeetingRemindersScheduler {
  private readonly logger = new Logger(MeetingRemindersScheduler.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'meeting-reminders' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.scan();
      if (n) this.logger.log(`Sent ${n} meeting reminder(s)`);
    } catch (err) {
      this.logger.error(`Meeting reminder scan failed: ${(err as Error).name}`);
    } finally {
      this.running = false;
    }
  }

  /** Root client on purpose: one scan over every workspace; per-meeting writes go through forTenant(). */
  async scan(at = Date.now()): Promise<number> {
    const now = new Date(at);
    const candidates = await this.prisma.meeting.findMany({
      where: {
        deletedAt: null,
        status: 'scheduled',
        startAt: { lte: new Date(at + MAX_LEAD_MS) },
        OR: [{ endAt: { gte: new Date(at - GRACE_MS) } }, { seriesEndAt: { gte: now } }],
        NOT: { reminders: { isEmpty: true } },
      },
      include: MEETING_INCLUDE,
      take: 1000,
    });
    let sent = 0;
    for (const m of candidates) {
      const recurrence = parseRecurrence(m.recurrence);
      const maxLead = Math.max(...m.reminders) * 60_000;
      const starts = expandOccurrences(
        { startAt: m.startAt.getTime(), durationMs: m.endAt.getTime() - m.startAt.getTime(), recurrence, exceptionDates: m.exceptionDates },
        at - GRACE_MS,
        at + maxLead + 60_000,
        tzOffsetMinutes(m.timezone, m.startAt.getTime()),
      );
      for (const occ of starts) {
        for (const minutes of m.reminders) {
          const fireAt = occ - minutes * 60_000;
          if (fireAt > at || fireAt < at - GRACE_MS) continue;
          const db = this.prisma.forTenant(m.workspaceId);
          try {
            await db.meetingReminderLog.create({ data: { workspaceId: m.workspaceId, meetingId: m.id, occurrenceStart: new Date(occ), minutesBefore: minutes } });
          } catch (err) {
            if (isUniqueViolation(err)) continue;
            throw err;
          }
          const meeting = toMeeting(m, recurrence ? occ : null);
          const recipients = new Set<string>([...(m.organizerId ? [m.organizerId] : []), ...m.attendees.filter((a) => a.userId && a.response !== 'declined').map((a) => a.userId!)]);
          const when = minutes === 0 ? 'now' : `in ${formatDuration(minutes * 60)}`;
          for (const userId of recipients) {
            await this.notifications.notify(m.workspaceId, userId, {
              type: 'meeting_reminder',
              title: `Meeting ${when}: ${m.title}`,
              body: [m.location, m.videoUrl].filter(Boolean).join(' · ') || null,
              path: `/calendar?meeting=${m.id}`,
              data: { meetingId: m.id, occurrenceStart: new Date(occ).toISOString(), leadId: m.leadId },
            });
            await publishSafe(this.events, this.logger, 'meeting.reminder', m.workspaceId, { meeting, occurrenceStart: new Date(occ).toISOString(), minutesBefore: minutes }, { actor: SYSTEM_ACTOR, userId });
            sent++;
          }
        }
      }
    }
    return sent;
  }
}
