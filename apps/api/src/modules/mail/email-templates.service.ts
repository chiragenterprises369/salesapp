import { Injectable, Logger } from '@nestjs/common';
import {
  checkEmailTemplate,
  COMPANY_EMAIL_TEMPLATE_KEYS,
  emailTemplateDefault,
  emailTemplateVariables,
  htmlToText,
  PLATFORM_EMAIL_TEMPLATE_KEYS,
  renderHtmlFragment,
  sampleVariables,
  sanitizeEmailHtml,
  type CompanyEmailTemplateKey,
  type EmailPreview,
  type EmailSendResult,
  type EmailTemplate,
  type EmailTemplatePreview,
  type EmailTemplateScope,
  type EmailTemplateSummary,
  type EmailTemplateTest,
  type EmailTemplateUpdate,
  type PlatformEmailTemplateKey,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext, PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, requestActor } from '../leads/lib/context.js';
import { CompanyEmailService } from './company-email.service.js';
import { PlatformMailerService } from './platform-mailer.service.js';

interface Row {
  subject: string;
  html: string;
  updatedAt: Date;
  updatedById: string | null;
}

/** 422 TEMPLATE_INVALID when a template uses unknown variables or misses a required one. */
function assertValid(scope: EmailTemplateScope, key: string, body: EmailTemplateUpdate): string {
  const p = checkEmailTemplate(scope, key, body.subject, body.html);
  const details = [
    ...p.unknownVariables.map((v) => ({ path: 'html', message: `Unknown variable {{${v}}}` })),
    ...p.missingRequired.map((v) => ({ path: 'html', message: `Add {{${v}}}: this e-mail needs it` })),
  ];
  if (details.length) throw new AppException('TEMPLATE_INVALID', details[0]!.message, { details });
  return sanitizeEmailHtml(body.html);
}

/**
 * E-MAIL TEMPLATES (change #20, D-074): platform templates (Super Admin) and company templates (Company >
 * Settings). Overrides only; defaults ship in @vistar/shared. Preview renders the full branded layout; test sends
 * use sample values (or the editor's draft) and go to the caller unless `to` is given.
 */
@Injectable()
export class EmailTemplatesService {
  private readonly logger = new Logger(EmailTemplatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly platform: PlatformMailerService,
    private readonly company: CompanyEmailService,
  ) {}

  private dto(scope: EmailTemplateScope, key: string, row: Row | null, name: string | null): EmailTemplate {
    const def = emailTemplateDefault(scope, key)!;
    const subject = row?.subject ?? def.subject;
    const html = row?.html ?? def.html;
    const sample = renderHtmlFragment(html, sampleVariables(scope, key), emailTemplateVariables(scope, key));
    return {
      key,
      scope,
      label: def.label,
      description: def.description,
      subject,
      html,
      text: htmlToText(sample),
      variables: emailTemplateVariables(scope, key),
      isCustom: !!row,
      defaultSubject: def.subject,
      defaultHtml: def.html,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedById ? { id: row.updatedById, name: name ?? 'Unknown' } : null,
    };
  }

  private summary(t: EmailTemplate): EmailTemplateSummary {
    return { key: t.key, scope: t.scope, label: t.label, description: t.description, subject: t.subject, isCustom: t.isCustom, updatedAt: t.updatedAt };
  }

  private preview(scope: EmailTemplateScope, key: string, saved: { subject: string; html: string }, body: EmailTemplatePreview, render: (tpl: { subject: string; html: string }, values: Record<string, string>) => Promise<{ subject: string; html: string; text: string }>): Promise<EmailPreview> {
    const tpl = { subject: body.subject ?? saved.subject, html: body.html ?? saved.html };
    const problems = checkEmailTemplate(scope, key, tpl.subject, tpl.html);
    return render(tpl, { ...sampleVariables(scope, key), ...(body.values ?? {}) }).then((r) => ({ ...r, unknownVariables: problems.unknownVariables, missingRequired: problems.missingRequired, unsafeMarkupRemoved: problems.unsafeMarkup }));
  }

  // ---------------------------------------------------------------- platform

  private async platformRow(key: PlatformEmailTemplateKey): Promise<{ row: Row | null; name: string | null }> {
    const row = await this.prisma.platformEmailTemplate.findUnique({ where: { key } });
    const name = row?.updatedById ? ((await this.prisma.platformAdmin.findUnique({ where: { id: row.updatedById }, select: { name: true } }))?.name ?? null) : null;
    return { row, name };
  }

  async platformList(): Promise<{ items: EmailTemplateSummary[] }> {
    const rows = await this.prisma.platformEmailTemplate.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return { items: PLATFORM_EMAIL_TEMPLATE_KEYS.map((k) => this.summary(this.dto('platform', k, byKey.get(k) ?? null, null))) };
  }

  async platformGet(key: PlatformEmailTemplateKey): Promise<EmailTemplate> {
    const { row, name } = await this.platformRow(key);
    return this.dto('platform', key, row, name);
  }

  async platformUpdate(admin: PlatformAuthContext, req: Request, key: PlatformEmailTemplateKey, body: EmailTemplateUpdate): Promise<EmailTemplate> {
    const html = assertValid('platform', key, body);
    await this.prisma.platformEmailTemplate.upsert({ where: { key }, create: { key, subject: body.subject, html, updatedById: admin.adminId }, update: { subject: body.subject, html, updatedById: admin.adminId } });
    this.platform.invalidateTemplate(key);
    await this.audit.platform(admin, req, { action: 'config.email_template.update', entityType: 'platform_email_template', entityId: key, diff: { subjectLength: body.subject.length, htmlLength: html.length } });
    return this.platformGet(key);
  }

  async platformReset(admin: PlatformAuthContext, req: Request, key: PlatformEmailTemplateKey): Promise<EmailTemplate> {
    const { count } = await this.prisma.platformEmailTemplate.deleteMany({ where: { key } });
    this.platform.invalidateTemplate(key);
    if (count) await this.audit.platform(admin, req, { action: 'config.email_template.reset', entityType: 'platform_email_template', entityId: key });
    return this.platformGet(key);
  }

  async platformPreview(key: PlatformEmailTemplateKey, body: EmailTemplatePreview): Promise<EmailPreview> {
    const saved = await this.platformGet(key);
    return this.preview('platform', key, saved, body, (tpl, values) => this.platform.render(key, values, { override: tpl, theme: body.theme }));
  }

  async platformTest(admin: PlatformAuthContext, key: PlatformEmailTemplateKey, body: EmailTemplateTest): Promise<EmailSendResult> {
    if (!this.platform.mailer()) throw new AppException('CONFIG_MISSING', 'Platform email is not configured: Super Admin > Config > Platform email');
    const to = body.to ?? (await this.prisma.platformAdmin.findUnique({ where: { id: admin.adminId }, select: { email: true } }))?.email;
    if (!to) throw new AppException('VALIDATION_FAILED', 'Enter the recipient', { details: [{ path: 'to', message: 'Required' }] });
    const saved = await this.platformGet(key);
    const override = { subject: body.subject ?? saved.subject, html: sanitizeEmailHtml(body.html ?? saved.html) };
    const r = await this.platform.sendTemplate(key, to, sampleVariables('platform', key), { override });
    return { ok: r.ok, message: r.ok ? `Sent to ${to}` : r.message, messageId: r.messageId, via: r.via };
  }

  // ---------------------------------------------------------------- company

  private async companyRow(auth: AuthContext, key: CompanyEmailTemplateKey): Promise<{ row: Row | null; name: string | null }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.emailTemplate.findFirst({ where: { key } });
    const name = row?.updatedById ? ((await db.user.findFirst({ where: { id: row.updatedById }, select: { name: true } }))?.name ?? null) : null;
    return { row, name };
  }

  async companyList(auth: AuthContext): Promise<{ items: EmailTemplateSummary[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).emailTemplate.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return { items: COMPANY_EMAIL_TEMPLATE_KEYS.map((k) => this.summary(this.dto('company', k, byKey.get(k) ?? null, null))) };
  }

  async companyGet(auth: AuthContext, key: CompanyEmailTemplateKey): Promise<EmailTemplate> {
    const { row, name } = await this.companyRow(auth, key);
    return this.dto('company', key, row, name);
  }

  async companyUpdate(auth: AuthContext, req: Request, key: CompanyEmailTemplateKey, body: EmailTemplateUpdate): Promise<EmailTemplate> {
    const html = assertValid('company', key, body);
    const db = this.prisma.forTenant(auth.workspaceId);
    await db.emailTemplate.upsert({
      where: { workspaceId_key: { workspaceId: auth.workspaceId, key } },
      create: { workspaceId: auth.workspaceId, key, subject: body.subject, html, updatedById: auth.userId },
      update: { subject: body.subject, html, updatedById: auth.userId },
    });
    await this.audit.record(auth, req, { action: 'email_template.update', entityType: 'email_template', entityId: key, diff: { subjectLength: body.subject.length, htmlLength: html.length } });
    await publishSafe(this.events, this.logger, 'email_template.updated', auth.workspaceId, { key, isCustom: true }, { actor: (await requestActor(this.prisma.forTenant(auth.workspaceId), auth)).event });
    return this.companyGet(auth, key);
  }

  async companyReset(auth: AuthContext, req: Request, key: CompanyEmailTemplateKey): Promise<EmailTemplate> {
    const { count } = await this.prisma.forTenant(auth.workspaceId).emailTemplate.deleteMany({ where: { key } });
    if (count) {
      await this.audit.record(auth, req, { action: 'email_template.reset', entityType: 'email_template', entityId: key });
      await publishSafe(this.events, this.logger, 'email_template.updated', auth.workspaceId, { key, isCustom: false }, { actor: (await requestActor(this.prisma.forTenant(auth.workspaceId), auth)).event });
    }
    return this.companyGet(auth, key);
  }

  async companyPreview(auth: AuthContext, key: CompanyEmailTemplateKey, body: EmailTemplatePreview): Promise<EmailPreview> {
    const saved = await this.companyGet(auth, key);
    return this.preview('company', key, saved, body, (tpl, values) => this.company.render(auth.workspaceId, key, values, { override: tpl, theme: body.theme }));
  }

  async companyTest(auth: AuthContext, key: CompanyEmailTemplateKey, body: EmailTemplateTest): Promise<EmailSendResult> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const to = body.to ?? (auth.userId ? (await db.user.findFirst({ where: { id: auth.userId }, select: { email: true } }))?.email : undefined);
    if (!to) throw new AppException('VALIDATION_FAILED', 'Enter the recipient', { details: [{ path: 'to', message: 'Required' }] });
    const saved = await this.companyGet(auth, key);
    const override = { subject: body.subject ?? saved.subject, html: sanitizeEmailHtml(body.html ?? saved.html) };
    const r = await this.company.sendTemplate(auth.workspaceId, key, to, sampleVariables('company', key), { override });
    return { ...r, message: r.ok ? `Sent to ${to}` : r.message };
  }
}
