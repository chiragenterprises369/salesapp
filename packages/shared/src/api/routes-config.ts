import { z } from 'zod';
import { IdParamSchema, OkResponseSchema } from '../schemas/common.js';
import {
  CompanyEmailTemplateParamSchema,
  ConfigAuditEntrySchema,
  ConfigGroupParamSchema,
  ConfigGroupSchema,
  ConfigGroupTestSchema,
  ConfigGroupUpdateSchema,
  ConfigRegistrySchema,
  ConfigTestResultSchema,
  DocumentDeliverSchema,
  DocumentDeliveryResultSchema,
  EmailPreviewSchema,
  EmailSendResultSchema,
  EmailTemplatePreviewSchema,
  EmailTemplateSchema,
  EmailTemplateSummarySchema,
  EmailTemplateTestSchema,
  EmailTemplateUpdateSchema,
  EmailVerificationStatusSchema,
  EmailVerifySchema,
  GoLiveChecklistSchema,
  PasswordForgotSchema,
  PasswordResetLookupQuerySchema,
  PasswordResetLookupSchema,
  PasswordResetSchema,
  PlatformEmailTemplateParamSchema,
  PublicPlatformInfoSchema,
  ReadyResponseSchema,
  RegistryGroupParamSchema,
  SetupBannerSchema,
  SetupChecklistSchema,
  SetupItemAckSchema,
  SetupItemParamSchema,
  SuperCompanyUserSchema,
  TlsAskQuerySchema,
  WhatsAppTemplateCreateSchema,
  WhatsAppTemplateListQuerySchema,
  WhatsAppTemplateSchema,
  WhatsAppTemplateSyncResultSchema,
  WhatsAppTemplateUpdateSchema,
} from '../schemas/config.js';
import type { RouteDef } from './routes.js';

/**
 * Change #20 routes (SPEC 30, D-073, D-074), owner backend-core = CONFIG-API stream. Spread into API_ROUTES.
 * Super Admin routes need `platform.system.manage`; company e-mail and WhatsApp templates use `templates.*`;
 * the setup checklist uses `settings.manage`.
 */
const route = <R extends RouteDef>(r: R) => r;
const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });
const SUPER = { tag: 'super-config', owner: 'backend-core', phase: 20, auth: 'super', permission: 'platform.system.manage', absolute: true } as const;
const COMPANY = { owner: 'backend-core', phase: 20, auth: 'jwt' } as const;

export const CONFIG_ROUTES = {
  // ---------------- Super Admin > Config: registry
  superConfigRegistry: route({ ...SUPER, method: 'get', path: '/api/super/config/registry', summary: 'Every config group with its fields (secrets masked), status (configured, missing, env fallback, dev default) and last test', response: ConfigRegistrySchema }),
  superConfigGroupGet: route({ ...SUPER, method: 'get', path: '/api/super/config/groups/{group}', summary: 'One config group (registry or card status)', params: ConfigGroupParamSchema, response: ConfigGroupSchema }),
  superConfigGroupUpdate: route({ ...SUPER, method: 'put', path: '/api/super/config/groups/{group}', summary: 'Save fields of a registry group (omitted = unchanged, null = clear; secrets write-only, encrypted); audited', params: RegistryGroupParamSchema, body: ConfigGroupUpdateSchema, response: ConfigGroupSchema }),
  superConfigGroupReset: route({ ...SUPER, method: 'delete', path: '/api/super/config/groups/{group}', summary: 'Clear every panel value of a registry group (env fallback and defaults apply again); audited', params: RegistryGroupParamSchema, response: ConfigGroupSchema }),
  superConfigGroupTest: route({ ...SUPER, method: 'post', path: '/api/super/config/groups/{group}/test', summary: 'Test a group with its saved values (send an e-mail, write a file, check credentials, send a Sentry event); audited', params: RegistryGroupParamSchema, body: ConfigGroupTestSchema, response: ConfigTestResultSchema }),
  superConfigGroupAudit: route({ ...SUPER, method: 'get', path: '/api/super/config/groups/{group}/audit', summary: 'Audit trail of a group (who changed which fields and when; never values), newest first, 50', params: ConfigGroupParamSchema, response: listOf(ConfigAuditEntrySchema) }),
  superGoLive: route({ ...SUPER, method: 'get', path: '/api/super/config/go-live', summary: 'Go-live checklist: production checks with pass, warn or fail and a link to fix each', response: GoLiveChecklistSchema }),

  // ---------------- Super Admin > Config: platform e-mail templates
  superEmailTemplateList: route({ ...SUPER, method: 'get', path: '/api/super/email-templates', summary: 'Platform e-mail templates (default or saved)', response: listOf(EmailTemplateSummarySchema) }),
  superEmailTemplateGet: route({ ...SUPER, method: 'get', path: '/api/super/email-templates/{key}', summary: 'One platform template with variables and the shipped default', params: PlatformEmailTemplateParamSchema, response: EmailTemplateSchema }),
  superEmailTemplateUpdate: route({ ...SUPER, method: 'put', path: '/api/super/email-templates/{key}', summary: 'Save subject and HTML body (unknown variables or a missing required one: 422 TEMPLATE_INVALID; markup sanitised); audited', params: PlatformEmailTemplateParamSchema, body: EmailTemplateUpdateSchema, response: EmailTemplateSchema }),
  superEmailTemplateReset: route({ ...SUPER, method: 'delete', path: '/api/super/email-templates/{key}', summary: 'Reset to the default shipped in code; audited', params: PlatformEmailTemplateParamSchema, response: EmailTemplateSchema }),
  superEmailTemplatePreview: route({ ...SUPER, method: 'post', path: '/api/super/email-templates/{key}/preview', summary: 'Render a draft or the saved template with sample data in the platform layout (light or dark)', params: PlatformEmailTemplateParamSchema, body: EmailTemplatePreviewSchema, response: EmailPreviewSchema }),
  superEmailTemplateTest: route({ ...SUPER, method: 'post', path: '/api/super/email-templates/{key}/test', summary: 'Send the template with sample data through the platform mailer (default: to the caller)', params: PlatformEmailTemplateParamSchema, body: EmailTemplateTestSchema, response: EmailSendResultSchema }),

  // ---------------- Company > Settings > E-mail templates
  emailTemplateList: route({ ...COMPANY, tag: 'templates', method: 'get', path: '/email-templates', summary: 'Company e-mail templates (default or saved)', permission: 'templates.read', response: listOf(EmailTemplateSummarySchema) }),
  emailTemplateGet: route({ ...COMPANY, tag: 'templates', method: 'get', path: '/email-templates/{key}', summary: 'One company e-mail template with variables and the default', permission: 'templates.read', params: CompanyEmailTemplateParamSchema, response: EmailTemplateSchema }),
  emailTemplateUpdate: route({ ...COMPANY, tag: 'templates', method: 'put', path: '/email-templates/{key}', summary: 'Save subject and HTML body (422 TEMPLATE_INVALID on unknown variables); audited; event email_template.updated', permission: 'templates.manage', params: CompanyEmailTemplateParamSchema, body: EmailTemplateUpdateSchema, response: EmailTemplateSchema }),
  emailTemplateReset: route({ ...COMPANY, tag: 'templates', method: 'delete', path: '/email-templates/{key}', summary: 'Reset to the default; audited', permission: 'templates.manage', params: CompanyEmailTemplateParamSchema, response: EmailTemplateSchema }),
  emailTemplatePreview: route({ ...COMPANY, tag: 'templates', method: 'post', path: '/email-templates/{key}/preview', summary: 'Render with sample data and the company branding (logo, brand colour, address)', permission: 'templates.read', params: CompanyEmailTemplateParamSchema, body: EmailTemplatePreviewSchema, response: EmailPreviewSchema }),
  emailTemplateTest: route({ ...COMPANY, tag: 'templates', method: 'post', path: '/email-templates/{key}/test', summary: 'Send with sample data to the caller (company SMTP when connected, else the platform mailer)', permission: 'templates.manage', params: CompanyEmailTemplateParamSchema, body: EmailTemplateTestSchema, response: EmailSendResultSchema }),

  // ---------------- Company > Settings > WhatsApp templates (Meta)
  whatsappTemplateList: route({ ...COMPANY, tag: 'templates', method: 'get', path: '/whatsapp-templates', summary: 'WhatsApp message templates with Meta status', permission: 'templates.read', query: WhatsAppTemplateListQuerySchema, response: listOf(WhatsAppTemplateSchema) }),
  whatsappTemplateCreate: route({ ...COMPANY, tag: 'templates', method: 'post', path: '/whatsapp-templates', summary: 'Create a draft (numbered variables with examples, header, footer, buttons); audited', permission: 'templates.manage', body: WhatsAppTemplateCreateSchema, response: WhatsAppTemplateSchema, status: 201 }),
  whatsappTemplateGet: route({ ...COMPANY, tag: 'templates', method: 'get', path: '/whatsapp-templates/{id}', summary: 'One WhatsApp template', permission: 'templates.read', params: IdParamSchema, response: WhatsAppTemplateSchema }),
  whatsappTemplateUpdate: route({ ...COMPANY, tag: 'templates', method: 'patch', path: '/whatsapp-templates/{id}', summary: 'Edit a draft or rejected template (409 TEMPLATE_STATE_INVALID otherwise)', permission: 'templates.manage', params: IdParamSchema, body: WhatsAppTemplateUpdateSchema, response: WhatsAppTemplateSchema }),
  whatsappTemplateDelete: route({ ...COMPANY, tag: 'templates', method: 'delete', path: '/whatsapp-templates/{id}', summary: 'Delete locally and at Meta (submitted templates); audited', permission: 'templates.manage', params: IdParamSchema, response: OkResponseSchema }),
  whatsappTemplateSubmit: route({ ...COMPANY, tag: 'templates', method: 'post', path: '/whatsapp-templates/{id}/submit', summary: 'Submit to Meta for review through the connected WhatsApp integration (mock in development) -> pending', permission: 'templates.manage', params: IdParamSchema, response: WhatsAppTemplateSchema }),
  whatsappTemplateSync: route({ ...COMPANY, tag: 'templates', method: 'post', path: '/whatsapp-templates/sync', summary: 'Pull statuses and templates from Meta (approved, rejected with reason, paused); templates made in Meta are added', permission: 'templates.manage', response: WhatsAppTemplateSyncResultSchema }),

  // ---------------- Company > Settings > Setup
  setupChecklist: route({ ...COMPANY, tag: 'settings', method: 'get', path: '/setup', summary: 'Setup checklist computed from the workspace (status, link, detail) and the completion percentage', permission: 'settings.manage', response: SetupChecklistSchema }),
  setupItemAcknowledge: route({ ...COMPANY, tag: 'settings', method: 'put', path: '/setup/items/{key}', summary: 'Tick or untick an item that cannot be detected (roles reviewed, hours, e-mail templates, Android app)', permission: 'settings.manage', params: SetupItemParamSchema, body: SetupItemAckSchema, response: SetupChecklistSchema }),
  setupBanner: route({ ...COMPANY, tag: 'settings', method: 'put', path: '/setup/banner', summary: 'Dismiss or restore the dashboard setup banner for the caller', permission: 'settings.manage', body: SetupBannerSchema, response: SetupChecklistSchema }),

  // ---------------- auth: password reset and e-mail verification
  authPasswordForgot: route({ ...COMPANY, tag: 'auth', method: 'post', path: '/auth/password/forgot', summary: 'Send a password reset link (always 200, no account enumeration; rate limited)', auth: 'public', permission: null, body: PasswordForgotSchema, response: OkResponseSchema }),
  authPasswordResetLookup: route({ ...COMPANY, tag: 'auth', method: 'get', path: '/auth/password/reset', summary: 'Check a reset link before showing the form', auth: 'public', permission: null, query: PasswordResetLookupQuerySchema, response: PasswordResetLookupSchema }),
  authPasswordReset: route({ ...COMPANY, tag: 'auth', method: 'post', path: '/auth/password/reset', summary: 'Set a new password with a reset link (one use; signs out every session); 400 AUTH_LINK_INVALID', auth: 'public', permission: null, body: PasswordResetSchema, response: OkResponseSchema }),
  authEmailVerify: route({ ...COMPANY, tag: 'auth', method: 'post', path: '/auth/email/verify', summary: 'Confirm an e-mail address with the link from the verification e-mail; 400 AUTH_LINK_INVALID', auth: 'public', permission: null, body: EmailVerifySchema, response: OkResponseSchema }),
  myEmailVerification: route({ ...COMPANY, tag: 'auth', method: 'get', path: '/me/email/verification', summary: 'Whether the caller\'s e-mail is verified', permission: null, response: EmailVerificationStatusSchema }),
  myEmailVerificationSend: route({ ...COMPANY, tag: 'auth', method: 'post', path: '/me/email/verification', summary: 'Send a new verification link to the caller (rate limited)', permission: null, response: EmailVerificationStatusSchema }),

  // ---------------- public
  publicPlatformInfo: route({ ...COMPANY, tag: 'public', method: 'get', path: '/public/platform', summary: 'Vistar product name, support contacts, legal links, password rule, web monitoring DSN, Google sign-in availability (no secrets)', auth: 'public', permission: null, response: PublicPlatformInfoSchema }),

  // ================ change #20b: contract addendum (requests-20). Handlers: P1 to P4 PROD-HUB, 1 and 4 CONFIG-API.
  // ---------------- P1: send quotations and invoices by e-mail (PDF attached) or WhatsApp (share link)
  quotationDeliver: route({ ...COMPANY, tag: 'quotations', method: 'post', path: '/quotations/{id}/deliver', summary: 'Send a quotation by e-mail (company template quotation_sent, PDF attached, company SMTP or the platform mailer) or WhatsApp (approved template with the share link); a draft is marked sent first (same rules as quotationSend); recorded on the timeline; 422 EMAIL_NOT_CONFIGURED', permission: 'quotations.send', params: IdParamSchema, body: DocumentDeliverSchema, response: DocumentDeliveryResultSchema }),
  invoiceDeliver: route({ ...COMPANY, tag: 'invoices', method: 'post', path: '/invoices/{id}/deliver', summary: 'Send an invoice by e-mail (company template invoice_sent, PDF attached) or WhatsApp (approved template with the share link); a draft is issued first (same rules as invoiceSend); recorded on the timeline; 422 EMAIL_NOT_CONFIGURED', permission: 'invoices.issue', params: IdParamSchema, body: DocumentDeliverSchema, response: DocumentDeliveryResultSchema }),
  // ---------------- P2, P3, P4: production probes and receivers (absolute; one path segment under /api/hooks)
  ready: route({ ...COMPANY, tag: 'system', method: 'get', path: '/api/ready', absolute: true, summary: 'Readiness: database, Redis and storage reachable and not draining; 200 when ok, 503 with the same body otherwise (health stays the liveness check)', auth: 'public', permission: null, response: ReadyResponseSchema }),
  tlsAsk: route({ ...COMPANY, tag: 'system', method: 'get', path: '/api/tls/ask', absolute: true, summary: 'Caddy on-demand TLS ask: 200 when the host may get a certificate (verified custom domain of a company with the custom_domain switch on, or the WEB_ORIGIN / API_PUBLIC_URL host), 404 otherwise; internal network only (the Caddyfile blocks it from outside)', auth: 'public', permission: null, query: TlsAskQuerySchema, response: null }),
  googleCalendarWebhook: route({ ...COMPANY, tag: 'webhooks', method: 'post', path: '/api/hooks/google-calendar', absolute: true, summary: 'Google Calendar push notifications of watch channels (X-Goog-Channel-ID, X-Goog-Channel-Token = per-workspace HMAC, X-Goog-Resource-State); triggers an incremental sync', auth: 'webhook', permission: null, body: z.unknown(), response: null, status: 200 }),
  // ---------------- requests 1 and 4: Super Admin company detail (users tab, setup progress)
  superCompanyUsers: route({ ...SUPER, tag: 'super', method: 'get', path: '/api/super/companies/{id}/users', summary: 'Users of a company: name, e-mail, role, active, last active, devices (no phone numbers)', permission: 'platform.companies.read', params: IdParamSchema, response: listOf(SuperCompanyUserSchema) }),
  superCompanySetup: route({ ...SUPER, tag: 'super', method: 'get', path: '/api/super/companies/{id}/setup', summary: 'Setup checklist of a company (same schema as GET /setup; bannerDismissed is always false)', permission: 'platform.companies.read', params: IdParamSchema, response: SetupChecklistSchema }),
  // ================ end change #20b
} as const satisfies Record<string, RouteDef>;
