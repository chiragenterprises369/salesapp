import { Injectable, Logger } from '@nestjs/common';
import type { TelephonyProvider } from '@vistar/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { CALL_INCLUDE, toCall } from '../calls/call.mapper.js';
import { normalizePhone } from '../leads/import/mapping.js';
import { publishSafe } from '../leads/lib/context.js';
import { IntegrationStore } from './integration-store.js';
import { TELEPHONY_ADAPTERS } from './providers/adapters.js';

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Telephony provider callbacks (POST /api/hooks/{workspaceId}/telephony/{provider}?token=): the adapter parses the
 * provider's status callback, the call is created or updated by (provider, providerCallId), matched to a lead by
 * phone, and call.updated / call.ended are published. Click-to-call through the adapter is a follow-up.
 */
@Injectable()
export class TelephonyService {
  private readonly logger = new Logger(TelephonyService.name);

  constructor(
    private readonly store: IntegrationStore,
    private readonly events: EventBus,
  ) {}

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

    const counterpart = event.direction === 'inbound' ? event.from : event.to;
    const phone = normalizePhone(counterpart) ?? null;
    const lead = phone ? await db.lead.findFirst({ where: { phone, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, ownerId: true } }) : null;
    const final = event.status === 'completed' || event.status === 'missed' || event.status === 'failed';
    const data = {
      status: event.status,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      durationSec: event.durationSec,
      answeredAt: event.status === 'completed' && event.durationSec > 0 ? event.startedAt : null,
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
    await publishSafe(this.events, this.logger, final ? 'call.ended' : 'call.updated', workspaceId, { call: toCall(saved) }, { actor: { type: 'integration', id: row.id, name: row.displayName } });
    return { ok: true, callId: saved.id };
  }
}
