import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import type { MailConfig } from '../config-registry/snapshot.js';

/**
 * MAILER (change #20, D-074). One interface for every outgoing e-mail:
 * - platform mails (invites, password reset, verification, Super Admin alerts, Vistar billing) through
 *   `PlatformMailerService` with the Super Admin > Config > Platform email settings;
 * - company mails (quotations, invoices, reminders) through `CompanyEmailService`, which uses the company's own
 *   SMTP integration when connected, else the platform mailer with the company as the sender name.
 *
 * Adapters: SMTP (nodemailer), Resend and SendGrid (HTTPS APIs), and a development log mailer (builds the message,
 * logs only the recipient domain and subject length, never the content). Never log bodies, tokens or addresses.
 */
export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string | readonly string[];
  subject: string;
  html: string;
  text: string;
  /** Default: the mailer's configured sender. */
  from?: { name: string; email: string };
  replyTo?: string | null;
  cc?: readonly string[];
  bcc?: readonly string[];
  attachments?: readonly MailAttachment[];
  /** Extra headers (e.g. List-Unsubscribe); never secrets. */
  headers?: Readonly<Record<string, string>>;
}

export type MailerKind = 'smtp' | 'resend' | 'sendgrid' | 'dev_log' | 'company_smtp';

export interface MailSendResult {
  ok: boolean;
  messageId: string | null;
  /** User-safe; no credentials. */
  message: string;
  via: MailerKind;
}

export interface Mailer {
  readonly kind: MailerKind;
  send(msg: MailMessage): Promise<MailSendResult>;
  /** Connection or credential check without sending (SMTP verify, API key check). */
  verify?(): Promise<{ ok: boolean; message: string }>;
}

const list = (to: string | readonly string[]) => (typeof to === 'string' ? [to] : [...to]);
const fromHeader = (f: { name: string; email: string }) => `"${f.name.replace(/["\r\n]/g, '')}" <${f.email}>`;

function smtpError(err: unknown, host: string, port: number): string {
  const e = err as { code?: string; responseCode?: number };
  if (e.code === 'EAUTH') return `Authentication failed${e.responseCode ? ` (${e.responseCode})` : ''}: check the user name and password`;
  if (e.code === 'ESOCKET' || e.code === 'ECONNECTION' || e.code === 'ETIMEDOUT' || e.code === 'EDNS' || e.code === 'ECONNREFUSED') return `Could not connect to ${host}:${port}`;
  if (e.code === 'EENVELOPE') return 'The server refused the from or to address';
  if (e.code === 'ETLS') return 'TLS handshake failed: check the TLS setting and port';
  return e.code ? `SMTP error (${e.code})` : 'SMTP error';
}

export interface SmtpOptions {
  host: string;
  port: number;
  tls: 'starttls' | 'tls' | 'none';
  user: string | null;
  password: string | null;
  from: { name: string; email: string };
  replyTo?: string | null;
  /** TLS server name when `host` is a vetted IP (company SMTP, SSRF guard). */
  servername?: string;
  kind?: Extract<MailerKind, 'smtp' | 'company_smtp'>;
}

/** SMTP through nodemailer; one connection per message (low volume, no pooled sockets kept open). */
export class SmtpMailer implements Mailer {
  readonly kind: Extract<MailerKind, 'smtp' | 'company_smtp'>;
  constructor(private readonly o: SmtpOptions) {
    this.kind = o.kind ?? 'smtp';
  }

  private transport() {
    return nodemailer.createTransport({
      host: this.o.host,
      port: this.o.port,
      secure: this.o.tls === 'tls',
      requireTLS: this.o.tls === 'starttls',
      ignoreTLS: this.o.tls === 'none',
      auth: this.o.user ? { user: this.o.user, pass: this.o.password ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: this.o.servername ? { servername: this.o.servername } : undefined,
    });
  }

  async verify(): Promise<{ ok: boolean; message: string }> {
    const t = this.transport();
    try {
      await t.verify();
      return { ok: true, message: `Connected to ${this.o.servername ?? this.o.host}:${this.o.port}` };
    } catch (err) {
      return { ok: false, message: smtpError(err, this.o.servername ?? this.o.host, this.o.port) };
    } finally {
      t.close();
    }
  }

  async send(msg: MailMessage): Promise<MailSendResult> {
    const t = this.transport();
    try {
      const info = await t.sendMail({
        from: fromHeader(msg.from ?? this.o.from),
        to: list(msg.to),
        cc: msg.cc ? [...msg.cc] : undefined,
        bcc: msg.bcc ? [...msg.bcc] : undefined,
        replyTo: msg.replyTo ?? this.o.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers ? { ...msg.headers } : undefined,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { ok: true, messageId: info.messageId ?? null, message: 'Sent', via: this.kind };
    } catch (err) {
      return { ok: false, messageId: null, message: smtpError(err, this.o.servername ?? this.o.host, this.o.port), via: this.kind };
    } finally {
      t.close();
    }
  }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: Record<string, unknown>; header: (n: string) => string | null }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000), redirect: 'error' });
  const text = await res.text().catch(() => '');
  let json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json, header: (n) => res.headers.get(n) };
}

/** Resend (https://api.resend.com/emails). */
export class ResendMailer implements Mailer {
  readonly kind = 'resend' as const;
  constructor(private readonly apiKey: string, private readonly from: { name: string; email: string }, private readonly replyTo: string | null) {}

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (res.status === 200) return { ok: true, message: 'Resend accepted the API key' };
      // A send-only key cannot list domains (401 restricted_api_key): the key exists.
      if (res.status === 401 && /restricted/i.test(await res.text().catch(() => ''))) return { ok: true, message: 'Resend accepted the API key (sending only)' };
      return { ok: false, message: res.status === 401 || res.status === 403 ? 'Resend rejected the API key' : `Resend answered HTTP ${res.status}` };
    } catch {
      return { ok: false, message: 'Could not reach Resend' };
    }
  }

  async send(msg: MailMessage): Promise<MailSendResult> {
    try {
      const res = await postJson('https://api.resend.com/emails', { authorization: `Bearer ${this.apiKey}` }, {
        from: fromHeader(msg.from ?? this.from),
        to: list(msg.to),
        cc: msg.cc,
        bcc: msg.bcc,
        reply_to: msg.replyTo ?? this.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })),
      });
      if (res.status >= 200 && res.status < 300) return { ok: true, messageId: (res.json.id as string | undefined) ?? null, message: 'Sent', via: this.kind };
      const err = typeof res.json.message === 'string' ? res.json.message.slice(0, 200) : `HTTP ${res.status}`;
      return { ok: false, messageId: null, message: `Resend refused the message: ${err}`, via: this.kind };
    } catch {
      return { ok: false, messageId: null, message: 'Could not reach Resend', via: this.kind };
    }
  }
}

/** SendGrid v3 (https://api.sendgrid.com/v3/mail/send). */
export class SendGridMailer implements Mailer {
  readonly kind = 'sendgrid' as const;
  constructor(private readonly apiKey: string, private readonly from: { name: string; email: string }, private readonly replyTo: string | null) {}

  async verify(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/scopes', { headers: { authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (res.status !== 200) return { ok: false, message: res.status === 401 || res.status === 403 ? 'SendGrid rejected the API key' : `SendGrid answered HTTP ${res.status}` };
      const body = (await res.json().catch(() => ({}))) as { scopes?: string[] };
      return body.scopes?.includes('mail.send') === false ? { ok: false, message: 'The API key cannot send mail (mail.send scope missing)' } : { ok: true, message: 'SendGrid accepted the API key' };
    } catch {
      return { ok: false, message: 'Could not reach SendGrid' };
    }
  }

  async send(msg: MailMessage): Promise<MailSendResult> {
    const from = msg.from ?? this.from;
    const replyTo = msg.replyTo ?? this.replyTo;
    try {
      const res = await postJson('https://api.sendgrid.com/v3/mail/send', { authorization: `Bearer ${this.apiKey}` }, {
        personalizations: [{ to: list(msg.to).map((email) => ({ email })), ...(msg.cc?.length ? { cc: msg.cc.map((email) => ({ email })) } : {}), ...(msg.bcc?.length ? { bcc: msg.bcc.map((email) => ({ email })) } : {}) }],
        from: { email: from.email, name: from.name },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        subject: msg.subject,
        content: [{ type: 'text/plain', value: msg.text }, { type: 'text/html', value: msg.html }],
        ...(msg.headers ? { headers: msg.headers } : {}),
        ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, type: a.contentType, content: a.content.toString('base64'), disposition: 'attachment' })) } : {}),
      });
      if (res.status === 202 || res.status === 200) return { ok: true, messageId: res.header('x-message-id'), message: 'Sent', via: this.kind };
      const errors = res.json.errors as Array<{ message?: string }> | undefined;
      return { ok: false, messageId: null, message: `SendGrid refused the message: ${(errors?.[0]?.message ?? `HTTP ${res.status}`).slice(0, 200)}`, via: this.kind };
    } catch {
      return { ok: false, messageId: null, message: 'Could not reach SendGrid', via: this.kind };
    }
  }
}

/** Development without any mailer: builds the MIME message, logs that it would be sent, sends nothing. */
export class DevLogMailer implements Mailer {
  readonly kind = 'dev_log' as const;
  private readonly logger = new Logger('DevLogMailer');
  constructor(private readonly from: { name: string; email: string }) {}

  async send(msg: MailMessage): Promise<MailSendResult> {
    const t = nodemailer.createTransport({ jsonTransport: true });
    const info = await t.sendMail({ from: fromHeader(msg.from ?? this.from), to: list(msg.to), subject: msg.subject, html: msg.html, text: msg.text });
    const domains = list(msg.to).map((a) => a.split('@')[1] ?? '?').join(',');
    this.logger.log(`E-mail built, not sent (no platform mailer configured): to @${domains}, ${msg.subject.length} char subject`);
    return { ok: true, messageId: info.messageId ?? `dev-${randomUUID()}`, message: 'Development: built and logged, not sent (configure Super Admin > Config > Platform email)', via: this.kind };
  }
}

/** The platform mailer for a config; null = not configured. */
export function createPlatformMailer(cfg: MailConfig | null): Mailer | null {
  if (!cfg) return null;
  if (cfg.provider === 'resend' && cfg.apiKey) return new ResendMailer(cfg.apiKey, cfg.from, cfg.replyTo);
  if (cfg.provider === 'sendgrid' && cfg.apiKey) return new SendGridMailer(cfg.apiKey, cfg.from, cfg.replyTo);
  if (cfg.smtp) return new SmtpMailer({ ...cfg.smtp, from: cfg.from, replyTo: cfg.replyTo });
  return null;
}
