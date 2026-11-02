import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  HEARTBEAT_INTERVAL_MS,
  presenceToEmployeeStatus,
  type AppScreen,
  type BusinessHours,
  type EventActor,
  type EventPayload,
  type MyPresence,
  type Presence,
  type PresenceEvent,
  type ZoneSignal,
} from '@vistar/shared';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { stableUuid } from '../realtime/ids.js';
import {
  initialState,
  manualUntil,
  nextDeadline,
  PRESENCE_TIMEOUT_MS,
  reduce,
  viewOf,
  type ClientKind,
  type DeviceActivity,
  type ManualStatus,
  type PresenceContext,
  type PresenceInput,
  type PresenceState,
  type PresenceStatus,
  type PresenceView,
  type StatusChange,
} from './engine/status-engine.js';
import { isWithinWorkingHours } from './engine/working-hours.js';
import { decayedConfidence, type ZoneChange, type ZoneCurrent, type ZoneObservation } from './engine/zone-engine.js';
import { OfficeMarkersService } from './office-markers.service.js';
import { PresenceStore } from './presence.store.js';

/** Sweeper period: users whose deadline passed are re-evaluated (offline after 45 s, call timeouts). */
export const SWEEP_MS = 5_000;
const CONTEXT_TTL_MS = 60_000;
/** Presence.lastSeenAt / User.lastSeenAt are refreshed at most this often between status changes. */
const SEEN_PERSIST_MS = 60_000;

export interface PresenceWho {
  workspaceId: string;
  userId: string;
  sessionId?: string | null;
}

interface CachedContext {
  ctx: PresenceContext;
  at: number;
}

const SYSTEM: EventActor = { type: 'system', id: null, name: 'presence' };

/**
 * Server-authoritative presence (D-062). Every observed fact goes through `ingest()`: per-user lock,
 * pure engine (`reduce`), then for a visible change ONE PresenceEvent row + the Presence row + the coarse
 * User.status in one transaction, the new state in Redis, and ONE `employee.status_changed` event, in
 * version order. A sweeper (every 5 s, one instance at a time through a Redis lease) re-evaluates users
 * whose deadline passed (heartbeat timeout, call safety timeout, manual expiry, working-hours edges).
 */
@Injectable()
export class PresenceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PresenceService.name);
  private readonly contexts = new Map<string, CachedContext>();
  private readonly seenPersisted = new Map<string, number>();
  private sweeping = false;
  /** Tests stop the timer-driven sweeper and call sweep() themselves. */
  autoSweep = true;

  constructor(
    private readonly store: PresenceStore,
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly markers: OfficeMarkersService,
  ) {}

  onApplicationBootstrap(): void {
    // Users the database still shows online but Redis has no state for (Redis flushed): re-evaluate once.
    setTimeout(() => void this.reconcile().catch((err: Error) => this.logger.warn(`presence reconcile failed: ${err.message}`)), 2_000).unref();
  }

  // ---------------------------------------------------------------- inputs

  /**
   * A heartbeat (socket or REST). `screen` undefined keeps the device's last screen; `appDeviceId` is the
   * app's own device id (matches its live calls); `zone` is an optional zone signal sent along.
   */
  async heartbeat(
    who: PresenceWho,
    beat: { deviceId: string; client: ClientKind; activity: DeviceActivity; screen?: AppScreen | null; appDeviceId?: string | null; zone?: ZoneSignal | null },
  ): Promise<PresenceView | null> {
    const now = Date.now();
    // An unknown QR token on a heartbeat must not cost the heartbeat: the zone part is dropped.
    const zone = beat.zone ? await this.markers.observe(who.workspaceId, beat.zone, now).catch(() => [] as ZoneObservation[]) : undefined;
    return this.ingest(who.workspaceId, who.userId, {
      type: 'heartbeat',
      deviceId: beat.deviceId,
      client: beat.client,
      activity: beat.activity,
      sessionId: who.sessionId ?? null,
      at: now,
      ...(beat.screen !== undefined ? { screen: beat.screen } : {}),
      ...(beat.appDeviceId ? { appDeviceId: beat.appDeviceId } : {}),
      ...(zone ? { zone } : {}),
    });
  }

  /** Where in the office (POST /me/presence/zone). Throws for an unknown marker token or zone. */
  async zoneSignal(who: PresenceWho, signal: ZoneSignal): Promise<PresenceView | null> {
    const observations = await this.markers.observe(who.workspaceId, signal);
    return this.ingest(who.workspaceId, who.userId, { type: 'zone', observations });
  }

  deviceGone(workspaceId: string, userId: string, deviceId: string): Promise<PresenceView | null> {
    return this.ingest(workspaceId, userId, { type: 'logout', sessionId: null, deviceId, at: Date.now() });
  }

  logout(workspaceId: string, userId: string, sessionId: string | null): Promise<PresenceView | null> {
    return this.ingest(workspaceId, userId, { type: 'logout', sessionId, at: Date.now() });
  }

  manual(who: PresenceWho, status: ManualStatus, note: string | null): Promise<PresenceView | null> {
    return this.ingest(who.workspaceId, who.userId, { type: 'manual', status, note, at: Date.now() });
  }

  callStarted(workspaceId: string, userId: string, call: { callId: string; deviceId?: string | null; leadId: string | null; leadName: string | null; startedAt: number; signal?: 'phone_state' | 'telephony' }) {
    return this.ingest(workspaceId, userId, { type: 'call_started', callId: call.callId, deviceId: call.deviceId ?? null, leadId: call.leadId, leadName: call.leadName, at: call.startedAt, signal: call.signal });
  }

  callEnded(workspaceId: string, userId: string, call: { callId: string; endedAt: number; signal?: 'phone_state' | 'telephony' }) {
    return this.ingest(workspaceId, userId, { type: 'call_ended', callId: call.callId, at: call.endedAt, signal: call.signal });
  }

  callLog(workspaceId: string, userId: string, entry: { callId?: string | null; deviceId?: string | null; startedAt: number; endedAt: number }) {
    return this.ingest(workspaceId, userId, { type: 'call_log', callId: entry.callId ?? null, deviceId: entry.deviceId ?? null, startedAt: entry.startedAt, endedAt: entry.endedAt });
  }

  checkIn(workspaceId: string, userId: string, at = Date.now()) {
    this.contexts.delete(`${workspaceId}:${userId}`);
    return this.ingest(workspaceId, userId, { type: 'check_in', at });
  }

  checkOut(workspaceId: string, userId: string, at = Date.now()) {
    return this.ingest(workspaceId, userId, { type: 'check_out', at });
  }

  /** Re-evaluate a user now (time passing only). */
  tick(workspaceId: string, userId: string): Promise<PresenceView | null> {
    return this.ingest(workspaceId, userId, { type: 'tick' });
  }

  // ---------------------------------------------------------------- reads

  /**
   * Current views of users that have presence state. A state whose deadline passed but the sweeper has
   * not reached yet is re-evaluated first (persisted and published like any change), so a snapshot
   * never shows something the events are about to contradict.
   */
  async views(workspaceId: string, userIds: readonly string[]): Promise<Map<string, PresenceView>> {
    const now = Date.now();
    const states = await this.store.readMany(workspaceId, userIds);
    const out = new Map<string, PresenceView>();
    for (const uid of userIds) {
      const s = states.get(uid);
      if (!s) continue;
      const ctx = await this.context(workspaceId, uid);
      if (reduce(s, { type: 'tick' }, ctx, now).change) {
        const v = await this.tick(workspaceId, uid).catch(() => null);
        const fresh = v ? null : await this.store.read(workspaceId, uid);
        out.set(uid, v ?? viewOf(fresh ?? s));
      } else {
        out.set(uid, viewOf(s));
      }
    }
    return out;
  }

  async view(workspaceId: string, userId: string): Promise<PresenceView> {
    const v = (await this.views(workspaceId, [userId])).get(userId);
    if (v) return v;
    const seeded = await this.seed(workspaceId, userId, Date.now());
    return viewOf(seeded);
  }

  async myPresence(workspaceId: string, userId: string): Promise<MyPresence> {
    const [v, ctx, names] = await Promise.all([this.view(workspaceId, userId), this.context(workspaceId, userId), this.markers.zoneNames(workspaceId)]);
    return {
      ...toPresence(v, names),
      heartbeatIntervalSec: Math.round(HEARTBEAT_INTERVAL_MS / 1000),
      timeoutSec: Math.round(PRESENCE_TIMEOUT_MS / 1000),
      insideWorkingHours: isWithinWorkingHours(Date.now(), ctx.workingHours),
    };
  }

  async history(workspaceId: string, userId: string, from: Date, to: Date): Promise<PresenceEvent[]> {
    const rows = await this.prisma.forTenant(workspaceId).presenceEvent.findMany({
      where: { userId, at: { gte: from, lt: to } },
      orderBy: [{ at: 'asc' }, { id: 'asc' }],
      take: 2_000,
    });
    return rows.map((r) => ({ id: r.id, userId: r.userId, version: r.version, status: r.status, previousStatus: r.previousStatus, source: r.source, callId: r.callId, at: r.at.toISOString() }));
  }

  /** The engine context for a user (working hours, timezone, holidays, field staff). Cached 60 s. */
  async context(workspaceId: string, userId: string): Promise<PresenceContext> {
    const key = `${workspaceId}:${userId}`;
    const hit = this.contexts.get(key);
    const now = Date.now();
    if (hit && now - hit.at < CONTEXT_TTL_MS) return hit.ctx;
    const db = this.prisma.forTenant(workspaceId);
    const [ws, user] = await Promise.all([
      db.workspace.findFirst({ select: { timezone: true, businessHours: true, holidays: true } }),
      db.user.findFirst({ where: { id: userId }, select: { workingHours: true, isFieldStaff: true } }),
    ]);
    const holidays = Array.isArray(ws?.holidays) ? (ws.holidays as Array<{ date?: unknown }>).map((h) => h?.date).filter((d): d is string => typeof d === 'string') : [];
    const ctx: PresenceContext = {
      workingHours: { hours: ((user?.workingHours ?? ws?.businessHours) as BusinessHours | null) ?? ({} as BusinessHours), timezone: ws?.timezone ?? 'Asia/Kolkata', holidays },
      fieldStaff: user?.isFieldStaff ?? false,
    };
    if (this.contexts.size > 10_000) this.contexts.clear();
    this.contexts.set(key, { ctx, at: now });
    return ctx;
  }

  /** Forget cached contexts (after working hours or field staff changes in tests). */
  invalidateContext(workspaceId: string, userId?: string): void {
    for (const k of [...this.contexts.keys()]) if (k.startsWith(`${workspaceId}:${userId ?? ''}`)) this.contexts.delete(k);
  }

  // ---------------------------------------------------------------- core

  async ingest(workspaceId: string, userId: string, input: PresenceInput): Promise<PresenceView | null> {
    const ctx = await this.context(workspaceId, userId);
    return this.store.mutate<PresenceView | null>(workspaceId, userId, async (current) => {
      const now = Date.now();
      const base = current ?? (await this.seed(workspaceId, userId, now));
      const r = reduce(base, input, ctx, now);
      const deadline = nextDeadline(r.state, ctx, now);
      const { change, zoneChange } = r;
      if (!change && !zoneChange) {
        const persistSeen = this.shouldPersistSeen(workspaceId, userId, r.state, now);
        return {
          state: r.state,
          deadline,
          result: null,
          before: persistSeen ? () => this.persistSeen(workspaceId, userId, r.state) : undefined,
        };
      }
      return {
        state: r.state,
        deadline,
        result: change?.view ?? viewOf(r.state),
        before: () => this.persistChange(workspaceId, userId, change, r.state),
        after: () => this.publish(workspaceId, userId, change, zoneChange),
      };
    });
  }

  /**
   * State for a user Redis does not know. With a Presence row (Redis was flushed) the version restarts
   * above anything published before: Presence.version when the column exists, else the current time in
   * ms (a per-user counter can never reach it), so clients never drop the new events as stale.
   */
  private async seed(workspaceId: string, userId: string, now: number): Promise<PresenceState> {
    const row = await this.prisma.forTenant(workspaceId).presence.findFirst({ where: { userId } });
    const version = row?.version ?? 0;
    const state = initialState(userId, now, { version, lastSeenAt: row?.lastSeenAt?.getTime() ?? null });
    if (row) {
      // The database copy is what clients last saw; the engine re-derives from here (no devices = offline).
      state.status = row.status as PresenceStatus;
      state.since = row.since.getTime();
      state.source = row.source;
      state.shown = { manualStatus: (row.manualStatus as ManualStatus | null) ?? null, lastSeenAt: row.lastSeenAt?.getTime() ?? null, lastHeartbeatAt: row.lastHeartbeatAt?.getTime() ?? null };
      if (row.manualStatus && row.manualSetAt) {
        const ctx = await this.context(workspaceId, userId);
        state.manual = { status: row.manualStatus as ManualStatus, note: row.manualNote, setAt: row.manualSetAt.getTime(), until: manualUntil(row.manualSetAt.getTime(), ctx) };
      }
      state.activity = { kind: null, callId: row.callId, leadId: row.leadId, leadName: null, startedAt: row.callStartedAt?.getTime() ?? null, client: (row.client as ClientKind | null) ?? null, clientActivity: (row.clientActivity as DeviceActivity | null) ?? null, note: row.manualNote };
    }
    return state;
  }

  private shouldPersistSeen(workspaceId: string, userId: string, s: PresenceState, now: number): boolean {
    if (s.lastSeenAt === null) return false;
    const key = `${workspaceId}:${userId}`;
    const last = this.seenPersisted.get(key) ?? 0;
    if (now - last < SEEN_PERSIST_MS) return false;
    this.seenPersisted.set(key, now);
    return true;
  }

  private async persistSeen(workspaceId: string, userId: string, s: PresenceState): Promise<void> {
    const db = this.prisma.forTenant(workspaceId);
    const lastSeenAt = s.lastSeenAt ? new Date(s.lastSeenAt) : null;
    const lastHeartbeatAt = s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt) : null;
    // Invisible mode: do not move the stored last-seen time.
    if (s.status === 'offline') return;
    const zone = viewOf(s).zone;
    await Promise.all([
      db.presence.updateMany({ where: { userId }, data: { lastSeenAt, lastHeartbeatAt, ...(zone ? { zoneAt: new Date(zone.at), zoneConfidence: zone.confidence } : {}) } }),
      db.user.updateMany({ where: { id: userId }, data: { lastSeenAt } }),
    ]);
  }

  /**
   * Durable write of a change: the Presence row (status, version, activity, screen, zone), and for a
   * status change also ONE PresenceEvent row and the coarse User.status. `change` null = zone only.
   */
  private async persistChange(workspaceId: string, userId: string, change: StatusChange | null, s: PresenceState): Promise<void> {
    const v = viewOf(s);
    const db = this.prisma.forTenant(workspaceId);
    const since = new Date(v.since);
    const data = {
      status: v.status,
      source: v.source,
      since,
      version: v.version,
      manualStatus: v.manualStatus,
      manualNote: v.activity.note,
      manualSetAt: s.manual ? new Date(s.manual.setAt) : null,
      lastHeartbeatAt: v.lastHeartbeatAt ? new Date(v.lastHeartbeatAt) : null,
      lastSeenAt: v.lastSeenAt ? new Date(v.lastSeenAt) : null,
      client: v.activity.client,
      clientActivity: v.activity.clientActivity,
      callId: v.activity.callId,
      callStartedAt: v.activity.kind === 'call' && v.activity.startedAt ? new Date(v.activity.startedAt) : null,
      leadId: v.activity.leadId,
      screen: v.activity.screen ?? null,
      zoneId: v.zone?.zoneId ?? null,
      zoneSource: v.zone?.source ?? null,
      zoneConfidence: v.zone?.confidence ?? null,
      zoneSince: v.zone ? new Date(v.zone.since) : null,
      zoneAt: v.zone ? new Date(v.zone.at) : null,
    };
    await db.$transaction(async (tx) => {
      if (change?.historic) {
        // One row per (user, version): a deterministic id plus the unique (user, version) make a retried write a no-op.
        await tx.presenceEvent.createMany({
          data: [
            {
              id: stableUuid('presence-event', workspaceId, userId, v.version),
              workspaceId,
              userId,
              status: v.status,
              previousStatus: change.previousStatus,
              version: v.version,
              source: v.source,
              callId: v.activity.callId,
              meta: { activity: v.activity.kind, leadId: v.activity.leadId, note: v.activity.note },
              at: since,
            },
          ],
          skipDuplicates: true,
        });
      }
      await tx.presence.upsert({ where: { userId }, create: { workspaceId, userId, ...data }, update: data });
      if (change) {
        await tx.user.updateMany({
          where: { id: userId },
          data: { status: presenceToEmployeeStatus(v.status), statusChangedAt: since, ...(v.status === 'offline' ? {} : { lastSeenAt: data.lastSeenAt }) },
        });
      }
    });
    this.seenPersisted.set(`${workspaceId}:${userId}`, Date.now());
  }

  /** Status first, then the zone (both inside the user's lock, so in order). */
  private async publish(workspaceId: string, userId: string, change: StatusChange | null, zone: ZoneChange | null): Promise<void> {
    if (change) {
      try {
        await this.events.publish('employee.status_changed', workspaceId, statusChangedPayload(change), { actor: SYSTEM });
      } catch (err) {
        this.logger.error(`employee.status_changed publish failed (v${change.view.version}): ${(err as Error).message}`);
      }
    }
    if (zone) {
      try {
        await this.events.publish('employee.zone_changed', workspaceId, zoneChangedPayload(userId, zone), { actor: SYSTEM });
      } catch (err) {
        this.logger.error(`employee.zone_changed publish failed: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------------- sweeper

  @Interval(SWEEP_MS)
  async onInterval(): Promise<void> {
    if (!this.autoSweep) return;
    await this.sweep();
  }

  /** One sweep: re-evaluate every user whose deadline passed. Returns how many were processed. */
  async sweep(force = false): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      if (!force && !(await this.store.acquireSweeper(SWEEP_MS))) return 0;
      const due = await this.store.due(Date.now());
      for (const m of due) {
        await this.tick(m.workspaceId, m.userId).catch((err: Error) => this.logger.warn(`presence sweep failed for a user: ${err.message}`));
      }
      return due.length;
    } finally {
      this.sweeping = false;
    }
  }

  private async reconcile(): Promise<void> {
    const rows = await this.prisma.presence.findMany({ where: { status: { not: 'offline' } }, select: { workspaceId: true, userId: true }, take: 5_000 });
    for (const r of rows) {
      if (!(await this.store.read(r.workspaceId, r.userId))) await this.tick(r.workspaceId, r.userId).catch(() => undefined);
    }
  }
}


/** Presence.location of a zone (confidence decayed to `now`). */
export function toLocation(z: ZoneCurrent | null, zoneName: (zoneId: string) => string | null, now: number): Presence['location'] {
  if (!z) return null;
  return { zoneId: z.zoneId, zoneName: zoneName(z.zoneId), source: z.source, confidence: decayedConfidence(z, now), since: new Date(z.since).toISOString(), at: new Date(z.at).toISOString() };
}

/** Presence (contract shape) of a view. `zoneName` resolves seat-map zone names (MyPresence, snapshot). */
export function toPresence(v: PresenceView, zoneName: (zoneId: string) => string | null = () => null, now = Date.now()): Presence {
  return {
    userId: v.userId,
    status: v.status,
    version: v.version,
    employeeStatus: presenceToEmployeeStatus(v.status),
    source: v.source,
    since: new Date(v.since).toISOString(),
    manualStatus: v.manualStatus,
    lastHeartbeatAt: v.lastHeartbeatAt === null ? null : new Date(v.lastHeartbeatAt).toISOString(),
    lastSeenAt: v.lastSeenAt === null ? null : new Date(v.lastSeenAt).toISOString(),
    activity: {
      callId: v.activity.callId,
      callStartedAt: v.activity.kind === 'call' && v.activity.startedAt !== null ? new Date(v.activity.startedAt).toISOString() : null,
      leadId: v.activity.leadId,
      leadName: v.activity.leadName,
      client: v.activity.client,
      clientActivity: v.activity.clientActivity,
      note: v.activity.note,
      screen: (v.activity.screen as AppScreen | null | undefined) ?? null,
    },
    location: toLocation(v.zone, zoneName, now),
  };
}

/** `employee.status_changed` payload: coarse fields for older consumers plus the detailed presence. */
export function statusChangedPayload(change: StatusChange): EventPayload<'employee.status_changed'> {
  const v = change.view;
  const p = toPresence(v);
  return {
    userId: v.userId,
    status: presenceToEmployeeStatus(v.status),
    previousStatus: presenceToEmployeeStatus(change.previousStatus),
    currentLeadId: v.activity.leadId,
    callId: v.activity.callId,
    at: p.since,
    presence: v.status,
    previousPresence: change.previousStatus,
    source: v.source,
    lastSeenAt: p.lastSeenAt,
    activity: p.activity,
    version: v.version,
    since: p.since,
  };
}

/** `employee.zone_changed` payload. */
export function zoneChangedPayload(userId: string, z: ZoneChange): EventPayload<'employee.zone_changed'> {
  return { userId, zoneId: z.zoneId, previousZoneId: z.previousZoneId, source: z.source, confidence: Math.min(1, Math.max(0, z.confidence)), at: new Date(z.at).toISOString() };
}