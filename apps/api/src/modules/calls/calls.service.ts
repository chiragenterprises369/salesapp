import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  ActiveCallEvent,
  Call,
  CallListQuery,
  CallResult,
  CallUpdate,
  DeviceCallLogBatch,
  DeviceCallLogEntry,
  DeviceCallLogResult,
  EventActor,
  Page,
} from '@vistar/shared';
import type { Redis } from 'ioredis';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { CallStatus, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { applyPatch, loadFieldDefs, publicValues, roleKeyOf, validateValues } from '../customization/custom-values.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { decodeCursor, encodeCursor, isTimeCursor } from '../leads/lib/cursor.js';
import { zonedMonthKey } from '../leads/lib/tz.js';
import { PresenceService } from '../presence/presence.service.js';
import { stableUuid } from '../realtime/ids.js';
import { CALL_INCLUDE, toCall, type CallRow } from './call.mapper.js';
import { toE164 } from './phone.js';

/** A device log row completes a live call that started within this window of it. */
const LIVE_MATCH_WINDOW_MS = 90_000;
const ENDED_MARK_TTL_SEC = 24 * 3600;

const STATUS_OF_RESULT: Record<CallResult, CallStatus> = {
  connected: 'completed',
  missed: 'missed',
  no_answer: 'missed',
  busy: 'missed',
  rejected: 'missed',
  failed: 'failed',
};

export const liveCallId = (workspaceId: string, userId: string, clientCallId: string) => stableUuid('call-live', workspaceId, userId, clientCallId);
export const logCallId = (workspaceId: string, userId: string, deviceCallId: string) => stableUuid('call-log', workspaceId, userId, deviceCallId);
export const callActivityId = (callId: string) => stableUuid('call-activity', callId);

interface LeadMatch {
  id: string;
  name: string;
}

/**
 * Calls (D-057, SPEC 15.1): live SIM calls from the Android phone state, the device call log, the call
 * list. Idempotency comes from deterministic ids (a live call id derives from (user, clientCallId), a
 * log-only call from (user, deviceCallId), the timeline entry from the call id) plus
 * `createMany({ skipDuplicates })`, so retries, duplicate batches and concurrent uploads write one row.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);
  private readonly memMarks = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly presence: PresenceService,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  // ---------------------------------------------------------------- live phone state

  async active(auth: AuthContext, body: ActiveCallEvent): Promise<Call> {
    const userId = requireUser(auth);
    const db = this.prisma.forTenant(auth.workspaceId);
    const id = liveCallId(auth.workspaceId, userId, body.clientCallId);
    const actor = (await requestActor(db, auth)).event;
    if (body.event === 'ended') return this.liveEnded(auth, db, id, new Date(body.endedAt), actor);

    const startedAt = new Date(body.startedAt);
    const phone = toE164(body.phone);
    const lead = await this.resolveLead(db, auth, body.leadId ?? null, phone);
    const endedMark = await this.endedMark(id);
    const ended = endedMark !== null ? new Date(Math.max(endedMark, startedAt.getTime())) : null;
    const { count } = await db.call.createMany({
      data: [
        {
          id,
          workspaceId: auth.workspaceId,
          userId,
          leadId: lead?.id ?? null,
          direction: body.direction,
          status: ended ? 'completed' : 'in_progress',
          fromNumber: body.direction === 'outbound' ? '' : (phone ?? ''),
          toNumber: body.direction === 'outbound' ? (phone ?? '') : '',
          phone,
          startedAt,
          endedAt: ended,
          durationSec: ended ? Math.round((ended.getTime() - startedAt.getTime()) / 1000) : 0,
          provider: 'sim',
          source: 'sim',
          clientCallId: body.clientCallId,
          deviceId: body.deviceId ?? null,
        },
      ],
      skipDuplicates: true,
    });
    const row = await this.row(db, id);
    if (count === 0) return toCall(row); // retry of a start we already have
    await this.countUsage(db, auth.workspaceId, startedAt);
    if (ended) {
      // "ended" arrived first: the call is over, nothing goes live.
      await publishSafe(this.events, this.logger, 'call.ended', auth.workspaceId, { call: await this.broadcast(db, row) }, { actor });
      return toCall(row);
    }
    await publishSafe(this.events, this.logger, 'call.started', auth.workspaceId, { call: await this.broadcast(db, row) }, { actor });
    await this.presence
      .callStarted(auth.workspaceId, userId, { callId: id, deviceId: body.deviceId ?? null, leadId: lead?.id ?? null, leadName: lead?.name ?? null, startedAt: startedAt.getTime(), signal: 'phone_state' })
      .catch((err: Error) => this.logger.warn(`presence callStarted failed: ${err.message}`));
    return toCall(row);
  }

  private async liveEnded(auth: AuthContext, db: TenantDb, id: string, endedAt: Date, actor: EventActor): Promise<Call> {
    const userId = auth.userId as string;
    await this.presence.callEnded(auth.workspaceId, userId, { callId: id, endedAt: endedAt.getTime(), signal: 'phone_state' }).catch((err: Error) => this.logger.warn(`presence callEnded failed: ${err.message}`));
    const existing = await db.call.findFirst({ where: { id, userId }, include: CALL_INCLUDE });
    if (!existing) {
      await this.markEnded(id, endedAt.getTime());
      throw new AppException('NOT_FOUND', 'Call not found. Send "started" first; this end is remembered for a day');
    }
    if (existing.status !== 'in_progress' && existing.status !== 'ringing') return toCall(existing);
    const end = new Date(Math.max(endedAt.getTime(), existing.startedAt.getTime()));
    const { count } = await db.call.updateMany({
      where: { id, status: { in: ['in_progress', 'ringing'] } },
      data: { status: 'completed', endedAt: end, durationSec: existing.result ? existing.durationSec : Math.round((end.getTime() - existing.startedAt.getTime()) / 1000) },
    });
    const row = await this.row(db, id);
    if (count === 1) await publishSafe(this.events, this.logger, 'call.ended', auth.workspaceId, { call: await this.broadcast(db, row) }, { actor });
    return toCall(row);
  }

  // ---------------------------------------------------------------- device call log

  async deviceLog(auth: AuthContext, batch: DeviceCallLogBatch): Promise<DeviceCallLogResult> {
    const userId = requireUser(auth);
    const db = this.prisma.forTenant(auth.workspaceId);
    const actor = await requestActor(db, auth);
    const out: DeviceCallLogResult = { items: [], created: 0, updated: 0, unchanged: 0 };
    // Oldest first, so a live call is closed by its own log row before a later one arrives.
    const entries = [...batch.entries].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.deviceCallId)) continue;
      seen.add(entry.deviceCallId);
      const r = await this.ingestLogEntry(auth, db, userId, entry, batch.deviceId ?? null, actor.event, actor.activityActorType);
      out.items.push(r);
      out[r.status] += 1;
    }
    return out;
  }

  private async ingestLogEntry(
    auth: AuthContext,
    db: TenantDb,
    userId: string,
    entry: DeviceCallLogEntry,
    deviceId: string | null,
    actor: EventActor,
    activityActorType: string,
  ): Promise<DeviceCallLogResult['items'][number]> {
    const phone = toE164(entry.phone);
    const startedAt = new Date(entry.startedAt);
    const endedAt = entry.endedAt ? new Date(entry.endedAt) : new Date(startedAt.getTime() + entry.durationSec * 1000);
    const final = {
      direction: entry.direction,
      status: STATUS_OF_RESULT[entry.result],
      result: entry.result,
      durationSec: entry.durationSec,
      answeredAt: entry.answeredAt ? new Date(entry.answeredAt) : null,
      endedAt,
      phone,
      deviceCallId: entry.deviceCallId,
    };

    const existing =
      (await db.call.findFirst({ where: { userId, deviceCallId: entry.deviceCallId }, include: CALL_INCLUDE })) ??
      (entry.clientCallId ? await db.call.findFirst({ where: { id: liveCallId(auth.workspaceId, userId, entry.clientCallId), userId }, include: CALL_INCLUDE }) : null) ??
      (await this.findLiveMatch(db, userId, startedAt, phone));

    let row: CallRow;
    let status: 'created' | 'updated' | 'unchanged';
    let becameFinal = false;
    let wasLive = false;
    if (existing) {
      wasLive = existing.status === 'in_progress' || existing.status === 'ringing';
      becameFinal = existing.result === null;
      const lead = existing.leadId ? null : await this.resolveLead(db, auth, entry.leadId ?? null, phone);
      const data: Prisma.CallUncheckedUpdateInput = {
        ...final,
        ...(lead ? { leadId: lead.id } : {}),
        ...(existing.deviceId ? {} : { deviceId }),
        ...(entry.direction === 'outbound' ? { toNumber: phone ?? existing.toNumber } : { fromNumber: phone ?? existing.fromNumber }),
      };
      const changed =
        becameFinal ||
        lead !== null ||
        existing.durationSec !== final.durationSec ||
        existing.result !== final.result ||
        existing.status !== final.status ||
        existing.deviceCallId !== final.deviceCallId ||
        (existing.endedAt?.getTime() ?? null) !== endedAt.getTime() ||
        (existing.answeredAt?.getTime() ?? null) !== (final.answeredAt?.getTime() ?? null);
      if (!changed) return { deviceCallId: entry.deviceCallId, callId: existing.id, status: 'unchanged', leadId: existing.leadId };
      await db.call.update({ where: { id: existing.id }, data });
      row = await this.row(db, existing.id);
      status = 'updated';
    } else {
      const id = logCallId(auth.workspaceId, userId, entry.deviceCallId);
      const lead = await this.resolveLead(db, auth, entry.leadId ?? null, phone);
      const { count } = await db.call.createMany({
        data: [
          {
            id,
            workspaceId: auth.workspaceId,
            userId,
            leadId: lead?.id ?? null,
            ...final,
            fromNumber: entry.direction === 'outbound' ? '' : (phone ?? ''),
            toNumber: entry.direction === 'outbound' ? (phone ?? '') : '',
            startedAt,
            provider: 'sim',
            source: 'sim',
            deviceId,
          },
        ],
        skipDuplicates: true,
      });
      row = await this.row(db, id);
      if (count === 0) return { deviceCallId: entry.deviceCallId, callId: id, status: 'unchanged', leadId: row.leadId };
      await this.countUsage(db, auth.workspaceId, startedAt);
      status = 'created';
      becameFinal = true;
    }

    await this.writeTimeline(db, auth.workspaceId, row, actor, activityActorType, userId);
    const call = await this.broadcast(db, row);
    // A call nobody saw end (log-only, or live without "ended") ends now; otherwise it gains its result.
    const type = status === 'created' || (becameFinal && wasLive) ? 'call.ended' : 'call.updated';
    await publishSafe(this.events, this.logger, type, auth.workspaceId, { call }, { actor });
    await this.presence
      .callLog(auth.workspaceId, userId, { callId: row.id, deviceId: row.deviceId, startedAt: startedAt.getTime(), endedAt: endedAt.getTime() })
      .catch((err: Error) => this.logger.warn(`presence callLog failed: ${err.message}`));
    return { deviceCallId: entry.deviceCallId, callId: row.id, status, leadId: row.leadId };
  }

  /** A live SIM call of this user (no result yet) that started close to the log row, same number when known. */
  private async findLiveMatch(db: TenantDb, userId: string, startedAt: Date, phone: string | null): Promise<CallRow | null> {
    const candidates = await db.call.findMany({
      where: {
        userId,
        source: 'sim',
        result: null,
        deviceCallId: null,
        startedAt: { gte: new Date(startedAt.getTime() - LIVE_MATCH_WINDOW_MS), lte: new Date(startedAt.getTime() + LIVE_MATCH_WINDOW_MS) },
      },
      include: CALL_INCLUDE,
      take: 10,
    });
    const fit = candidates.filter((c) => !phone || !c.phone || c.phone === phone);
    fit.sort((a, b) => Math.abs(a.startedAt.getTime() - startedAt.getTime()) - Math.abs(b.startedAt.getTime() - startedAt.getTime()));
    return fit[0] ?? null;
  }

  /** One timeline entry per call on its lead (deterministic id); later corrections update it. */
  private async writeTimeline(db: TenantDb, workspaceId: string, row: CallRow, actor: EventActor, activityActorType: string, userId: string): Promise<void> {
    if (!row.leadId) return;
    const id = callActivityId(row.id);
    const payload = { callId: row.id, status: row.status, outcome: row.outcome, durationSec: row.durationSec, hasRecording: Boolean(row.recordingKey || row.recordingFileId) };
    const createdAt = row.endedAt ?? row.startedAt;
    const { count } = await db.activity.createMany({
      data: [{ id, workspaceId, leadId: row.leadId, type: 'call', actorType: activityActorType as 'user', actorId: userId, payload, createdAt }],
      skipDuplicates: true,
    });
    if (count === 0) {
      await db.activity.updateMany({ where: { id }, data: { payload } });
      return;
    }
    await db.lead.updateMany({ where: { id: row.leadId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: createdAt } }] }, data: { lastActivityAt: createdAt } });
    const user = row.user;
    await publishSafe(
      this.events,
      this.logger,
      'activity.created',
      workspaceId,
      {
        activity: {
          id,
          leadId: row.leadId,
          type: 'call',
          actor: user ? { id: user.id, name: user.name, role: user.role.kind, status: user.status, avatar: (user.avatar as never) ?? null } : null,
          createdAt: createdAt.toISOString(),
          payload,
        },
      },
      { actor },
    );
  }

  // ---------------------------------------------------------------- reads and edits

  async list(auth: AuthContext, q: CallListQuery): Promise<Page<Call>> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const where: Prisma.CallWhereInput = {
      ...(await this.scope.where(auth, 'userId')),
      ...(q.leadId ? { leadId: q.leadId } : {}),
      ...(q.status?.length ? { status: { in: q.status } } : {}),
      ...(q.outcome?.length ? { outcome: { in: q.outcome } } : {}),
      ...(q.source?.length ? { source: { in: q.source } } : {}),
      ...(q.result?.length ? { result: { in: q.result } } : {}),
    };
    // userId narrows the scope; it never widens it.
    if (q.userId) where.AND = [{ userId: q.userId }];
    if (q.from || q.to) where.startedAt = { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lt: new Date(q.to) } : {}) };
    if (q.cursor) {
      const c = decodeCursor(q.cursor, isTimeCursor);
      const t = new Date(c.t);
      where.OR = [{ startedAt: { lt: t } }, { startedAt: t, id: { lt: c.id } }];
    }
    const rows = await db.call.findMany({ where, include: CALL_INCLUDE, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const [defs, roleKey] = await Promise.all([loadFieldDefs(db, 'call'), roleKeyOf(db, auth)]);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toCall(r, defs, roleKey)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.startedAt.toISOString(), id: last.id }) : null,
    };
  }

  async get(auth: AuthContext, id: string): Promise<Call> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.visibleRow(db, auth, id);
    const [defs, roleKey] = await Promise.all([loadFieldDefs(db, 'call'), roleKeyOf(db, auth)]);
    return toCall(row, defs, roleKey);
  }

  async update(auth: AuthContext, id: string, body: CallUpdate): Promise<Call> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.visibleRow(db, auth, id);
    const defs = await loadFieldDefs(db, 'call');
    const data: Prisma.CallUncheckedUpdateInput = {};
    if (body.outcome !== undefined) data.outcome = body.outcome;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.disposition !== undefined) data.disposition = body.disposition;
    if (body.customFields !== undefined) {
      const patch = await validateValues(db, auth, defs, body.customFields, { mode: 'update', pathPrefix: 'customFields' });
      data.customFields = applyPatch((row.customFields ?? {}) as Record<string, never>, patch) as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length) await db.call.update({ where: { id }, data });
    const next = await this.row(db, id);
    if (Object.keys(data).length) {
      const actor = await requestActor(db, auth);
      if (next.leadId && body.outcome !== undefined) {
        await db.activity.updateMany({ where: { id: callActivityId(id) }, data: { payload: { callId: id, status: next.status, outcome: next.outcome, durationSec: next.durationSec, hasRecording: Boolean(next.recordingKey || next.recordingFileId) } } });
      }
      await publishSafe(this.events, this.logger, 'call.updated', auth.workspaceId, { call: toCall(next, defs) }, { actor: actor.event });
    }
    return toCall(next, defs, await roleKeyOf(db, auth));
  }

  // ---------------------------------------------------------------- helpers

  private async visibleRow(db: TenantDb, auth: AuthContext, id: string): Promise<CallRow> {
    const row = await db.call.findFirst({ where: { id }, include: CALL_INCLUDE });
    if (!row || !(await this.scope.canSee(auth, row.userId))) throw notFound('Call');
    return row;
  }

  private row(db: TenantDb, id: string): Promise<CallRow> {
    return db.call.findFirstOrThrow({ where: { id }, include: CALL_INCLUDE });
  }

  /** Broadcast-safe Call (custom fields hidden for any role removed). */
  private async broadcast(db: TenantDb, row: CallRow): Promise<Call> {
    const defs = await loadFieldDefs(db, 'call');
    return { ...toCall(row, defs), customFields: publicValues(defs, row.customFields as Record<string, never>) };
  }

  /**
   * The lead of a call: the lead the app started it from when the caller may see it, else the
   * newest lead with that E.164 number inside the caller's data scope.
   */
  private async resolveLead(db: TenantDb, auth: AuthContext, leadId: string | null, phone: string | null): Promise<LeadMatch | null> {
    if (leadId) {
      const lead = await db.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, name: true, ownerId: true } });
      if (lead && (await this.scope.canSee(auth, lead.ownerId))) return { id: lead.id, name: lead.name };
    }
    if (!phone) return null;
    const lead = await db.lead.findFirst({
      where: { phone, deletedAt: null, ...(await this.scope.where(auth, 'ownerId')) },
      orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    });
    return lead;
  }

  /** Monthly usage counter (UsageCounter metric "calls"), once per new call row. */
  private async countUsage(db: TenantDb, workspaceId: string, at: Date): Promise<void> {
    const ws = await db.workspace.findFirst({ select: { timezone: true } });
    const period = zonedMonthKey(at, ws?.timezone ?? 'Asia/Kolkata');
    await db.usageCounter
      .upsert({ where: { workspaceId_period_metric: { workspaceId, period, metric: 'calls' } }, create: { workspaceId, period, metric: 'calls', value: 1 }, update: { value: { increment: 1 } } })
      .catch((err: Error) => this.logger.warn(`usage counter failed: ${err.name}`));
  }

  private async markEnded(callId: string, at: number): Promise<void> {
    const r = this.redis && this.redis.status === 'ready' ? this.redis : null;
    if (r) await r.set(`vistar:calls:ended:${callId}`, String(at), 'EX', ENDED_MARK_TTL_SEC).catch(() => undefined);
    else this.memMarks.set(callId, at);
  }

  private async endedMark(callId: string): Promise<number | null> {
    const r = this.redis && this.redis.status === 'ready' ? this.redis : null;
    const raw = r ? await r.get(`vistar:calls:ended:${callId}`).catch(() => null) : (this.memMarks.get(callId)?.toString() ?? null);
    return raw ? Number(raw) : null;
  }
}

export function requireUser(auth: AuthContext): string {
  if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
  return auth.userId;
}
