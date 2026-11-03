import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { telephonyWebhookPath, type TelephonyProvider } from '@vistar/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { CALL_INCLUDE, toCall } from '../calls/call.mapper.js';
import { normalizePhone } from '../leads/import/mapping.js';
import { publishSafe } from '../leads/lib/context.js';
import { PresenceService } from '../presence/presence.service.js';
import { IntegrationStore, type IntegrationRow } from './integration-store.js';
import { TELEPHONY_ADAPTERS, TelephonyConnectError, type TelephonyCallEvent, type TelephonyConnectResult } from './providers/adapters.js';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const FINAL = new Set(['completed', 'missed', 'failed']);

export interface DialResult extends TelephonyConnectResult {
  provider: TelephonyProvider;
  integrationId: string;
}

/**
 * Telephony (D-039, D-069, change #20):
 *  - callbacks (POST /api/hooks/{workspaceId}/telephony/{provider}?token=): the adapter parses the provider's status
 *    callback, the call is created or updated by (provider, providerCallId), matched to a lead by phone, presence
 *    follows the call (on_call while in progress) and call.updated / call.ended are published;
 *  - click-to-call (`dial`, used by CallsService for POST /calls): Exotel Connect rings the agent's mobile first and
 *    then the customer, with the status callback above; the mock (development only) simulates ringing, answer and
 *    hang-up through the same event path. The Android SIM path is separate (CallsService.active / deviceLog).
 */
@Injectable()
export class TelephonyService implements OnModuleDestroy {
  private readonly logger = new Logger(TelephonyService.name);
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly store: IntegrationStore,
    private readonly events: EventBus,
    private readonly presence: PresenceService,
  ) {}

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  // ---------------------------------------------------------------- click-to-call

  /** The connected telephony integration usable for click-to-call, with its provider. Throws a readable error. */
  async connection(workspaceId: string): Promise<{ row: IntegrationRow; provider: TelephonyProvider }> {
    const features = await this.store.features(workspaceId);
    if (!features.telephony) throw new AppException('FEATURE_DISABLED', 'Calling through the telephony provider is not part of your plan');
    const row = await this.store.row(workspaceId, 'telephony');
    if (!row || row.status === 'not_connected') throw new AppException('INTEGRATION_NOT_CONNECTED', 'Connect a telephony provider in Integrations first');
    if (row.mode === 'mock') {
      if (getEnv().NODE_ENV === 'production') throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Mock telephony is not available in production: connect Exotel');
      return { row, provider: 'mock' };
    }
    return { row, provider: ((row.config as { provider?: TelephonyProvider }).provider ?? 'exotel') as TelephonyProvider };
  }

  /** Ring the agent, then the customer. `callId` is the Vistar call id the row will get. */
  async dial(workspaceId: string, req: { agent: string | null; customer: string; callId: string }): Promise<DialResult> {
    const { row, provider } = await this.connection(workspaceId);
    if (provider !== 'mock' && !req.agent) {
      throw new AppException('VALIDATION_FAILED', 'Add your mobile number to your profile: the call rings it first', { details: [{ path: 'agentPhone', message: 'Your profile has no mobile number' }] });
    }
    const tokens = this.store.tokensOf(row);
    let callbackToken = tokens.callbackToken;
    if (!callbackToken) {
      const encrypted = this.store.ensureTokens('telephony', tokens);
      await this.store.db(workspaceId).integration.update({ where: { id: row.id }, data: { inboundTokensEncrypted: encrypted } });
      callbackToken = this.store.tokensOf({ inboundTokensEncrypted: encrypted }).callbackToken;
    }
    const api = getEnv().API_PUBLIC_URL.replace(/\/$/, '');
    const statusCallbackUrl = `${api}${telephonyWebhookPath(workspaceId, provider)}?token=${encodeURIComponent(callbackToken ?? '')}`;
    try {
      const out = await TELEPHONY_ADAPTERS[provider].connect((row.config ?? {}) as Record<string, unknown>, this.store.secretsOf(row), {
        agent: req.agent ?? '',
        customer: req.customer,
        statusCallbackUrl,
        callId: req.callId,
      });
      return { ...out, provider, integrationId: row.id };
    } catch (err) {
      if (err instanceof TelephonyConnectError) {
        throw new AppException(err.kind === 'config' ? 'INTEGRATION_NOT_CONFIGURED' : 'INTEGRATION_PROVIDER_ERROR', err.message);
      }
      throw err;
    }
  }

  /** Development only: ringing -> in progress after 3 s -> completed after 20 to 50 s more (same path as callbacks). */
  simulateMockCall(workspaceId: string, call: { providerCallId: string; from: string; to: string }): void {
    if (getEnv().NODE_ENV === 'production') return;
    const answeredAfter = 3_000;
    const talk = 20_000 + Math.floor(Math.random() * 30_000);
    const startedAt = new Date();
    const schedule = (ms: number, fn: () => Promise<void>) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void fn().catch((err: Error) => this.logger.warn(`Mock call event failed: ${err.name}`));
      }, ms);
      t.unref();
      this.timers.add(t);
    };
    const base = { providerCallId: call.providerCallId, direction: 'outbound' as const, from: call.from, to: call.to, startedAt, recordingUrl: null };
    schedule(answeredAfter, async () => {
      const row = await this.store.row(workspaceId, 'telephony');
      if (row) await this.applyEvent(workspaceId, row, 'mock', { ...base, status: 'in_progress', endedAt: null, durationSec: 0 });
    });
    schedule(answeredAfter + talk, async () => {
      const row = await this.store.row(workspaceId, 'telephony');
      if (row) await this.applyEvent(workspaceId, row, 'mock', { ...base, status: 'completed', endedAt: new Date(startedAt.getTime() + answeredAfter + talk), durationSec: Math.round(talk / 1000) });
    });
  }

  // ---------------------------------------------------------------- callbacks

  async callback(workspaceId: string, provider: TelephonyProvider, token: string | undefined, body: unknown): Promise<{ ok: true; callId: string | null }> {
    const db = this.store.db(workspaceId);
    const row = await db.integration.findFirst({ where: { provider: 'telephony' } });
    if (!row || row.status === 'not_connected') throw notFound('Source');
    const expected = this.store.tokensOf(row).callbackToken;
    if (!token || !expected || !safeEqual(token, expected)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid callback token');
    const active: TelephonyProvider = row.mode === 'mock' ? 'mock' : ((row.config as { provider?: TelephonyProvider }).provider ?? 'exotel');
    if (active !== provider) throw notFound('Source');
    const event = TELEPHONY_ADAPTERS[provider].parseCallback(body);
    if (!event) throw new AppException('VALIDATION_FAILED', 'Callback body not recognised');
    const callId = await this.applyEvent(workspaceId, row, provider, event);
    return { ok: true, callId };
  }

  /** Create or update the call of a provider event; presence and events follow. Returns the call id. */
  async applyEvent(workspaceId: string, row: IntegrationRow, provider: TelephonyProvider, event: TelephonyCallEvent): Promise<string> {
    const db = this.store.db(workspaceId);
    const existing = await db.call.findFirst({ where: { provider, providerCallId: event.providerCallId }, select: { id: true, status: true, userId: true, startedAt: true, answeredAt: true } });
    const counterpart = event.direction === 'inbound' ? event.from : event.to;
    const phone = normalizePhone(counterpart) ?? null;
    const lead = !existing && phone ? await db.lead.findFirst({ where: { phone, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, ownerId: true } }) : null;
    const final = FINAL.has(event.status);
    // Never move a finished call back (late "answered" after "terminal").
    if (existing && FINAL.has(existing.status) && !final) return existing.id;
    const startedAt = existing?.startedAt ?? event.startedAt;
    const data = {
      status: event.status,
      startedAt,
      endedAt: event.endedAt,
      durationSec: event.durationSec,
      answeredAt: event.status === 'in_progress' ? (existing?.answeredAt ?? new Date()) : event.status === 'completed' && event.durationSec > 0 ? (existing?.answeredAt ?? event.startedAt) : (existing?.answeredAt ?? null),
      result: event.status === 'completed' ? ('connected' as const) : event.status === 'missed' ? ('missed' as const) : event.status === 'failed' ? ('failed' as const) : null,
    };
    const saved = await db.call.upsert({
      where: { workspaceId_provider_providerCallId: { workspaceId, provider, providerCallId: event.providerCallId } },
      create: {
        workspaceId,
        provider,
        providerCallId: event.providerCallId,
        direction: event.direction,
        fromNumber: event.from || 'unknown',
        toNumber: event.to || 'unknown',
        phone,
        leadId: lead?.id ?? null,
        userId: lead?.ownerId ?? null,
        source: provider === 'mock' ? 'mock' : 'voip',
        ...data,
      },
      update: data,
      include: CALL_INCLUDE,
    });
    const actor = { type: 'integration' as const, id: row.id, name: row.displayName };
    await publishSafe(this.events, this.logger, final ? 'call.ended' : 'call.updated', workspaceId, { call: toCall(saved) }, { actor });
    // Presence: on_call while the provider says the call is live (agent's phone rang and was answered).
    if (saved.userId) {
      if (event.status === 'in_progress' && existing?.status !== 'in_progress') {
        await this.presence
          .callStarted(workspaceId, saved.userId, { callId: saved.id, leadId: saved.leadId, leadName: saved.lead?.name ?? null, startedAt: Date.now(), signal: 'telephony' })
          .catch((err: Error) => this.logger.warn(`presence callStarted failed: ${err.message}`));
      } else if (final && existing && !FINAL.has(existing.status)) {
        await this.presence.callEnded(workspaceId, saved.userId, { callId: saved.id, endedAt: (event.endedAt ?? new Date()).getTime(), signal: 'telephony' }).catch((err: Error) => this.logger.warn(`presence callEnded failed: ${err.message}`));
      }
    }
    return saved.id;
  }
}
