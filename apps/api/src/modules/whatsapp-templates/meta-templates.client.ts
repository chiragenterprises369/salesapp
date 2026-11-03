import type { TemplateCategory, TemplateStatus, WhatsAppTemplateButton, WhatsAppTemplateHeader } from '@vistar/shared';
import { getEnv } from '../../config/env.js';
import { describeHttpError, safeFetch } from '../../infra/http/safe-http.js';
import { whatsappAppConfig } from '../config-registry/snapshot.js';

/**
 * Meta WhatsApp Business message templates (Graph API), through the SSRF-safe client:
 *   POST   /{version}/{wabaId}/message_templates            create (submit for review)
 *   GET    /{version}/{wabaId}/message_templates?fields=... list (statuses, rejected reasons)
 *   DELETE /{version}/{wabaId}/message_templates?name=&hsm_id=
 * Auth: the workspace's WhatsApp Cloud integration access token (Bearer). Graph version from Super Admin > Config.
 */
export interface TemplateSpec {
  name: string;
  language: string;
  category: TemplateCategory;
  header: WhatsAppTemplateHeader;
  body: string;
  bodyExamples: string[];
  footer: string | null;
  buttons: WhatsAppTemplateButton[];
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: TemplateStatus;
  category: TemplateCategory;
  rejectionReason: string | null;
  spec: TemplateSpec;
}

export class MetaApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'MetaApiError';
  }
}

const graphBase = () => `${getEnv().WHATSAPP_GRAPH_URL.replace(/\/+$/, '')}/${whatsappAppConfig().graphVersion}`;

/** Meta status -> Vistar TemplateStatus. */
export function mapMetaStatus(s: string | undefined): TemplateStatus | 'deleted' {
  switch ((s ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    case 'PAUSED':
    case 'DISABLED':
      return 'paused';
    case 'PENDING_DELETION':
    case 'DELETED':
      return 'deleted';
    default:
      return 'pending'; // PENDING, IN_APPEAL, LIMIT_EXCEEDED
  }
}

const isHandle = (v: string) => !/^https?:\/\//i.test(v);

/** Components for the create call. Media headers need an upload handle (Meta reviews the sample). */
export function toMetaComponents(t: TemplateSpec): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const h = t.header;
  if (h.format === 'text' && h.text) {
    out.push({ type: 'HEADER', format: 'TEXT', text: h.text, ...(/\{\{\s*1\s*\}\}/.test(h.text) && h.example ? { example: { header_text: [h.example] } } : {}) });
  } else if (h.format === 'image' || h.format === 'video' || h.format === 'document') {
    if (!h.example || !isHandle(h.example)) throw new MetaApiError('Media headers need the Meta upload handle of a sample file (Meta Business Manager > upload, or the Resumable Upload API)', null);
    out.push({ type: 'HEADER', format: h.format.toUpperCase(), example: { header_handle: [h.example] } });
  }
  out.push({ type: 'BODY', text: t.body, ...(t.bodyExamples.length ? { example: { body_text: [t.bodyExamples] } } : {}) });
  if (t.footer) out.push({ type: 'FOOTER', text: t.footer });
  if (t.buttons.length) {
    out.push({
      type: 'BUTTONS',
      buttons: t.buttons.map((b) =>
        b.type === 'quick_reply'
          ? { type: 'QUICK_REPLY', text: b.text }
          : b.type === 'url'
            ? { type: 'URL', text: b.text, url: b.url, ...(b.example ? { example: [b.example] } : {}) }
            : { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone },
      ),
    });
  }
  return out;
}

type MetaComponent = { type?: string; format?: string; text?: string; example?: { header_text?: string[]; body_text?: string[][]; header_handle?: string[] }; buttons?: Array<{ type?: string; text?: string; url?: string; phone_number?: string; example?: string[] }> };

/** Template made in Meta Business Manager -> Vistar fields. */
export function fromMetaComponents(components: MetaComponent[] | undefined): Omit<TemplateSpec, 'name' | 'language' | 'category'> {
  const c = components ?? [];
  const header = c.find((x) => x.type === 'HEADER');
  const body = c.find((x) => x.type === 'BODY');
  const footer = c.find((x) => x.type === 'FOOTER');
  const buttons = c.find((x) => x.type === 'BUTTONS')?.buttons ?? [];
  const format = (header?.format ?? '').toLowerCase();
  return {
    header: header
      ? format === 'text'
        ? { format: 'text', text: (header.text ?? '').slice(0, 60), example: header.example?.header_text?.[0] ?? null }
        : { format: format === 'image' || format === 'video' || format === 'document' ? format : 'none', text: null, example: header.example?.header_handle?.[0] ?? null }
      : { format: 'none', text: null, example: null },
    body: (body?.text ?? '').slice(0, 1024),
    bodyExamples: body?.example?.body_text?.[0]?.map(String) ?? [],
    footer: footer?.text ? footer.text.slice(0, 60) : null,
    buttons: buttons
      .map((b): WhatsAppTemplateButton | null => {
        const text = (b.text ?? '').slice(0, 25) || 'Open';
        if (b.type === 'QUICK_REPLY') return { type: 'quick_reply', text };
        if (b.type === 'URL' && b.url) return { type: 'url', text, url: b.url, example: b.example?.[0] ?? null };
        if (b.type === 'PHONE_NUMBER' && b.phone_number) return { type: 'phone', text, phone: b.phone_number.startsWith('+') ? b.phone_number : `+${b.phone_number}` };
        return null;
      })
      .filter((b): b is WhatsAppTemplateButton => b !== null)
      .slice(0, 10),
  };
}

function metaError(body: string, status: number): MetaApiError {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; error_user_msg?: string; error_user_title?: string } };
    const msg = j.error?.error_user_msg ?? j.error?.message;
    if (msg) return new MetaApiError(`Meta: ${msg.slice(0, 300)}`, status);
  } catch {
    /* not JSON */
  }
  return new MetaApiError(`Meta answered HTTP ${status}`, status);
}

export interface MetaTemplatesClient {
  create(spec: TemplateSpec): Promise<{ id: string; status: TemplateStatus }>;
  list(): Promise<MetaTemplate[]>;
  remove(name: string, id: string | null): Promise<void>;
}

/** Live client for one WABA. */
export function liveTemplatesClient(wabaId: string, accessToken: string): MetaTemplatesClient {
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'content-type': 'application/json' };
  const base = `${graphBase()}/${encodeURIComponent(wabaId)}/message_templates`;
  const call = async (url: string, method: 'GET' | 'POST' | 'DELETE', body?: unknown) => {
    try {
      return await safeFetch({ url, method, headers, body: body ? JSON.stringify(body) : undefined, timeoutMs: 15_000, maxResponseBytes: 2 * 1024 * 1024 });
    } catch (err) {
      throw new MetaApiError(describeHttpError(err), null);
    }
  };
  return {
    async create(spec) {
      const res = await call(base, 'POST', { name: spec.name, language: spec.language, category: spec.category.toUpperCase(), components: toMetaComponents(spec) });
      if (res.status !== 200) throw metaError(res.body, res.status);
      const j = JSON.parse(res.body) as { id?: string; status?: string };
      if (!j.id) throw new MetaApiError('Meta did not return a template id', res.status);
      const status = mapMetaStatus(j.status);
      return { id: j.id, status: status === 'deleted' ? 'pending' : status };
    },
    async list() {
      const out: MetaTemplate[] = [];
      let url: string | null = `${base}?fields=id,name,language,status,category,components,rejected_reason&limit=100`;
      for (let page = 0; url && page < 20; page++) {
        const res = await call(url, 'GET');
        if (res.status !== 200) throw metaError(res.body, res.status);
        const j = JSON.parse(res.body) as { data?: Array<{ id: string; name: string; language: string; status?: string; category?: string; rejected_reason?: string; components?: MetaComponent[] }>; paging?: { next?: string } };
        for (const t of j.data ?? []) {
          const status = mapMetaStatus(t.status);
          if (status === 'deleted') continue;
          const category = (t.category ?? 'UTILITY').toLowerCase();
          out.push({
            id: t.id,
            name: t.name,
            language: t.language,
            status,
            category: category === 'marketing' || category === 'authentication' ? category : 'utility',
            rejectionReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
            spec: { name: t.name, language: t.language, category: category === 'marketing' || category === 'authentication' ? category : 'utility', ...fromMetaComponents(t.components) },
          });
        }
        // Only follow Graph pagination links on the same host.
        const next: string | undefined = j.paging?.next;
        url = next && next.startsWith(getEnv().WHATSAPP_GRAPH_URL.replace(/\/+$/, '')) ? next : null;
      }
      return out;
    },
    async remove(name, id) {
      const res = await call(`${base}?name=${encodeURIComponent(name)}${id ? `&hsm_id=${encodeURIComponent(id)}` : ''}`, 'DELETE');
      if (res.status !== 200 && res.status !== 404) throw metaError(res.body, res.status);
    },
  };
}

/**
 * Development mock: submit -> pending; the next sync approves pending templates, except names containing
 * "reject" (rejected with a reason) so both paths can be tried without Meta.
 */
export function mockTemplatesClient(current: () => Promise<Array<{ name: string; language: string; status: TemplateStatus; providerTemplateId: string | null; spec: TemplateSpec }>>): MetaTemplatesClient {
  return {
    async create() {
      return { id: `mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, status: 'pending' };
    },
    async list() {
      return (await current())
        .filter((t) => t.providerTemplateId)
        .map((t) => {
          const reject = t.status === 'pending' && t.name.includes('reject');
          const status: TemplateStatus = t.status === 'pending' ? (reject ? 'rejected' : 'approved') : t.status;
          return { id: t.providerTemplateId!, name: t.name, language: t.language, status, category: t.spec.category, rejectionReason: reject ? 'Mock review: the name contains "reject"' : null, spec: t.spec };
        });
    },
    async remove() {
      /* nothing to delete */
    },
  };
}
