import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { MessageStatus } from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { describeHttpError, safeFetch } from '../../infra/http/safe-http.js';
import { IntegrationStore, type IntegrationRow } from '../integrations/integration-store.js';
import { publishSafe } from '../leads/lib/context.js';
import { StorageService } from '../storage/storage.service.js';

/** What to send through the WhatsApp Cloud API (change #20). */
export type WhatsappPayload =
  | { kind: 'text'; body: string }
  | { kind: 'template'; name: string; language: string; bodyParams: string[]; headerParams: string[]; headerMedia?: { format: 'image' | 'video' | 'document'; link: string; filename?: string }; buttonParams: Array<{ index: number; text: string }> }
  | { kind: 'media'; fileId: string; mime: string; name: string; caption: string | null };

export interface WhatsappSendResult {
  status: MessageStatus;
  providerMessageId: string | null;
  error: string | null;
  mode: 'live' | 'mock';
}

/** Meta media type of a MIME type (documents for everything that is not image, audio or video). */
export function mediaKind(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (/^image\/(jpeg|png|webp)$/.test(mime)) return 'image';
  if (/^video\/(mp4|3gpp)$/.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  return 'document';
}

/** Numbered placeholders {{1}}..{{n}} (and named ones, in first-appearance order) of a template text. */
export function placeholdersOf(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen: string[] = [];
  for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen.sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : 0));
}

/**
 * Values for a template's placeholders from the caller's variables: `{{1}}` takes values["1"], else the value of the
 * variable name declared at that position (Template.variables), else a named key. Missing values are reported.
 */
export function templateParams(text: string | null | undefined, declared: readonly string[], values: Record<string, string>, prefix = ''): { params: string[]; missing: string[] } {
  const params: string[] = [];
  const missing: string[] = [];
  for (const key of placeholdersOf(text)) {
    const name = /^\d+$/.test(key) ? declared[Number(key) - 1] : key;
    const v = values[`${prefix}${key}`] ?? (name ? values[`${prefix}${name}`] : undefined) ?? (prefix ? undefined : name ? values[name] : undefined);
    if (v === undefined || String(v).trim() === '') missing.push(`${prefix}${key}`);
    params.push(String(v ?? '').slice(0, 1024));
  }
  return { params, missing };
}

/** E.164 "+919876543210" -> Meta wa_id "919876543210". */
const waId = (phone: string) => phone.replace(/[^\d]/g, '');

/**
 * Cloud API template payload for a stored template (name, language, header and body placeholders) and the caller's
 * variables: body `{{n}}` from values["n"] or the declared variable name, header from "header.n", URL button
 * suffixes from "button.<index>". Throws VALIDATION_FAILED listing missing values (Meta rejects empty parameters).
 */
export function whatsappTemplatePayload(
  t: { name: string; language: string; body: string; header: string | null; variables: readonly string[]; headerFormat?: string | null; headerExample?: string | null; buttons?: unknown },
  values: Record<string, string>,
): Extract<WhatsappPayload, { kind: 'template' }> {
  const body = templateParams(t.body, t.variables, values);
  const format = t.headerFormat ?? 'none';
  const header = format === 'text' || format === 'none' ? templateParams(t.header, [], values, 'header.') : { params: [], missing: [] };
  const missing = [...header.missing, ...body.missing];
  // media header (image, video, document): a public https link, e.g. the document PDF
  let headerMedia: { format: 'image' | 'video' | 'document'; link: string; filename?: string } | undefined;
  if (format === 'image' || format === 'video' || format === 'document') {
    const link = values['header.media'] ?? t.headerExample ?? '';
    if (!/^https:\/\//.test(link)) missing.push('header.media');
    else headerMedia = { format, link, ...(format === 'document' && values['header.filename'] ? { filename: values['header.filename'].slice(0, 240) } : {}) };
  }
  // URL buttons with a dynamic suffix ({{1}} at the end) need their value by button index
  const buttons = Array.isArray(t.buttons) ? (t.buttons as Array<{ type?: string; url?: string }>) : [];
  const buttonParams: Array<{ index: number; text: string }> = [];
  buttons.forEach((b, index) => {
    if (b.type !== 'url' || !b.url || !/\{\{\s*1\s*\}\}\s*$/.test(b.url)) return;
    const v = values[`button.${index}`];
    if (!v) missing.push(`button.${index}`);
    else buttonParams.push({ index, text: v.slice(0, 2000) });
  });
  if (!buttons.length) {
    // templates synced before buttons were stored: explicit values only
    for (const [k, v] of Object.entries(values)) {
      const m = /^button\.(\d)$/.exec(k);
      if (m && v) buttonParams.push({ index: Number(m[1]), text: v.slice(0, 2000) });
    }
  }
  if (missing.length) throw new AppException('VALIDATION_FAILED', 'Fill in every template variable', { details: missing.map((m) => ({ path: `variables.${m}`, message: 'Required' })) });
  return { kind: 'template', name: t.name, language: t.language || 'en', bodyParams: body.params, headerParams: header.params, ...(headerMedia ? { headerMedia } : {}), buttonParams };
}

const MOCK_STEPS: Array<{ after: number; status: MessageStatus }> = [
  { after: 2_000, status: 'delivered' },
  { after: 6_000, status: 'read' },
];

/**
 * WhatsApp Cloud API sender (change #20, SPEC 14 and 30): POST /{version}/{phone_number_id}/messages with the
 * workspace's system user token for text (inside the 24 h window), approved templates with body, header and URL
 * button parameters, and media by link (a signed Vistar file URL that Meta fetches at once). Delivery statuses come
 * back through the receiver (WhatsappService). The mock connection (development only) answers with a mock message id
 * and moves the message to delivered and read through message.status_updated.
 * The 24 h window and opt-out rules are checked by the callers (ConversationsService, document delivery).
 */
@Injectable()
export class WhatsappSender implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappSender.name);
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly store: IntegrationStore,
    private readonly storage: StorageService,
    private readonly events: EventBus,
  ) {}

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  /** The connected WhatsApp integration, or a readable error (plan, not connected, mock in production). */
  async connection(workspaceId: string): Promise<IntegrationRow> {
    const features = await this.store.features(workspaceId);
    if (!features.whatsapp) throw new AppException('FEATURE_DISABLED', 'WhatsApp is not part of your plan');
    const row = await this.store.row(workspaceId, 'whatsapp_cloud');
    if (!row || row.status === 'not_connected') throw new AppException('INTEGRATION_NOT_CONNECTED', 'Connect WhatsApp in Integrations first');
    if (row.mode === 'mock' && getEnv().NODE_ENV === 'production') throw new AppException('INTEGRATION_NOT_CONFIGURED', 'Mock WhatsApp is not available in production: connect the WhatsApp Cloud API');
    return row;
  }

  /** Send one message to an E.164 number. Never throws for provider rejections: the result carries status failed. */
  async send(workspaceId: string, row: IntegrationRow, to: string, payload: WhatsappPayload): Promise<WhatsappSendResult> {
    if (row.mode === 'mock') return { status: 'sent', providerMessageId: `wamid.mock-${randomUUID()}`, error: null, mode: 'mock' };
    const env = getEnv();
    const config = (row.config ?? {}) as { phoneNumberId?: string };
    const token = this.store.secretsOf(row).accessToken;
    if (!config.phoneNumberId || !token) return { status: 'failed', providerMessageId: null, error: 'WhatsApp phone number ID or access token missing: reconnect WhatsApp', mode: 'live' };
    const body: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to: waId(to) };
    if (payload.kind === 'text') Object.assign(body, { type: 'text', text: { body: payload.body, preview_url: true } });
    if (payload.kind === 'template') {
      const components: unknown[] = [];
      if (payload.headerMedia) components.push({ type: 'header', parameters: [{ type: payload.headerMedia.format, [payload.headerMedia.format]: { link: payload.headerMedia.link, ...(payload.headerMedia.filename ? { filename: payload.headerMedia.filename } : {}) } }] });
      else if (payload.headerParams.length) components.push({ type: 'header', parameters: payload.headerParams.map((text) => ({ type: 'text', text })) });
      if (payload.bodyParams.length) components.push({ type: 'body', parameters: payload.bodyParams.map((text) => ({ type: 'text', text })) });
      for (const b of payload.buttonParams) components.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: b.text }] });
      Object.assign(body, { type: 'template', template: { name: payload.name, language: { code: payload.language }, ...(components.length ? { components } : {}) } });
    }
    if (payload.kind === 'media') {
      const kind = mediaKind(payload.mime);
      const link = this.storage.signedUrl({ id: payload.fileId }, 't', 3_600).url;
      const media: Record<string, unknown> = { link };
      if (payload.caption && kind !== 'audio') media.caption = payload.caption.slice(0, 1024);
      if (kind === 'document') media.filename = payload.name.slice(0, 240);
      Object.assign(body, { type: kind, [kind]: media });
    }
    const url = `${env.WHATSAPP_GRAPH_URL.replace(/\/$/, '')}/${env.WHATSAPP_GRAPH_VERSION}/${encodeURIComponent(config.phoneNumberId)}/messages`;
    try {
      const res = await safeFetch({ url, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), timeoutMs: 15_000, maxResponseBytes: 16 * 1024 });
      let json: { messages?: Array<{ id?: string }>; error?: { message?: string; code?: number; error_data?: { details?: string } } } = {};
      try {
        json = JSON.parse(res.body) as typeof json;
      } catch {
        // not JSON
      }
      const id = json.messages?.[0]?.id;
      if (res.status >= 200 && res.status < 300 && id) return { status: 'sent', providerMessageId: id, error: null, mode: 'live' };
      const detail = json.error?.error_data?.details ?? json.error?.message;
      const error = (detail ? `WhatsApp: ${detail}` : `WhatsApp answered HTTP ${res.status}`).slice(0, 300);
      if (res.status === 401 || json.error?.code === 190) await this.markTokenProblem(workspaceId, row);
      return { status: 'failed', providerMessageId: null, error, mode: 'live' };
    } catch (err) {
      return { status: 'failed', providerMessageId: null, error: `Could not reach WhatsApp: ${describeHttpError(err)}`, mode: 'live' };
    }
  }

  /** The access token expired or was revoked: the hub shows the connection in error. */
  private async markTokenProblem(workspaceId: string, row: IntegrationRow): Promise<void> {
    const updated = await this.store.db(workspaceId).integration.update({ where: { id: row.id }, data: { status: 'error', lastError: 'The WhatsApp access token is invalid or expired: paste a new system user token', lastCheckedAt: new Date() } });
    await this.store.publish(workspaceId, updated, 'whatsapp_cloud');
  }

  /** Mock only: delivered after 2 s, read after 6 s (statuses only move forward). */
  simulateMockStatuses(workspaceId: string, message: { id: string; conversationId: string }): void {
    if (getEnv().NODE_ENV === 'production') return;
    for (const step of MOCK_STEPS) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        void this.moveStatus(workspaceId, message, step.status).catch((err: Error) => this.logger.warn(`Mock status failed: ${err.name}`));
      }, step.after);
      t.unref();
      this.timers.add(t);
    }
  }

  private async moveStatus(workspaceId: string, message: { id: string; conversationId: string }, status: MessageStatus): Promise<void> {
    const db = this.store.db(workspaceId);
    const allowed: MessageStatus[] = status === 'read' ? ['sent', 'delivered'] : ['sent'];
    const { count } = await db.message.updateMany({ where: { id: message.id, status: { in: allowed } }, data: { status } });
    if (count) await publishSafe(this.events, this.logger, 'message.status_updated', workspaceId, { conversationId: message.conversationId, messageId: message.id, status, error: null }, { actor: { type: 'integration', id: null, name: 'WhatsApp' } });
  }
}
