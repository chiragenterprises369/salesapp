import { Injectable, Logger } from '@nestjs/common';
import {
  emailTemplateDefault,
  emailTemplateVariables,
  renderEmail,
  type EmailBrand,
  type EmailLayoutTheme,
  type PlatformEmailTemplateKey,
  type RenderedEmail,
  type TemplateValues,
} from '@vistar/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { mailConfig, platformBranding, platformConfig } from '../config-registry/snapshot.js';
import { createPlatformMailer, DevLogMailer, type MailAttachment, type Mailer, type MailMessage, type MailSendResult } from './mailer.js';

const TEMPLATE_CACHE_MS = 30_000;

export interface SendTemplateOptions {
  /** Test sends: throw MAIL_SEND_FAILED / CONFIG_MISSING instead of returning ok=false. */
  throwOnError?: boolean;
  replyTo?: string | null;
  attachments?: readonly MailAttachment[];
  theme?: EmailLayoutTheme;
  /** Render a draft instead of the saved template (test send from the editor). */
  override?: { subject: string; html: string };
}

/**
 * PLATFORM MAILER (change #20, D-074): Super Admin > Config > Platform email, the platform templates (saved
 * override or the default in code) and the platform branding layout. Used for invites, password reset, e-mail
 * verification, Super Admin login alerts, Vistar billing, webhook and integration alerts.
 *
 *   await mailer.sendTemplate('invite', email, { name, inviterName, workspace, role, link, expiresAt });
 *
 * Background sends never throw (they log the template key and the result only). Production without a configured
 * mailer refuses (CONFIG_MISSING); development without one logs the message instead of sending (DevLogMailer).
 */
@Injectable()
export class PlatformMailerService {
  private readonly logger = new Logger(PlatformMailerService.name);
  private cached: { at: number; mailer: Mailer | null } | null = null;
  private templates = new Map<string, { at: number; row: { subject: string; html: string } | null }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Current platform mailer; null in production when not configured. Rebuilt when the config snapshot changes. */
  mailer(): Mailer | null {
    const at = platformConfig().loadedAt;
    if (this.cached?.at === at) return this.cached.mailer;
    const cfg = mailConfig();
    let mailer = createPlatformMailer(cfg);
    if (!mailer && getEnv().NODE_ENV !== 'production') mailer = new DevLogMailer({ name: platformBranding().productName, email: 'no-reply@vistar.local' });
    this.cached = { at, mailer };
    return mailer;
  }

  /** Forget cached template overrides (after a save or reset). */
  invalidateTemplate(key: string): void {
    this.templates.delete(key);
  }

  async savedTemplate(key: PlatformEmailTemplateKey): Promise<{ subject: string; html: string } | null> {
    const hit = this.templates.get(key);
    if (hit && Date.now() - hit.at < TEMPLATE_CACHE_MS) return hit.row;
    const row = await this.prisma.platformEmailTemplate.findUnique({ where: { key }, select: { subject: true, html: true } });
    this.templates.set(key, { at: Date.now(), row });
    return row;
  }

  brand(): EmailBrand {
    const b = platformBranding();
    const links = [b.websiteUrl && { label: b.productName, url: b.websiteUrl }, b.termsUrl && { label: 'Terms', url: b.termsUrl }, b.privacyUrl && { label: 'Privacy', url: b.privacyUrl }].filter((l): l is { label: string; url: string } => !!l);
    const footerLines = [b.emailFooter, b.supportEmail ? `Need help? Write to ${b.supportEmail}${b.supportPhone ? ` or call ${b.supportPhone}` : ''}` : null].filter((l): l is string => !!l);
    return { name: b.productName, footerLines, links };
  }

  commonValues(): Record<string, string> {
    const b = platformBranding();
    return { productName: b.productName, supportEmail: b.supportEmail ?? '', appUrl: getEnv().WEB_ORIGIN, year: String(new Date().getFullYear()) };
  }

  async render(key: PlatformEmailTemplateKey, values: TemplateValues, opts: { override?: { subject: string; html: string }; theme?: EmailLayoutTheme } = {}): Promise<RenderedEmail> {
    const def = emailTemplateDefault('platform', key)!;
    const tpl = opts.override ?? (await this.savedTemplate(key)) ?? { subject: def.subject, html: def.html };
    return renderEmail(tpl, { ...this.commonValues(), ...values }, { brand: this.brand(), variables: emailTemplateVariables('platform', key), theme: opts.theme });
  }

  /** Send any message through the platform mailer. */
  async send(msg: MailMessage, opts: { throwOnError?: boolean; tag?: string } = {}): Promise<MailSendResult> {
    const mailer = this.mailer();
    if (!mailer) {
      if (opts.throwOnError) throw new AppException('CONFIG_MISSING', 'Platform email is not configured: Super Admin > Config > Platform email');
      this.logger.warn(`E-mail ${opts.tag ?? ''} skipped: platform email is not configured`.replace('  ', ' '));
      return { ok: false, messageId: null, message: 'Platform email is not configured', via: 'smtp' };
    }
    let result: MailSendResult;
    try {
      result = await mailer.send(msg);
    } catch {
      result = { ok: false, messageId: null, message: 'The mailer failed', via: mailer.kind };
    }
    if (!result.ok) {
      this.logger.warn(`E-mail ${opts.tag ?? ''} failed via ${result.via}: ${result.message}`.replace('  ', ' '));
      if (opts.throwOnError) throw new AppException('MAIL_SEND_FAILED', result.message);
    }
    return result;
  }

  /** Render a platform template and send it. Never throws unless `throwOnError`. */
  async sendTemplate(key: PlatformEmailTemplateKey, to: string | readonly string[], values: TemplateValues, opts: SendTemplateOptions = {}): Promise<MailSendResult> {
    try {
      const rendered = await this.render(key, values, { override: opts.override, theme: opts.theme });
      return await this.send({ to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: opts.replyTo ?? undefined, attachments: opts.attachments }, { throwOnError: opts.throwOnError, tag: key });
    } catch (err) {
      if (opts.throwOnError) throw err;
      this.logger.error(`E-mail ${key} failed: ${(err as Error).name}`);
      return { ok: false, messageId: null, message: 'The e-mail could not be built', via: 'smtp' };
    }
  }

  /**
   * Send a template to users of a company, one message each (names differ). `who`: company admins, or users whose
   * role holds a permission (billing.manage for Vistar billing e-mails).
   */
  async sendToCompanyUsers(workspaceId: string, who: { kind: 'company_admins' } | { kind: 'permission'; permission: string }, key: PlatformEmailTemplateKey, values: TemplateValues): Promise<void> {
    try {
      const db = this.prisma.forTenant(workspaceId);
      const users = await db.user.findMany({
        where: { isActive: true, deletedAt: null, role: who.kind === 'company_admins' ? { kind: 'company_admin' } : { permissions: { has: who.permission } } },
        select: { email: true, name: true },
        take: 20,
      });
      const ws = await db.workspace.findFirst({ select: { name: true } });
      for (const u of users) await this.sendTemplate(key, u.email, { workspace: ws?.name ?? '', ...values, name: u.name });
    } catch (err) {
      this.logger.error(`E-mail ${key} to company users failed: ${(err as Error).name}`);
    }
  }

  /** Absolute web URL for a path ("/app/billing" -> "https://app.example.com/app/billing"). */
  webUrl(path: string): string {
    return `${getEnv().WEB_ORIGIN.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }
}
