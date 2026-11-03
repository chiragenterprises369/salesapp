import { GOOGLE_OAUTH_CALLBACK_PATH, type CallStatus, type TelephonyProvider } from '@vistar/shared';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getEnv } from '../../../config/env.js';
import { assertPublicHost, BlockedUrlError, describeHttpError, devAllowlist, isBlockedAddress, safeFetch } from '../../../infra/http/safe-http.js';
import { googleOAuthConfig, whatsappAppConfig } from '../../config-registry/snapshot.js';

/** Result of a provider check (connect test, sync probe). `attention` = connected but the admin must act. */
export interface ProviderCheck {
  ok: boolean;
  message: string;
  latencyMs: number | null;
  attention?: string | null;
  stats?: Record<string, number | string | null>;
  config?: Record<string, unknown>;
}

const since = (t: number) => Date.now() - t;
const fail = (message: string, started: number): ProviderCheck => ({ ok: false, message, latencyMs: since(started) });
const jsonOf = (body: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

// ---------------------------------------------------------------- WhatsApp Cloud API

/** X-Hub-Signature-256: "sha256=<hex HMAC-SHA256(appSecret, rawBody)>", constant-time compare. */
export function verifyHubSignature(appSecret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7).trim(), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function whatsappCheck(config: Record<string, unknown>, secrets: Record<string, string>, mock: boolean): Promise<ProviderCheck> {
  const started = Date.now();
  if (mock) {
    return {
      ok: true,
      message: 'Mock WhatsApp number is ready',
      latencyMs: since(started),
      stats: { displayPhoneNumber: String(config.displayPhoneNumber ?? '+91 90000 00000'), verifiedName: 'Mock business', qualityRating: 'GREEN', messagingLimit: 'TIER_1K' },
    };
  }
  const env = getEnv();
  const id = String(config.phoneNumberId ?? '');
  // ---- change #20: config (Graph version from Super Admin > Config > WhatsApp platform app, env fallback)
  const url = `${env.WHATSAPP_GRAPH_URL.replace(/\/$/, '')}/${whatsappAppConfig().graphVersion}/${encodeURIComponent(id)}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`;
  try {
    const res = await safeFetch({ url, headers: { authorization: `Bearer ${secrets.accessToken ?? ''}`, accept: 'application/json' }, timeoutMs: 10_000, maxResponseBytes: 64 * 1024 });
    const json = jsonOf(res.body);
    if (res.status !== 200) {
      const err = (json.error as { message?: string } | undefined)?.message;
      return fail(err ? `Meta: ${err.slice(0, 200)}` : `Meta answered HTTP ${res.status}`, started);
    }
    return {
      ok: true,
      message: `Connected to ${String(json.display_phone_number ?? id)}`,
      latencyMs: res.latencyMs,
      stats: {
        displayPhoneNumber: (json.display_phone_number as string | undefined) ?? null,
        verifiedName: (json.verified_name as string | undefined) ?? null,
        qualityRating: (json.quality_rating as string | undefined) ?? null,
        messagingLimit: (json.messaging_limit_tier as string | undefined) ?? null,
      },
    };
  } catch (err) {
    return fail(describeHttpError(err), started);
  }
}

// ---------------------------------------------------------------- telephony

export interface TelephonyCallEvent {
  providerCallId: string;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  from: string;
  to: string;
  startedAt: Date;
  endedAt: Date | null;
  durationSec: number;
  recordingUrl: string | null;
}

/** Click-to-call request: the provider rings the agent first, then bridges to the customer (change #20). */
export interface TelephonyConnectRequest {
  /** Agent mobile, E.164 (rings first). */
  agent: string;
  /** Customer, E.164. */
  customer: string;
  /** Status callback URL with the token (terminal and answered events). */
  statusCallbackUrl: string;
  /** Vistar call id, echoed back by providers that support a custom field. */
  callId: string;
}

export interface TelephonyConnectResult {
  providerCallId: string;
  status: CallStatus;
  /** Number the customer sees (ExoPhone), when known. */
  callerId: string | null;
}

/** Telephony adapter interface: credential check, click-to-call (connect) and callback parsing. */
export interface TelephonyAdapter {
  readonly key: TelephonyProvider;
  check(config: Record<string, unknown>, secrets: Record<string, string>): Promise<ProviderCheck>;
  parseCallback(body: unknown): TelephonyCallEvent | null;
  connect(config: Record<string, unknown>, secrets: Record<string, string>, req: TelephonyConnectRequest): Promise<TelephonyConnectResult>;
}

/** Provider refused or failed a click-to-call (message is safe to show). */
export class TelephonyConnectError extends Error {
  constructor(
    message: string,
    readonly kind: 'config' | 'provider' = 'provider',
  ) {
    super(message);
    this.name = 'TelephonyConnectError';
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const date = (v: unknown, fallback: Date) => {
  const d = new Date(str(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? fallback : d;
};

export const mockTelephony: TelephonyAdapter = {
  key: 'mock',
  async check() {
    return { ok: true, message: 'Mock telephony is ready (calls are simulated)', latencyMs: 0 };
  },
  /** Body: { callId, direction?, status? (completed | missed | failed | in_progress | ringing), from, to, durationSec?, startedAt? }. */
  parseCallback(body) {
    const b = (body ?? {}) as Record<string, unknown>;
    const id = str(b.callId);
    if (!id || !str(b.from) || !str(b.to)) return null;
    const allowed: CallStatus[] = ['ringing', 'in_progress', 'completed', 'missed', 'failed'];
    const status = (allowed as string[]).includes(str(b.status)) ? (str(b.status) as CallStatus) : 'completed';
    const durationSec = Math.max(0, Math.round(Number(b.durationSec ?? 0)) || 0);
    const startedAt = date(b.startedAt, new Date(Date.now() - durationSec * 1000));
    const final = status === 'completed' || status === 'missed' || status === 'failed';
    return { providerCallId: id.slice(0, 120), direction: str(b.direction) === 'inbound' ? 'inbound' : 'outbound', status, from: str(b.from).slice(0, 30), to: str(b.to).slice(0, 30), startedAt, endedAt: final ? new Date(startedAt.getTime() + durationSec * 1000) : null, durationSec, recordingUrl: null };
  },
  /** No network: a mock call id; TelephonyService simulates ringing, answer and hang-up in development. */
  async connect(_config, _secrets, req) {
    return { providerCallId: `mock-${req.callId}`, status: 'ringing', callerId: '+910000000000' };
  },
};

/** Exotel (stub behind config): credential check against the account API; status callbacks parsed. */
export const exotelTelephony: TelephonyAdapter = {
  key: 'exotel',
  async check(config, secrets) {
    const started = Date.now();
    const sid = str(config.accountSid);
    if (!sid || !secrets.apiKey || !secrets.apiToken) return fail('Account SID, API key and API token are required', started);
    const host = config.subdomain === 'api.exotel.com' ? 'api.exotel.com' : 'api.in.exotel.com';
    try {
      const res = await safeFetch({
        url: `https://${host}/v1/Accounts/${encodeURIComponent(sid)}.json`,
        headers: { authorization: `Basic ${Buffer.from(`${secrets.apiKey}:${secrets.apiToken}`).toString('base64')}`, accept: 'application/json' },
        timeoutMs: 10_000,
        maxResponseBytes: 64 * 1024,
      });
      if (res.status === 200) return { ok: true, message: 'Exotel credentials accepted', latencyMs: res.latencyMs };
      if (res.status === 401 || res.status === 403) return fail('Exotel rejected the API key or token', started);
      return fail(`Exotel answered HTTP ${res.status}`, started);
    } catch (err) {
      return fail(describeHttpError(err), started);
    }
  },
  /** Exotel status callback (form or JSON): CallSid, Status, Direction, From, To, StartTime, EndTime, DialCallDuration, RecordingUrl. */
  parseCallback(body) {
    const b = (body ?? {}) as Record<string, unknown>;
    const id = str(b.CallSid);
    if (!id) return null;
    const s = str(b.Status || b.CallStatus).toLowerCase();
    const status: CallStatus = s === 'completed' ? 'completed' : s === 'in-progress' ? 'in_progress' : s === 'ringing' || s === 'queued' ? 'ringing' : s === 'no-answer' || s === 'busy' || s === 'canceled' ? 'missed' : s ? 'failed' : 'completed';
    const durationSec = Math.max(0, Math.round(Number(b.DialCallDuration ?? b.ConversationDuration ?? b.Duration ?? 0)) || 0);
    const startedAt = date(b.StartTime, new Date(Date.now() - durationSec * 1000));
    const endedAt = status === 'completed' || status === 'missed' || status === 'failed' ? date(b.EndTime, new Date(startedAt.getTime() + durationSec * 1000)) : null;
    return { providerCallId: id.slice(0, 120), direction: str(b.Direction).startsWith('inbound') ? 'inbound' : 'outbound', status, from: str(b.From).slice(0, 30), to: str(b.To).slice(0, 30), startedAt, endedAt, durationSec, recordingUrl: str(b.RecordingUrl) || null };
  },
  /**
   * Exotel Connect API (change #20): POST /v1/Accounts/<sid>/Calls/connect.json, form fields From (agent, rung
   * first), To (customer), CallerId (ExoPhone), Record, StatusCallback with terminal and answered events (JSON),
   * CustomField (Vistar call id). Basic auth with the API key and token. Fixed Exotel host, no redirects.
   */
  async connect(config, secrets, req) {
    const sid = str(config.accountSid);
    const callerId = str(config.callerId);
    if (!sid || !secrets.apiKey || !secrets.apiToken) throw new TelephonyConnectError('Exotel account SID, API key and API token are not set', 'config');
    if (!callerId) throw new TelephonyConnectError('Set the ExoPhone (caller ID) in Integrations > Telephony', 'config');
    const host = config.subdomain === 'api.exotel.com' ? 'api.exotel.com' : 'api.in.exotel.com';
    const form = new URLSearchParams({
      From: req.agent,
      To: req.customer,
      CallerId: callerId,
      CallType: 'trans',
      Record: config.recordCalls === false ? 'false' : 'true',
      StatusCallback: req.statusCallbackUrl,
      'StatusCallbackEvents[0]': 'terminal',
      'StatusCallbackEvents[1]': 'answered',
      StatusCallbackContentType: 'application/json',
      CustomField: req.callId,
      TimeLimit: '3600',
    });
    let res;
    try {
      res = await safeFetch({
        url: `https://${host}/v1/Accounts/${encodeURIComponent(sid)}/Calls/connect.json`,
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${secrets.apiKey}:${secrets.apiToken}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: form.toString(),
        timeoutMs: 15_000,
        maxResponseBytes: 64 * 1024,
      });
    } catch (err) {
      throw new TelephonyConnectError(`Could not reach Exotel: ${describeHttpError(err)}`);
    }
    const json = jsonOf(res.body);
    if (res.status === 401 || res.status === 403) throw new TelephonyConnectError('Exotel rejected the API key or token', 'config');
    if (res.status < 200 || res.status >= 300) {
      const message = (json.RestException as { Message?: string } | undefined)?.Message;
      throw new TelephonyConnectError(message ? `Exotel: ${String(message).slice(0, 200)}` : `Exotel answered HTTP ${res.status}`);
    }
    const call = (json.Call ?? {}) as Record<string, unknown>;
    const providerCallId = str(call.Sid);
    if (!providerCallId) throw new TelephonyConnectError('Exotel did not return a call id');
    const s = str(call.Status).toLowerCase();
    return { providerCallId: providerCallId.slice(0, 120), status: s === 'in-progress' ? 'in_progress' : 'ringing', callerId };
  },
};

export const TELEPHONY_ADAPTERS: Record<TelephonyProvider, TelephonyAdapter> = { mock: mockTelephony, exotel: exotelTelephony };

// ---------------------------------------------------------------- SMTP

/** A vetted address to connect to (DNS checked once, so a rebinding resolver cannot redirect the SMTP socket). Also used by the company mailer (change #20). */
export async function smtpTarget(host: string): Promise<{ host: string; servername: string | undefined }> {
  const h = host.trim().toLowerCase();
  if (devAllowlist().has(h)) return { host: h, servername: undefined };
  if (isIP(h)) {
    await assertPublicHost(h);
    return { host: h, servername: undefined };
  }
  const all = await dnsLookup(h, { all: true, verbatim: true }).catch(() => []);
  const ok = all.find((a) => !isBlockedAddress(a.address));
  if (!all.length || !ok || all.some((a) => isBlockedAddress(a.address))) throw new BlockedUrlError(`${h} resolves to a private or reserved address`);
  return { host: ok.address, servername: h };
}

export async function smtpCheck(config: Record<string, unknown>, secrets: Record<string, string>, mock: boolean, to: string): Promise<ProviderCheck & { messageId?: string }> {
  const started = Date.now();
  const fromEmail = str(config.fromEmail) || 'no-reply@vistar.example';
  const from = config.fromName ? `"${str(config.fromName).replace(/"/g, '')}" <${fromEmail}>` : fromEmail;
  const mail = {
    from,
    to,
    subject: 'Vistar test e-mail',
    text: 'This is a test e-mail from Vistar. Your SMTP settings work: quotations, invoices and workflow e-mails can be sent from this mailbox.',
  };
  try {
    if (mock) {
      const t = nodemailer.createTransport({ jsonTransport: true });
      const info = await t.sendMail(mail);
      return { ok: true, message: `Mock: test e-mail to ${to} built, not sent`, latencyMs: since(started), messageId: info.messageId };
    }
    const target = await smtpTarget(str(config.host));
    const port = Number(config.port ?? 587);
    const transport = nodemailer.createTransport({
      host: target.host,
      port,
      secure: config.secure === true,
      auth: config.username ? { user: str(config.username), pass: secrets.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      tls: target.servername ? { servername: target.servername } : undefined,
    });
    try {
      await transport.verify();
      const info = await transport.sendMail(mail);
      return { ok: true, message: `Test e-mail sent to ${to}`, latencyMs: since(started), messageId: info.messageId };
    } finally {
      transport.close();
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) return fail(err.message, started);
    const e = err as { code?: string; responseCode?: number };
    if (e.code === 'EAUTH') return fail(`Authentication failed${e.responseCode ? ` (${e.responseCode})` : ''}: check the user name and password`, started);
    if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'EDNS') return fail(`Could not connect to ${str(config.host)}:${String(config.port ?? 587)}`, started);
    if (e.code === 'EENVELOPE') return fail('The server refused the from or to address', started);
    return fail(e.code ? `SMTP error (${e.code})` : 'SMTP error', started);
  }
}

// ---- change #20: prod (company SMTP for document e-mails)
export interface OutgoingMail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

/** Thrown with a message that is safe to show (no credentials, no server banners). */
export class MailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailSendError';
  }
}

/**
 * Send one e-mail through the company's SMTP integration (same SSRF-safe connection rules as the test e-mail).
 * Mock mode builds the message without sending it. Returns the message id.
 */
export async function sendSmtpMail(config: Record<string, unknown>, secrets: Record<string, string>, mock: boolean, mail: OutgoingMail): Promise<{ messageId: string | null }> {
  const fromEmail = str(config.fromEmail);
  if (!fromEmail) throw new MailSendError('Set the from address in Integrations > E-mail (SMTP)');
  const from = config.fromName ? `"${str(config.fromName).replace(/"/g, '')}" <${fromEmail}>` : fromEmail;
  const message = { from, to: mail.to, cc: mail.cc?.length ? mail.cc : undefined, replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments };
  try {
    if (mock) {
      const info = await nodemailer.createTransport({ jsonTransport: true }).sendMail(message);
      return { messageId: info.messageId ?? null };
    }
    const target = await smtpTarget(str(config.host));
    const transport = nodemailer.createTransport({
      host: target.host,
      port: Number(config.port ?? 587),
      secure: config.secure === true,
      auth: config.username ? { user: str(config.username), pass: secrets.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      tls: target.servername ? { servername: target.servername } : undefined,
    });
    try {
      const info = await transport.sendMail(message);
      return { messageId: info.messageId ?? null };
    } finally {
      transport.close();
    }
  } catch (err) {
    if (err instanceof BlockedUrlError) throw new MailSendError(err.message);
    const e = err as { code?: string; responseCode?: number };
    if (e.code === 'EAUTH') throw new MailSendError('The mail server refused the user name or password');
    if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'EDNS') throw new MailSendError(`Could not connect to ${str(config.host)}:${String(config.port ?? 587)}`);
    if (e.code === 'EENVELOPE') throw new MailSendError('The mail server refused the from or to address');
    if (e.code === 'EMESSAGE' && e.responseCode === 552) throw new MailSendError('The mail server refused the message size (attachment too large)');
    throw new MailSendError(e.code ? `SMTP error (${e.code})` : 'SMTP error');
  }
}
// ---- end change #20: prod

// ---------------------------------------------------------------- Google Calendar

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

// ---- change #20: config (Google OAuth client from Super Admin > Config, env fallback)
export function googleConfigured(): boolean {
  return googleOAuthConfig() !== null;
}

export function googleClient(): OAuth2Client {
  const env = getEnv();
  const g = googleOAuthConfig();
  return new OAuth2Client({ clientId: g?.clientId, clientSecret: g?.clientSecret, redirectUri: `${env.API_PUBLIC_URL.replace(/\/$/, '')}${GOOGLE_OAUTH_CALLBACK_PATH}` });
}

export async function googleCheck(secrets: Record<string, string>, mock: boolean): Promise<ProviderCheck> {
  const started = Date.now();
  if (mock) return { ok: true, message: 'Mock Google Calendar is ready', latencyMs: 0, stats: { calendars: 1 } };
  if (!googleConfigured()) return fail('Google sign-in is not set up on this server', started);
  if (!secrets.refreshToken) return { ok: false, message: 'Sign in with Google to finish connecting', latencyMs: null, attention: 'Sign in with Google to finish connecting' };
  try {
    const client = googleClient();
    client.setCredentials({ refresh_token: secrets.refreshToken });
    const res = await client.request<{ items?: unknown[] }>({ url: 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50', timeout: 10_000 });
    return { ok: true, message: `Connected (${res.data.items?.length ?? 0} calendars)`, latencyMs: since(started), stats: { calendars: res.data.items?.length ?? 0 } };
  } catch (err) {
    const e = err as { response?: { status?: number; data?: { error?: string } } };
    if (e.response?.data?.error === 'invalid_grant') return { ok: false, message: 'Google access was revoked or expired', latencyMs: since(started), attention: 'Google access was revoked: connect again' };
    return fail(e.response?.status ? `Google answered HTTP ${e.response.status}` : 'Could not reach Google', started);
  }
}
