import { Injectable, Logger } from '@nestjs/common';
import { type Message, type MessageStatus } from '@vistar/shared';
import { timingSafeEqual } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { toConversation } from '../conversations/conversations.service.js';
import { isUniqueViolation } from '../crm/lib/db.js';
import { IntegrationStore, type IntegrationRow } from '../integrations/integration-store.js';
import { integrationActor, LeadIntakeService } from '../integrations/lead-intake.service.js';
import { verifyHubSignature } from '../integrations/providers/adapters.js';
import { publishSafe } from '../leads/lib/context.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const CONVERSATION_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, whatsappOptIn: true } },
  assignee: { select: USER_SUMMARY_SELECT },
} as const;
const PREVIEW_MAX = 140;
const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
export const WHATSAPP_VERIFY_HINT = 'Paste the callback URL and verify token into Meta (WhatsApp > Configuration) and click Verify and save';

interface WaMessage {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string; mime_type?: string };
  document?: { caption?: string; filename?: string; mime_type?: string };
  video?: { caption?: string };
  audio?: { mime_type?: string };
  sticker?: object;
  location?: { latitude?: number; longitude?: number; name?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}
interface WaStatus {
  id: string;
  status: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}
interface WaValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
  messages?: WaMessage[];
  statuses?: WaStatus[];
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function valuesOf(body: unknown): WaValue[] {
  const entries = (body as { entry?: Array<{ changes?: Array<{ field?: string; value?: WaValue }> }> } | null)?.entry ?? [];
  return entries.flatMap((e) => (e.changes ?? []).filter((c) => !c.field || c.field === 'messages').map((c) => c.value ?? {}));
}

function contentOf(m: WaMessage): { type: Prisma.MessageCreateManyInput['type']; body: string } {
  switch (m.type) {
    case 'text':
      return { type: 'text', body: m.text?.body ?? '' };
    case 'image':
      return { type: 'image', body: m.image?.caption ?? '[Image]' };
    case 'document':
      return { type: 'document', body: m.document?.caption ?? `[Document${m.document?.filename ? `: ${m.document.filename}` : ''}]` };
    case 'video':
      return { type: 'video', body: m.video?.caption ?? '[Video]' };
    case 'audio':
      return { type: 'audio', body: '[Voice message]' };
    case 'sticker':
      return { type: 'image', body: '[Sticker]' };
    case 'location':
      return { type: 'text', body: `[Location] ${m.location?.name ? `${m.location.name} ` : ''}${m.location?.latitude ?? ''},${m.location?.longitude ?? ''}` };
    case 'button':
      return { type: 'interactive', body: m.button?.text ?? '[Button]' };
    case 'interactive':
      return { type: 'interactive', body: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[Reply]' };
    default:
      return { type: 'text', body: `[${m.type ?? 'message'}]` };
  }
}

/**
 * WhatsApp Cloud API receiver (SPEC 14 / 15.5, change #19 wave C): verify challenge and signed events for a
 * workspace's own Meta app (/api/hooks/{workspaceId}/whatsapp, app secret and verify token from the integration) and
 * for the platform app (/api/hooks/whatsapp, WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN, routed by phone_number_id).
 * Inbound messages go into the existing conversations (contact by phone, conversation per contact, 24 h window from
 * lastInboundAt, consent from the first message or STOP), a lead is created for unknown numbers (routing applies),
 * message.received is published and the assignee notified. Statuses move outbound messages forward
 * (sent < delivered < read; failed with the error).
 */
@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: IntegrationStore,
    private readonly intake: LeadIntakeService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  private async workspaceRow(workspaceId: string): Promise<IntegrationRow> {
    const row = await this.store.db(workspaceId).integration.findFirst({ where: { provider: 'whatsapp_cloud' } });
    if (!row || row.status === 'not_connected') throw notFound('Source');
    return row;
  }

  async verifyWorkspace(workspaceId: string, q: { 'hub.mode': string; 'hub.verify_token': string; 'hub.challenge': string }): Promise<string> {
    const row = await this.workspaceRow(workspaceId);
    const token = this.store.tokensOf(row).verifyToken;
    if (q['hub.mode'] !== 'subscribe' || !token || !safeEqual(q['hub.verify_token'], token)) throw new AppException('FORBIDDEN', 'Verify token does not match');
    const state = { ...((row.syncState ?? {}) as Record<string, unknown>), webhookVerifiedAt: new Date().toISOString() };
    const clearHint = row.attention === WHATSAPP_VERIFY_HINT;
    const updated = await this.store.db(workspaceId).integration.update({
      where: { id: row.id },
      data: { syncState: state as Prisma.InputJsonObject, ...(clearHint ? { attention: null, status: row.lastError ? 'error' : 'connected' } : {}) },
    });
    await this.store.publish(workspaceId, updated, 'whatsapp_cloud');
    return q['hub.challenge'];
  }

  verifyPlatform(q: { 'hub.mode': string; 'hub.verify_token': string; 'hub.challenge': string }): string {
    const token = getEnv().WHATSAPP_VERIFY_TOKEN;
    if (q['hub.mode'] !== 'subscribe' || !token || !safeEqual(q['hub.verify_token'], token)) throw new AppException('FORBIDDEN', 'Verify token does not match');
    return q['hub.challenge'];
  }

  async receiveWorkspace(workspaceId: string, raw: Buffer | undefined, signature: string | undefined, body: unknown): Promise<{ ok: true }> {
    const row = await this.workspaceRow(workspaceId);
    // Mock mode too: the app secret given on connect signs the test requests (X-Hub-Signature-256).
    const appSecret = this.store.secretsOf(row).appSecret;
    if (!raw || !appSecret || !verifyHubSignature(appSecret, raw, signature)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid X-Hub-Signature-256');
    const phoneNumberId = String((row.config as { phoneNumberId?: string }).phoneNumberId ?? '');
    for (const value of valuesOf(body)) {
      // In mock mode any phone_number_id is accepted (no real Meta number).
      if (row.mode !== 'mock' && value.metadata?.phone_number_id && value.metadata.phone_number_id !== phoneNumberId) continue;
      await this.processValue(workspaceId, row, value);
    }
    return { ok: true };
  }

  async receivePlatform(raw: Buffer | undefined, signature: string | undefined, body: unknown): Promise<void> {
    const secret = getEnv().WHATSAPP_APP_SECRET;
    if (!raw || !secret || !verifyHubSignature(secret, raw, signature)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Invalid X-Hub-Signature-256');
    for (const value of valuesOf(body)) {
      const id = value.metadata?.phone_number_id;
      if (!id) continue;
      const row = await this.prisma.integration.findFirst({ where: { provider: 'whatsapp_cloud', status: { not: 'not_connected' }, config: { path: ['phoneNumberId'], equals: id } } });
      if (!row) continue;
      await this.processValue(row.workspaceId, row, value);
    }
  }

  private async processValue(workspaceId: string, row: IntegrationRow, value: WaValue): Promise<void> {
    const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? '', c.profile?.name ?? '']));
    for (const m of value.messages ?? []) {
      try {
        await this.inbound(workspaceId, row, m, names.get(m.from) ?? '');
      } catch (err) {
        this.logger.warn(`WhatsApp message not stored (${(err as { code?: string }).code ?? (err as Error).name})`);
      }
    }
    for (const s of value.statuses ?? []) {
      try {
        await this.status(workspaceId, s);
      } catch (err) {
        this.logger.warn(`WhatsApp status not applied (${(err as Error).name})`);
      }
    }
  }

  private async inbound(workspaceId: string, row: IntegrationRow, m: WaMessage, profileName: string): Promise<void> {
    if (!m.id || !m.from || !/^\d{6,15}$/.test(m.from)) return;
    const db = this.store.db(workspaceId);
    if (await db.message.count({ where: { providerMessageId: m.id } })) return; // Meta retries deliveries
    const phone = `+${m.from}`;
    const at = m.timestamp && /^\d+$/.test(m.timestamp) ? new Date(Number(m.timestamp) * 1000) : new Date();
    const { type, body } = contentOf(m);
    const preview = body.slice(0, PREVIEW_MAX);
    const name = profileName.trim().slice(0, 120) || phone;
    const actor = integrationActor(row.id, 'WhatsApp');

    // lead for unknown numbers (routing picks the owner); existing leads are linked by phone
    let lead = await db.lead.findFirst({ where: { phone, deletedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true, ownerId: true } });
    if (!lead) {
      const res = await this.intake.create(workspaceId, { name, phone, requirement: type === 'text' ? body.slice(0, 4000) : undefined, source: 'whatsapp', customFields: {} }, { source: 'whatsapp', actor });
      lead = res.leadId ? await db.lead.findFirst({ where: { id: res.leadId }, select: { id: true, ownerId: true } }) : null;
    }
    const contact = await db.contact.upsert({ where: { workspaceId_phone: { workspaceId, phone } }, create: { workspaceId, name, phone }, update: {}, select: { id: true, whatsappOptIn: true } });

    // consent: STOP opts out, any other first message opts in
    const stop = type === 'text' && /^\s*(stop|unsubscribe)\s*$/i.test(body);
    if (stop || contact.whatsappOptIn === null) {
      const status = stop ? 'opted_out' : 'opted_in';
      await db.consentRecord.create({ data: { workspaceId, contactId: contact.id, channel: 'whatsapp', status, source: stop ? 'keyword_stop' : 'inbound_message', evidence: { messageId: m.id, at: at.toISOString() } } });
      await db.contact.update({ where: { id: contact.id }, data: { whatsappOptIn: status } });
    }

    const existing = await db.conversation.findFirst({ where: { channel: 'whatsapp', contactId: contact.id }, select: { id: true, assigneeId: true } });
    const conv = existing
      ? await db.conversation.update({
          where: { id: existing.id },
          data: { lastInboundAt: at, lastMessageAt: at, lastMessagePreview: preview, unreadCount: { increment: 1 }, status: 'open', businessNumberId: (row.config as { phoneNumberId?: string }).phoneNumberId ?? undefined, ...(lead && !existing.assigneeId ? { assigneeId: lead.ownerId, leadId: lead.id } : {}) },
          include: CONVERSATION_INCLUDE,
        })
      : await db.conversation.create({
          data: { workspaceId, channel: 'whatsapp', contactId: contact.id, leadId: lead?.id ?? null, assigneeId: lead?.ownerId ?? null, status: 'open', unreadCount: 1, lastInboundAt: at, lastMessageAt: at, lastMessagePreview: preview, businessNumberId: (row.config as { phoneNumberId?: string }).phoneNumberId ?? null },
          include: CONVERSATION_INCLUDE,
        });

    let saved;
    try {
      saved = await db.message.create({ data: { workspaceId, conversationId: conv.id, direction: 'inbound', type, body, status: 'delivered', providerMessageId: m.id, createdAt: at } });
    } catch (err) {
      if (isUniqueViolation(err)) return;
      throw err;
    }
    if (conv.leadId) {
      await db.activity.create({ data: { workspaceId, leadId: conv.leadId, type: 'message', actorType: 'system', actorId: null, payload: { conversationId: conv.id, messageId: saved.id, direction: 'inbound', preview: body.slice(0, 200) } } });
      await db.lead.updateMany({ where: { id: conv.leadId }, data: { lastActivityAt: at } });
    }
    const message: Message = {
      id: saved.id,
      conversationId: conv.id,
      direction: 'inbound',
      type: saved.type,
      body: saved.body,
      templateName: null,
      media: null,
      status: saved.status,
      error: null,
      isInternalNote: false,
      author: null,
      createdAt: saved.createdAt.toISOString(),
    };
    const conversation = toConversation(conv);
    await publishSafe(this.events, this.logger, 'message.received', workspaceId, { conversation, message }, { actor: actor.event });
    if (conv.assigneeId) {
      await this.notifications.notify(workspaceId, conv.assigneeId, { type: 'message_received', title: `WhatsApp from ${conversation.contactName}`.slice(0, 200), body: preview, path: `/inbox?conversation=${conv.id}`, data: { conversationId: conv.id, leadId: conv.leadId } }, actor.event);
    }
    const stats = { ...((row.stats ?? {}) as Record<string, unknown>), lastMessageAt: at.toISOString() };
    await db.integration.updateMany({ where: { id: row.id }, data: { stats: stats as Prisma.InputJsonObject } });
  }

  private async status(workspaceId: string, s: WaStatus): Promise<void> {
    const allowed: MessageStatus[] = ['sent', 'delivered', 'read', 'failed'];
    if (!s.id || !(allowed as string[]).includes(s.status)) return;
    const db = this.store.db(workspaceId);
    const msg = await db.message.findFirst({ where: { providerMessageId: s.id }, select: { id: true, conversationId: true, status: true } });
    if (!msg) return;
    const next = s.status as MessageStatus;
    const forward = next === 'failed' ? msg.status !== 'read' : STATUS_RANK[next]! > STATUS_RANK[msg.status]!;
    if (!forward) return;
    const error = next === 'failed' ? (s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? 'Delivery failed').slice(0, 300) : null;
    await db.message.updateMany({ where: { id: msg.id }, data: { status: next, error } });
    await publishSafe(this.events, this.logger, 'message.status_updated', workspaceId, { conversationId: msg.conversationId, messageId: msg.id, status: next, error }, { actor: { type: 'integration', id: null, name: 'WhatsApp' } });
  }
}
