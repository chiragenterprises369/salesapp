import { Injectable, Logger } from '@nestjs/common';
import {
  emailTemplateDefault,
  emailTemplateVariables,
  renderEmail,
  SETTING_KEYS,
  SellerProfileSchema,
  type CompanyEmailTemplateKey,
  type EmailBrand,
  type EmailLayoutTheme,
  type EmailSendResult,
  type RenderedEmail,
  type TemplateValues,
} from '@vistar/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { mailConfig } from '../config-registry/snapshot.js';
import { IntegrationStore } from '../integrations/integration-store.js';
import { smtpTarget } from '../integrations/providers/adapters.js';
import { BrandingService } from '../workspace/branding.service.js';
import { DevLogMailer, SmtpMailer, type MailAttachment, type Mailer, type MailMessage, type MailSendResult } from './mailer.js';
import { PlatformMailerService } from './platform-mailer.service.js';

export interface CompanySendOptions {
  attachments?: readonly MailAttachment[];
  cc?: readonly string[];
  /** Default: the company e-mail of the seller profile. */
  replyTo?: string | null;
  /** Shown as the sender name with the platform mailer (default: the company name). */
  senderName?: string | null;
  theme?: EmailLayoutTheme;
  override?: { subject: string; html: string };
  throwOnError?: boolean;
}

interface CompanyContext {
  name: string;
  brand: EmailBrand;
  values: Record<string, string>;
  email: string | null;
}

/**
 * COMPANY E-MAIL (change #20, D-074): company templates (saved override or default) rendered with the company
 * branding (logo, contrast-checked brand colour, address from the GST and billing profile) and sent through the
 * company's SMTP integration when it is connected (live), the development log mailer for a mock SMTP
 * integration, else the platform mailer with the company name as the sender and the company e-mail as reply-to.
 *
 * PROD-HUB (quotations, invoices, reminders, meeting invites):
 *   await companyEmail.sendTemplate(workspaceId, 'quotation_sent', to, { customerName, quotationNumber, amount, validUntil, link, senderName },
 *     { attachments: [{ filename: 'QT-2026-27-0012.pdf', content: pdf, contentType: 'application/pdf' }] });
 */
@Injectable()
export class CompanyEmailService {
  private readonly logger = new Logger(CompanyEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly integrations: IntegrationStore,
    private readonly platform: PlatformMailerService,
  ) {}

  async context(workspaceId: string, theme: EmailLayoutTheme = 'light'): Promise<CompanyContext> {
    const db = this.prisma.forTenant(workspaceId);
    const [ws, branding, sellerRow] = await Promise.all([
      db.workspace.findFirst({ select: { name: true } }),
      this.branding.get(db, workspaceId),
      db.setting.findFirst({ where: { scope: 'workspace', scopeId: workspaceId, key: SETTING_KEYS.workspace.sellerProfile }, select: { value: true } }),
    ]);
    const seller = sellerRow ? SellerProfileSchema.safeParse(sellerRow.value) : null;
    const s = seller?.success ? seller.data : null;
    const name = branding.displayName ?? s?.tradeName ?? s?.legalName ?? ws?.name ?? 'Your company';
    const a = s?.address;
    const address = a ? [a.line1, a.line2, a.city, [a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
    const colors = branding.colors;
    const logo = theme === 'dark' ? (branding.logoDark ?? branding.logoLight) : branding.logoLight;
    return {
      name,
      email: s?.email ?? null,
      brand: {
        name,
        logoUrl: logo?.url ?? null,
        brandColor: colors ? (theme === 'dark' ? colors.dark : colors.light) : null,
        brandTextColor: colors ? (theme === 'dark' ? colors.darkForeground : colors.lightForeground) : null,
        footerLines: [s?.legalName && s.legalName !== name ? s.legalName : null, address || null, [s?.phone, s?.email].filter(Boolean).join(' · ') || null, s?.gstin ? `GSTIN ${s.gstin}` : null].filter((l): l is string => !!l),
        links: s?.website ? [{ label: s.website.replace(/^https?:\/\//, ''), url: s.website }] : [],
      },
      values: { company: name, companyPhone: s?.phone ?? '', companyEmail: s?.email ?? '', companyAddress: address, companyWebsite: s?.website ?? '', year: String(new Date().getFullYear()) },
    };
  }

  async savedTemplate(workspaceId: string, key: CompanyEmailTemplateKey): Promise<{ subject: string; html: string } | null> {
    return this.prisma.forTenant(workspaceId).emailTemplate.findFirst({ where: { key }, select: { subject: true, html: true } });
  }

  async render(workspaceId: string, key: CompanyEmailTemplateKey, values: TemplateValues, opts: { override?: { subject: string; html: string }; theme?: EmailLayoutTheme } = {}): Promise<RenderedEmail> {
    const def = emailTemplateDefault('company', key)!;
    const ctx = await this.context(workspaceId, opts.theme);
    const tpl = opts.override ?? (await this.savedTemplate(workspaceId, key)) ?? { subject: def.subject, html: def.html };
    return renderEmail(tpl, { ...ctx.values, ...values }, { brand: ctx.brand, variables: emailTemplateVariables('company', key), theme: opts.theme });
  }

  /** The company SMTP integration as a mailer; null when not connected. */
  async companyMailer(workspaceId: string): Promise<Mailer | null> {
    const row = await this.integrations.row(workspaceId, 'smtp');
    if (!row || row.status === 'not_connected' || row.status === 'error') return null;
    const cfg = (row.config ?? {}) as Record<string, unknown>;
    const fromEmail = typeof cfg.fromEmail === 'string' ? cfg.fromEmail : null;
    if (!fromEmail) return null;
    const from = { name: typeof cfg.fromName === 'string' && cfg.fromName ? cfg.fromName : 'Sales', email: fromEmail };
    if (row.mode === 'mock') {
      if (getEnv().NODE_ENV === 'production') return null;
      return new DevLogMailer(from);
    }
    const host = typeof cfg.host === 'string' ? cfg.host : '';
    const target = await smtpTarget(host);
    const port = Number(cfg.port ?? 587);
    const secrets = this.integrations.secretsOf(row);
    return new SmtpMailer({
      host: target.host,
      servername: target.servername,
      port,
      tls: cfg.secure === true ? 'tls' : 'starttls',
      user: typeof cfg.username === 'string' && cfg.username ? cfg.username : null,
      password: secrets.password ?? null,
      from,
      kind: 'company_smtp',
    });
  }

  /** Company SMTP connected, or the platform mailer available (EMAIL_NOT_CONFIGURED when false). */
  async isConfigured(workspaceId: string): Promise<boolean> {
    if (this.platform.isConfigured()) return true;
    return (await this.companyMailer(workspaceId).catch(() => null)) !== null;
  }

  /** Send a message for a company: its SMTP, else the platform mailer with the company as the sender name. */
  async send(workspaceId: string, msg: MailMessage, opts: { throwOnError?: boolean; senderName?: string | null; tag?: string } = {}): Promise<MailSendResult> {
    let mailer: Mailer | null = null;
    try {
      mailer = await this.companyMailer(workspaceId);
    } catch {
      mailer = null; // SMTP host now resolves to a blocked address: fall back to the platform mailer
    }
    if (mailer) {
      const result = await mailer.send(msg).catch((): MailSendResult => ({ ok: false, messageId: null, message: 'The company SMTP server failed', via: 'company_smtp' }));
      if (!result.ok) {
        this.logger.warn(`Company e-mail ${opts.tag ?? ''} failed via ${result.via}: ${result.message}`.replace('  ', ' '));
        if (opts.throwOnError) throw new AppException('MAIL_SEND_FAILED', result.message);
      }
      return result;
    }
    const ctx = msg.from ? null : await this.context(workspaceId);
    const platformFrom = this.platform.mailer() ? { name: (opts.senderName ?? ctx?.name ?? 'Vistar').slice(0, 80), email: platformFromEmail() } : undefined;
    return this.platform.send({ ...msg, from: msg.from ?? platformFrom, replyTo: msg.replyTo ?? ctx?.email ?? undefined }, { throwOnError: opts.throwOnError, tag: opts.tag });
  }

  /** Render a company template and send it (see the class comment). */
  async sendTemplate(workspaceId: string, key: CompanyEmailTemplateKey, to: string | readonly string[], values: TemplateValues, opts: CompanySendOptions = {}): Promise<EmailSendResult> {
    try {
      const rendered = await this.render(workspaceId, key, values, { override: opts.override, theme: opts.theme });
      const r = await this.send(workspaceId, { to, cc: opts.cc, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: opts.replyTo ?? undefined, attachments: opts.attachments }, { throwOnError: opts.throwOnError, senderName: opts.senderName, tag: key });
      return { ok: r.ok, message: r.message, messageId: r.messageId, via: r.via };
    } catch (err) {
      if (opts.throwOnError) throw err;
      this.logger.error(`Company e-mail ${key} failed: ${(err as Error).name}`);
      return { ok: false, message: 'The e-mail could not be sent', messageId: null, via: null };
    }
  }
}

function platformFromEmail(): string {
  // The platform sender address (verified at the provider); the company name is the display name.
  return mailConfig()?.from.email ?? 'no-reply@vistar.local';
}
