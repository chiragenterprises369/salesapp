import { Injectable } from '@nestjs/common';
import { AppException } from '../../../common/errors/app-exception.js';
import { CompanyEmailService } from '../../mail/company-email.service.js';
import type { MailAttachment } from '../../mail/mailer.js';

export type MailVia = 'company_smtp' | 'platform_mailer';

export interface DocumentMail {
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface MailSent {
  ok: boolean;
  via: MailVia;
  messageId: string | null;
  /** Development log mailer (mock company SMTP, or no Platform email outside production): built, not sent. */
  mock: boolean;
  /** User-safe failure reason when `ok` is false. */
  error: string | null;
}

/**
 * Company e-mail for documents (change #20): CONFIG-API's CompanyEmailService picks the company's own SMTP
 * integration when it is connected (from its mailbox), else the platform mailer (Super Admin > Config > Platform
 * email) with the company name as the sender and Reply-To set to the sender. Neither: EMAIL_NOT_CONFIGURED (422).
 */
@Injectable()
export class DocumentMailer {
  constructor(private readonly companyEmail: CompanyEmailService) {}

  async send(workspaceId: string, mail: DocumentMail, senderName?: string | null): Promise<MailSent> {
    if (!(await this.companyEmail.isConfigured(workspaceId))) {
      throw new AppException('EMAIL_NOT_CONFIGURED', 'E-mail is not set up: connect your mailbox in Integrations > E-mail (SMTP), or ask the platform admin to set up Platform email');
    }
    const r = await this.companyEmail.send(
      workspaceId,
      { to: mail.to, cc: mail.cc, replyTo: mail.replyTo, subject: mail.subject, html: mail.html, text: mail.text, attachments: mail.attachments },
      { senderName, tag: 'document' },
    );
    return { ok: r.ok, via: r.via === 'company_smtp' ? 'company_smtp' : 'platform_mailer', messageId: r.messageId, mock: r.via === 'dev_log', error: r.ok ? null : r.message };
  }
}
