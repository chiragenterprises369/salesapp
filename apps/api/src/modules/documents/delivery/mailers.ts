import { Inject, Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { AppException } from '../../../common/errors/app-exception.js';
import { getEnv } from '../../../config/env.js';
import { assertPublicHost, BlockedUrlError, devAllowlist } from '../../../infra/http/safe-http.js';
import { IntegrationStore } from '../../integrations/integration-store.js';
import { MailSendError, sendSmtpMail, type OutgoingMail } from '../../integrations/providers/adapters.js';

export type MailVia = 'company_smtp' | 'platform_mailer';

export interface MailSent {
  via: MailVia;
  messageId: string | null;
  mock: boolean;
}

/**
 * Platform mailer port (CONFIG-API owns the real one: Super Admin > Config > Platform email, SMTP or a provider
 * API). Until it is merged the env SMTP_* fallback below stands in, with the same SSRF rules as company SMTP.
 */
export interface PlatformMailerPort {
  configured(): Promise<boolean>;
  send(mail: OutgoingMail): Promise<{ messageId: string | null }>;
}

@Injectable()
export class EnvPlatformMailer implements PlatformMailerPort {
  async configured(): Promise<boolean> {
    const env = getEnv();
    return !!env.SMTP_HOST && !!env.SMTP_FROM;
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string | null }> {
    const env = getEnv();
    if (!env.SMTP_HOST || !env.SMTP_FROM) throw new MailSendError('Platform e-mail is not configured');
    const host = env.SMTP_HOST.trim().toLowerCase();
    try {
      if (!devAllowlist().has(host)) await assertPublicHost(host);
    } catch (err) {
      if (err instanceof BlockedUrlError) throw new MailSendError(err.message);
      throw err;
    }
    const port = env.SMTP_PORT ?? 587;
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    try {
      const info = await transport.sendMail({ from: env.SMTP_FROM, to: mail.to, cc: mail.cc?.length ? mail.cc : undefined, replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments });
      return { messageId: info.messageId ?? null };
    } catch (err) {
      const e = err as { code?: string };
      throw new MailSendError(e.code === 'EAUTH' ? 'The platform mail server refused its credentials' : e.code ? `Platform e-mail failed (${e.code})` : 'Platform e-mail failed');
    } finally {
      transport.close();
    }
  }
}

export const PLATFORM_MAILER = Symbol('PLATFORM_MAILER');

/**
 * Company e-mail for documents (change #20): the company's own SMTP integration when it is connected (from its
 * mailbox), else the platform mailer with Reply-To set to the sender, else EMAIL_NOT_CONFIGURED. Mock SMTP
 * (development) builds the message without sending it.
 */
@Injectable()
export class DocumentMailer {
  constructor(
    private readonly store: IntegrationStore,
    @Inject(PLATFORM_MAILER) private readonly platform: PlatformMailerPort,
  ) {}

  async send(workspaceId: string, mail: OutgoingMail): Promise<MailSent> {
    const row = await this.store.row(workspaceId, 'smtp');
    const production = getEnv().NODE_ENV === 'production';
    try {
      if (row && row.status !== 'not_connected' && !(row.mode === 'mock' && production)) {
        const out = await sendSmtpMail((row.config ?? {}) as Record<string, unknown>, this.store.secretsOf(row), row.mode === 'mock', mail);
        return { via: 'company_smtp', messageId: out.messageId, mock: row.mode === 'mock' };
      }
      if (await this.platform.configured()) {
        const out = await this.platform.send(mail);
        return { via: 'platform_mailer', messageId: out.messageId, mock: false };
      }
    } catch (err) {
      if (err instanceof MailSendError) throw new AppException('INTEGRATION_PROVIDER_ERROR', err.message);
      throw err;
    }
    throw new AppException('INTEGRATION_NOT_CONFIGURED', 'E-mail is not set up: connect your mailbox in Integrations > E-mail (SMTP)');
  }
}
