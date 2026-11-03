import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { API_ROUTES, type DomainEvent } from '@vistar/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../../../config/env.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { EventBus } from '../../../infra/events/event-bus.service.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { KvStore } from '../../auth/state/kv.store.js';
import { IntegrationStore, providerSyncHooks, type IntegrationRow } from '../../integrations/integration-store.js';
import { googleClient, googleConfigured } from '../../integrations/providers/adapters.js';
import { publishSafe } from '../../leads/lib/context.js';
import { MEETING_INCLUDE, toMeeting, type MeetingRow } from '../calendar.mapper.js';
import { GoogleApiError, GoogleCalendarClient } from './google-calendar.client.js';
import { googleEventId, incomingPatch, meetingIdOf, toGoogleEvent, type GoogleEvent } from './google-calendar.mapper.js';

/** Event actor name of changes that came from Google (never pushed back). */
export const GOOGLE_ACTOR_NAME = 'Google Calendar';
const PUSH_DEDUPE_TTL_SEC = 900;
const POLL_LEASE_TTL_SEC = 240;
const WATCH_TTL_SEC = 7 * 86_400;
const WATCH_RENEW_BEFORE_MS = 86_400_000;
const MAX_PENDING = 200;
const MAX_FULL_SYNC_PAGES = 20;
const RECEIVE_DEBOUNCE_MS = 3_000;

interface GoogleSyncState {
  syncToken?: string | null;
  lastPollAt?: string;
  lastPushAt?: string;
  channelId?: string;
  resourceId?: string;
  channelExpiresAt?: string;
  /** Meeting ids whose last push failed (retried by the poll). */
  pending?: string[];
  pushed?: number;
  pulled?: number;
  webhookVerifiedAt?: string;
}

interface GoogleConfig {
  calendarId?: string;
  pushMeetings?: boolean;
  accountEmail?: string;
}

/**
 * Google Calendar sync of meetings (change #20, D-075). One Google account per workspace (the Integration hub
 * connection, `calendarId` default primary):
 *  - push: meeting.created / meeting.updated / meeting.deleted events (deduplicated per event across API instances)
 *    create, update, cancel or delete the Google event whose id derives from the meeting id; the organiser and
 *    every attendee with an e-mail are guests (sendUpdates=none). Failed pushes are retried by the poll.
 *  - pull: every 5 minutes (one instance, Redis lease) an incremental events.list with the stored sync token, and at
 *    once when a watch channel notification arrives (https API_PUBLIC_URL only). Changes to Vistar-made events
 *    (title, place, time of single meetings, cancellation) update the meeting with actor "Google Calendar".
 *  - mock mode (development): no network; pushes are counted in the integration stats.
 */
@Injectable()
export class GoogleCalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GoogleCalendarSyncService.name);
  private unsubscribe: (() => void) | null = null;
  private readonly chains = new Map<string, Promise<void>>();
  private readonly receiveTimers = new Map<string, NodeJS.Timeout>();
  private readonly env = getEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IntegrationStore,
    private readonly events: EventBus,
    private readonly kv: KvStore,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe((e) => this.onEvent(e));
    providerSyncHooks.google_calendar = (workspaceId) => this.syncWorkspace(workspaceId);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const t of this.receiveTimers.values()) clearTimeout(t);
  }

  // ---------------------------------------------------------------- push

  private async onEvent(e: DomainEvent): Promise<void> {
    if (e.type !== 'meeting.created' && e.type !== 'meeting.updated' && e.type !== 'meeting.deleted') return;
    if (e.actor?.type === 'integration' && e.actor.name === GOOGLE_ACTOR_NAME) return;
    if (!(await this.kv.setNx(`gcal:push:${e.id}`, '1', PUSH_DEDUPE_TTL_SEC))) return; // another instance has it
    const row = await this.connection(e.workspaceId);
    if (!row) return;
    const meetingId = e.type === 'meeting.deleted' ? (e.payload as { meetingId: string }).meetingId : (e.payload as { meeting: { id: string } }).meeting.id;
    await this.serial(meetingId, () => this.push(e.workspaceId, row, meetingId, e.type === 'meeting.deleted'));
  }

  /** One push at a time per meeting; each push reads the latest row, so the last one wins with current data. */
  private serial(key: string, job: () => Promise<void>): Promise<void> {
    const next = (this.chains.get(key) ?? Promise.resolve()).then(job, job);
    this.chains.set(key, next.catch(() => undefined));
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
    return next;
  }

  /** Connected Google integration with pushMeetings on, else null. */
  private async connection(workspaceId: string): Promise<IntegrationRow | null> {
    const row = await this.store.row(workspaceId, 'google_calendar');
    if (!row || row.status === 'not_connected' || row.status === 'error') return null;
    if ((row.config as GoogleConfig).pushMeetings === false) return null;
    if (row.mode === 'mock' && this.env.NODE_ENV === 'production') return null;
    if (row.mode === 'live' && !googleConfigured()) return null;
    return row;
  }

  private client(row: IntegrationRow): GoogleCalendarClient | null {
    const secrets = this.store.secretsOf(row);
    if (!secrets.refreshToken) return null;
    const auth = googleClient();
    auth.setCredentials({ refresh_token: secrets.refreshToken });
    return new GoogleCalendarClient(auth, (row.config as GoogleConfig).calendarId || 'primary');
  }

  private link(meetingId: string): string {
    return `${this.env.WEB_ORIGIN.split(',')[0]!.trim().replace(/\/$/, '')}/app/calendar?meeting=${meetingId}`;
  }

  async push(workspaceId: string, row: IntegrationRow, meetingId: string, deleted: boolean): Promise<void> {
    const db = this.store.db(workspaceId);
    const meeting = deleted ? null : await db.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, include: MEETING_INCLUDE });
    try {
      if (row.mode === 'mock') {
        await this.note(workspaceId, row, (s) => ({ ...s, pushed: (s.pushed ?? 0) + 1, lastPushAt: new Date().toISOString(), pending: (s.pending ?? []).filter((id) => id !== meetingId) }));
        return;
      }
      const client = this.client(row);
      if (!client) return;
      const eventId = googleEventId(meetingId);
      if (!meeting) await client.remove(eventId);
      else await client.upsert(eventId, toGoogleEvent(meeting, { workspaceId, link: this.link(meetingId), reminders: true }));
      await this.note(workspaceId, row, (s) => ({ ...s, pushed: (s.pushed ?? 0) + 1, lastPushAt: new Date().toISOString(), pending: (s.pending ?? []).filter((id) => id !== meetingId) }));
    } catch (err) {
      const e = err instanceof GoogleApiError ? err : null;
      this.logger.warn(`Google Calendar push failed for workspace ${workspaceId} (${e ? `${e.status} ${e.reason ?? ''}` : (err as Error).name})`);
      await this.note(workspaceId, row, (s) => ({ ...s, pending: [...new Set([...(s.pending ?? []), meetingId])].slice(-MAX_PENDING) }), e?.revoked ? 'revoked' : 'failed');
    }
  }

  /** Update syncState (and the status after an auth failure), publish integration.updated when the status changes. */
  private async note(workspaceId: string, row: IntegrationRow, change: (s: GoogleSyncState) => GoogleSyncState, problem?: 'revoked' | 'failed'): Promise<void> {
    const db = this.store.db(workspaceId);
    const fresh = (await db.integration.findFirst({ where: { id: row.id } })) ?? row;
    const state = change({ ...((fresh.syncState ?? {}) as GoogleSyncState) });
    const stats = { ...((fresh.stats ?? {}) as Record<string, unknown>), pushed: state.pushed ?? 0, pulled: state.pulled ?? 0, pending: state.pending?.length ?? 0, lastPushAt: state.lastPushAt ?? null };
    const data: Prisma.IntegrationUncheckedUpdateInput = { syncState: state as Prisma.InputJsonObject, stats: stats as Prisma.InputJsonObject };
    if (problem === 'revoked') Object.assign(data, { status: 'needs_attention', attention: 'Google access was revoked: connect again', lastError: 'Google access was revoked' });
    else if (problem === 'failed') Object.assign(data, { lastError: `Some meetings could not be copied to Google Calendar (${state.pending?.length ?? 0} waiting)` });
    else if (fresh.lastError?.startsWith('Some meetings could not be copied')) Object.assign(data, { lastError: null });
    const updated = await db.integration.update({ where: { id: row.id }, data });
    if (updated.status !== fresh.status || updated.lastError !== fresh.lastError) await this.store.publish(workspaceId, updated, 'google_calendar');
  }

  // ---------------------------------------------------------------- pull

  /** Every 5 minutes on one instance: watch renewal, incremental pull, retries of failed pushes. */
  @Cron('*/5 * * * *', { name: 'google-calendar-sync' })
  async poll(): Promise<void> {
    if (process.env.HUB_BACKGROUND_JOBS === 'off' || !googleConfigured()) return;
    if (!(await this.kv.setNx('gcal:poll:lease', randomUUID(), POLL_LEASE_TTL_SEC))) return;
    const rows = await this.prisma.integration.findMany({ where: { provider: 'google_calendar', mode: 'live', status: { in: ['connected', 'needs_attention'] } }, take: 1000 });
    for (const row of rows) {
      try {
        await this.syncWorkspace(row.workspaceId);
      } catch (err) {
        this.logger.warn(`Google Calendar pull failed for workspace ${row.workspaceId} (${(err as Error).name})`);
      }
    }
  }

  /** Pull changes for one workspace (poll, watch notification, "Sync now"). */
  async syncWorkspace(workspaceId: string): Promise<{ pulled: number; applied: number }> {
    const row = await this.connection(workspaceId);
    if (!row || row.mode !== 'live') return { pulled: 0, applied: 0 };
    const client = this.client(row);
    if (!client) return { pulled: 0, applied: 0 };
    const state = { ...((row.syncState ?? {}) as GoogleSyncState) };
    let pulled = 0;
    let applied = 0;
    try {
      await this.ensureWatch(workspaceId, row, client, state);
      let syncToken = state.syncToken ?? undefined;
      let pageToken: string | undefined;
      let pages = 0;
      let nextSyncToken: string | undefined;
      do {
        let page;
        try {
          page = await client.list({ syncToken: pageToken ? undefined : syncToken, pageToken });
        } catch (err) {
          if (err instanceof GoogleApiError && err.status === 410 && syncToken) {
            syncToken = undefined; // token expired: full sync from the start
            pageToken = undefined;
            continue;
          }
          throw err;
        }
        for (const e of page.items ?? []) {
          pulled++;
          if (await this.applyIncoming(workspaceId, row, e)) applied++;
        }
        pageToken = page.nextPageToken;
        nextSyncToken = page.nextSyncToken ?? nextSyncToken;
        pages++;
      } while (pageToken && pages < MAX_FULL_SYNC_PAGES);
      // retry failed pushes
      for (const id of state.pending ?? []) await this.serial(id, async () => this.push(workspaceId, row, id, !(await this.store.db(workspaceId).meeting.count({ where: { id, deletedAt: null } }))));
      await this.note(workspaceId, row, (s) => ({ ...s, ...(nextSyncToken ? { syncToken: nextSyncToken } : {}), lastPollAt: new Date().toISOString(), pulled: (s.pulled ?? 0) + applied, channelId: state.channelId, resourceId: state.resourceId, channelExpiresAt: state.channelExpiresAt }));
      await this.store.db(workspaceId).integration.update({ where: { id: row.id }, data: { lastSyncAt: new Date() } });
    } catch (err) {
      const revoked = err instanceof GoogleApiError && err.revoked;
      await this.note(workspaceId, row, (s) => s, revoked ? 'revoked' : undefined);
      if (!revoked) throw err;
    }
    return { pulled, applied };
  }

  /** Apply one changed Google event to its meeting. Returns true when the meeting changed. */
  private async applyIncoming(workspaceId: string, row: IntegrationRow, e: GoogleEvent): Promise<boolean> {
    const meetingId = e.id ? meetingIdOf(e.id) : null;
    if (!meetingId || e.recurringEventId) return false; // not ours, or one instance of a series
    const db = this.store.db(workspaceId);
    const m = (await db.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, include: MEETING_INCLUDE })) as MeetingRow | null;
    if (!m) return false;
    const patch = incomingPatch(e, m);
    if (!patch) return false;
    const data: Prisma.MeetingUncheckedUpdateManyInput = { version: { increment: 1 } };
    const changed: string[] = [];
    if (patch.cancel) {
      data.status = 'cancelled';
      data.cancelReason = 'Cancelled in Google Calendar';
      changed.push('status');
    }
    if (patch.title) {
      data.title = patch.title;
      changed.push('title');
    }
    if (patch.location !== undefined) {
      data.location = patch.location;
      changed.push('location');
    }
    if (patch.startAt) {
      data.startAt = patch.startAt;
      changed.push('startAt');
    }
    if (patch.endAt) {
      data.endAt = patch.endAt;
      changed.push('endAt');
    }
    const res = await db.meeting.updateMany({ where: { id: m.id, version: m.version }, data });
    if (res.count !== 1) return false; // changed in Vistar meanwhile: Vistar wins, the next push overwrites Google
    const updated = await db.meeting.findUniqueOrThrow({ where: { id: m.id }, include: MEETING_INCLUDE });
    await publishSafe(this.events, this.logger, 'meeting.updated', workspaceId, { meeting: toMeeting(updated), changed }, { actor: { type: 'integration', id: row.id, name: GOOGLE_ACTOR_NAME } });
    return true;
  }

  // ---------------------------------------------------------------- watch channels

  private watchAddress(): string | null {
    if (!('googleCalendarWebhook' in API_ROUTES)) return null; // receiver route not in the contract
    const api = this.env.API_PUBLIC_URL.replace(/\/$/, '');
    if (!api.startsWith('https://') || /\/\/(localhost|127\.0\.0\.1)/.test(api)) return null;
    return `${api}/api/hooks/google-calendar`;
  }

  private channelToken(workspaceId: string, channelId: string): string {
    const key = Buffer.from(this.env.ENCRYPTION_KEY, 'base64');
    const mac = createHmac('sha256', key).update(`gcal-channel:${workspaceId}:${channelId}`).digest('hex').slice(0, 40);
    return `${workspaceId}.${mac}`;
  }

  private async ensureWatch(workspaceId: string, row: IntegrationRow, client: GoogleCalendarClient, state: GoogleSyncState): Promise<void> {
    const address = this.watchAddress();
    if (!address) return;
    const expires = state.channelExpiresAt ? Date.parse(state.channelExpiresAt) : 0;
    if (state.channelId && expires - Date.now() > WATCH_RENEW_BEFORE_MS) return;
    const id = randomUUID();
    try {
      const res = await client.watch({ id, address, token: this.channelToken(workspaceId, id), ttlSec: WATCH_TTL_SEC });
      if (state.channelId && state.resourceId) await client.stop({ id: state.channelId, resourceId: state.resourceId });
      state.channelId = res.id;
      state.resourceId = res.resourceId;
      state.channelExpiresAt = res.expiration ? new Date(Number(res.expiration)).toISOString() : new Date(Date.now() + WATCH_TTL_SEC * 1000).toISOString();
    } catch (err) {
      // Push notifications are an optimisation: the 5-minute poll keeps working without them.
      this.logger.warn(`Google Calendar watch not set up for workspace ${workspaceId} (${err instanceof GoogleApiError ? err.status : (err as Error).name})`);
    }
  }

  /**
   * Watch channel notification (POST /api/hooks/google-calendar): verifies the channel token, then pulls the
   * workspace's changes shortly after (notifications come in bursts). Always answers quickly.
   */
  async receive(headers: { channelId?: string; token?: string; resourceState?: string }): Promise<{ ok: true }> {
    const { channelId, token } = headers;
    if (!channelId || !token || !token.includes('.')) return { ok: true };
    const workspaceId = token.split('.')[0]!;
    const expected = this.channelToken(workspaceId, channelId);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: true }; // unknown channel: ignore quietly
    if (headers.resourceState === 'sync') return { ok: true }; // the handshake right after watch()
    const existing = this.receiveTimers.get(workspaceId);
    if (existing) return { ok: true };
    const timer = setTimeout(() => {
      this.receiveTimers.delete(workspaceId);
      void this.kv.setNx(`gcal:recv:${workspaceId}`, '1', 10).then((first) => (first ? this.syncWorkspace(workspaceId) : undefined)).catch((err: Error) => this.logger.warn(`Google Calendar pull after notification failed (${err.name})`));
    }, RECEIVE_DEBOUNCE_MS);
    timer.unref();
    this.receiveTimers.set(workspaceId, timer);
    return { ok: true };
  }
}
