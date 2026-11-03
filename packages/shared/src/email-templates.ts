import { z } from 'zod';

/**
 * E-MAIL TEMPLATES (change #20, SPEC 30, D-074): one engine for platform templates (Super Admin > Config) and
 * company templates (Company > Settings > E-mail templates). Defaults ship in code; a saved template overrides
 * the default for its key; "reset to default" deletes the override.
 *
 * Syntax: `{{variable}}` (letters, digits, underscore; spaces inside the braces allowed). Every value is
 * HTML-escaped in the body and stripped of line breaks in the subject. There is no raw-HTML syntax. Unknown
 * variables are rejected on save (TEMPLATE_INVALID) and render as empty text. URL variables (`kind: 'url'`)
 * only accept http(s) values ("#" otherwise). `<a class="button">` gets the brand button style.
 *
 * The body is a fragment; `renderEmail()` wraps it in the branded layout and derives the plain-text part.
 * Stored HTML is sanitised (no script, iframe, object, embed, form, style, event handlers or javascript: URLs).
 * The web preview must still render inside a sandboxed iframe (`<iframe sandbox="" srcdoc=...>`).
 */

export const PLATFORM_EMAIL_TEMPLATE_KEYS = [
  'invite',
  'password_reset',
  'email_verify',
  'super_admin_login_alert',
  'trial_ending',
  'invoice_issued',
  'payment_received',
  'payment_failed',
  'plan_change_approved',
  'webhook_disabled',
  'integration_error',
] as const;
export const PlatformEmailTemplateKeySchema = z.enum(PLATFORM_EMAIL_TEMPLATE_KEYS);
export type PlatformEmailTemplateKey = z.infer<typeof PlatformEmailTemplateKeySchema>;

export const COMPANY_EMAIL_TEMPLATE_KEYS = ['quotation_sent', 'invoice_sent', 'payment_reminder', 'follow_up', 'meeting_invite', 'welcome_lead'] as const;
export const CompanyEmailTemplateKeySchema = z.enum(COMPANY_EMAIL_TEMPLATE_KEYS);
export type CompanyEmailTemplateKey = z.infer<typeof CompanyEmailTemplateKeySchema>;

export type EmailTemplateScope = 'platform' | 'company';

export const EMAIL_VARIABLE_KINDS = ['text', 'url', 'date', 'money'] as const;
export const EmailTemplateVariableSchema = z.object({
  name: z.string(),
  label: z.string(),
  kind: z.enum(EMAIL_VARIABLE_KINDS),
  sample: z.string(),
  /** The template must use this variable (e.g. the link of an invite). */
  required: z.boolean(),
});
export type EmailTemplateVariable = z.infer<typeof EmailTemplateVariableSchema>;

export interface EmailTemplateDefault {
  readonly label: string;
  readonly description: string;
  readonly subject: string;
  readonly html: string;
  readonly variables: readonly EmailTemplateVariable[];
}

const v = (name: string, label: string, sample: string, kind: EmailTemplateVariable['kind'] = 'text', required = false): EmailTemplateVariable => ({ name, label, kind, sample, required });

/** Always available in platform templates. */
export const PLATFORM_COMMON_VARIABLES: readonly EmailTemplateVariable[] = [
  v('productName', 'Product name', 'Vistar'),
  v('supportEmail', 'Support e-mail', 'support@vistar.app'),
  v('appUrl', 'Web app URL', 'https://app.vistar.app', 'url'),
  v('year', 'Current year', '2026'),
];

/** Always available in company templates. */
export const COMPANY_COMMON_VARIABLES: readonly EmailTemplateVariable[] = [
  v('company', 'Company name', 'Shakti Traders'),
  v('companyPhone', 'Company phone', '+91 98765 43210'),
  v('companyEmail', 'Company e-mail', 'sales@shaktitraders.in'),
  v('companyAddress', 'Company address', 'MIDC Bhosari, Pune 411026'),
  v('companyWebsite', 'Company website', 'https://shaktitraders.in', 'url'),
  v('year', 'Current year', '2026'),
];

const p = (text: string) => `<p>${text}</p>`;
const button = (label: string, link = '{{link}}') => `<p><a class="button" href="${link}">${label}</a></p>`;

export const PLATFORM_EMAIL_DEFAULTS: Record<PlatformEmailTemplateKey, EmailTemplateDefault> = {
  invite: {
    label: 'Team invite',
    description: 'Sent when a company admin invites a member by e-mail, and to the first admin of a company created by the Super Admin.',
    subject: '{{inviterName}} invited you to {{workspace}} on {{productName}}',
    html: [p('Hi {{name}},'), p('{{inviterName}} invited you to join <strong>{{workspace}}</strong> on {{productName}} as {{role}}.'), button('Accept the invite'), p('This invite expires on {{expiresAt}}. If you did not expect it, ignore this e-mail.')].join('\n'),
    variables: [v('name', 'Invitee name or e-mail', 'Priya'), v('inviterName', 'Who invited', 'Rahul Mehta'), v('workspace', 'Company', 'Shakti Traders'), v('role', 'Role', 'Manager'), v('link', 'Invite link', 'https://app.vistar.app/invite/abc123', 'url', true), v('expiresAt', 'Expiry date', '10 Nov 2026', 'date')],
  },
  password_reset: {
    label: 'Password reset',
    description: 'Sent when someone asks to reset their password. The link works once.',
    subject: 'Reset your {{productName}} password',
    html: [p('Hi {{name}},'), p('We received a request to reset the password of your {{productName}} account.'), button('Choose a new password'), p('The link works once and expires in {{expiresInMinutes}} minutes. If you did not ask for this, ignore this e-mail; your password stays the same.')].join('\n'),
    variables: [v('name', 'Name', 'Priya'), v('link', 'Reset link', 'https://app.vistar.app/reset-password?token=abc123', 'url', true), v('expiresInMinutes', 'Link lifetime (minutes)', '60'), v('ip', 'Requested from (IP)', '203.0.113.7')],
  },
  email_verify: {
    label: 'E-mail verification',
    description: 'Sent after sign-up and when a user asks for a new verification link.',
    subject: 'Confirm your e-mail for {{productName}}',
    html: [p('Hi {{name}},'), p('Confirm that this is your e-mail address to finish setting up {{workspace}} on {{productName}}.'), button('Confirm e-mail'), p('The link expires in 24 hours.')].join('\n'),
    variables: [v('name', 'Name', 'Priya'), v('workspace', 'Company', 'Shakti Traders'), v('link', 'Verification link', 'https://app.vistar.app/verify-email?token=abc123', 'url', true)],
  },
  super_admin_login_alert: {
    label: 'Super Admin login alert',
    description: 'Sent to a Super Admin after each successful sign-in (password and 2FA).',
    subject: 'New Super Admin sign-in to {{productName}}',
    html: [p('Hi {{name}},'), p('Your Super Admin account signed in on {{time}} from {{ip}} ({{userAgent}}).'), p('If this was not you, sign in, revoke your sessions and change your password at once, then contact the other Super Admins.')].join('\n'),
    variables: [v('name', 'Admin name', 'Anita'), v('time', 'Sign-in time', '03 Nov 2026, 10:42 IST', 'date'), v('ip', 'IP address', '203.0.113.7'), v('userAgent', 'Browser', 'Chrome on Windows')],
  },
  trial_ending: {
    label: 'Trial ending',
    description: 'Sent to billing admins before the trial ends (7, 3 and 1 days).',
    subject: 'Your {{productName}} trial ends in {{daysLeft}} days',
    html: [p('Hi {{name}},'), p('The trial of <strong>{{workspace}}</strong> ends on {{trialEndsAt}}. {{priceNote}}'), button('Review your plan')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('plan', 'Plan', 'Growth'), v('trialEndsAt', 'Trial end date', '10 Nov 2026', 'date'), v('daysLeft', 'Days left', '3'), v('priceNote', 'Price after the trial', 'The Growth plan then costs ₹4,999 a month plus GST.'), v('link', 'Billing page link', 'https://app.vistar.app/app/billing', 'url')],
  },
  invoice_issued: {
    label: 'Invoice issued',
    description: 'Sent to billing admins when a Vistar invoice is issued.',
    subject: 'Invoice {{invoiceNumber}} from {{productName}}',
    html: [p('Hi {{name}},'), p('Invoice <strong>{{invoiceNumber}}</strong> for {{workspace}} is ready: {{amount}}, due on {{dueDate}}.'), button('View and pay')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('invoiceNumber', 'Invoice number', 'VST/2026-27/0042'), v('amount', 'Amount', '₹5,899', 'money'), v('dueDate', 'Due date', '10 Nov 2026', 'date'), v('link', 'Invoice link', 'https://app.vistar.app/app/billing?invoice=1', 'url')],
  },
  payment_received: {
    label: 'Payment received',
    description: 'Sent to billing admins when a Vistar invoice is paid (online or marked paid).',
    subject: 'Payment received for {{invoiceNumber}}',
    html: [p('Hi {{name}},'), p('We received {{amount}} for invoice <strong>{{invoiceNumber}}</strong> on {{paidAt}}. Thank you.'), button('Download the invoice')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('invoiceNumber', 'Invoice number', 'VST/2026-27/0042'), v('amount', 'Amount', '₹5,899', 'money'), v('paidAt', 'Paid on', '03 Nov 2026', 'date'), v('link', 'Invoice link', 'https://app.vistar.app/app/billing?invoice=1', 'url')],
  },
  payment_failed: {
    label: 'Payment failed or overdue',
    description: 'Sent to billing admins when a payment fails, an invoice is overdue, or the subscription is cancelled for non-payment.',
    subject: '{{title}}',
    html: [p('Hi {{name}},'), p('{{message}}'), button('Pay now')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('title', 'Subject line', 'Payment failed: invoice VST/2026-27/0042'), v('message', 'Details', '₹5,899: the card was declined. Try again from Billing.'), v('invoiceNumber', 'Invoice number', 'VST/2026-27/0042'), v('amount', 'Amount', '₹5,899', 'money'), v('link', 'Billing link', 'https://app.vistar.app/app/billing', 'url')],
  },
  plan_change_approved: {
    label: 'Plan change approved',
    description: 'Sent to billing admins when the Super Admin approves a plan change request.',
    subject: 'Your {{productName}} plan change was approved',
    html: [p('Hi {{name}},'), p('<strong>{{workspace}}</strong> moves to the {{plan}} plan {{effective}}.'), button('Open billing')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('plan', 'New plan', 'Growth'), v('effective', 'When', 'now'), v('link', 'Billing link', 'https://app.vistar.app/app/billing', 'url')],
  },
  webhook_disabled: {
    label: 'Webhook switched off',
    description: 'Sent to company admins when an outbound webhook endpoint is switched off after repeated failures.',
    subject: 'A webhook of {{workspace}} was switched off',
    html: [p('Hi {{name}},'), p('Vistar switched off the webhook to <strong>{{endpointUrl}}</strong> after {{failures}} failed deliveries in a row. Fix the receiver, then switch the endpoint on again.'), button('Open webhooks')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('endpointUrl', 'Endpoint URL', 'https://erp.example.com/hooks/vistar'), v('failures', 'Failed deliveries', '3'), v('link', 'Webhooks link', 'https://app.vistar.app/app/webhooks', 'url')],
  },
  integration_error: {
    label: 'Integration error',
    description: 'Sent to company admins when an integration stops working (expired token, rejected credentials).',
    subject: '{{integration}} needs attention in {{workspace}}',
    html: [p('Hi {{name}},'), p('The {{integration}} integration of <strong>{{workspace}}</strong> stopped working: {{error}}'), button('Open integrations')].join('\n'),
    variables: [v('name', 'Name', 'Rahul'), v('workspace', 'Company', 'Shakti Traders'), v('integration', 'Integration', 'Google Calendar'), v('error', 'Problem', 'Google access was revoked: connect again.'), v('link', 'Integrations link', 'https://app.vistar.app/app/integrations', 'url')],
  },
};

export const COMPANY_EMAIL_DEFAULTS: Record<CompanyEmailTemplateKey, EmailTemplateDefault> = {
  quotation_sent: {
    label: 'Quotation sent',
    description: 'Sent with a quotation PDF (Send quotation by e-mail).',
    subject: 'Quotation {{quotationNumber}} from {{company}}',
    html: [p('Dear {{customerName}},'), p('Thank you for your enquiry. Please find our quotation <strong>{{quotationNumber}}</strong> for {{amount}} attached, valid until {{validUntil}}.'), button('View the quotation online'), p('Regards,<br>{{senderName}}<br>{{company}}')].join('\n'),
    variables: [v('customerName', 'Customer name', 'Mr. Sharma'), v('quotationNumber', 'Quotation number', 'QT/2026-27/0012'), v('amount', 'Total', '₹1,18,000', 'money'), v('validUntil', 'Valid until', '30 Nov 2026', 'date'), v('link', 'Online link', 'https://app.vistar.app/d/abc123', 'url'), v('senderName', 'Sender', 'Rahul Mehta')],
  },
  invoice_sent: {
    label: 'Invoice sent',
    description: 'Sent with an invoice PDF (Send invoice by e-mail).',
    subject: 'Invoice {{invoiceNumber}} from {{company}}',
    html: [p('Dear {{customerName}},'), p('Please find invoice <strong>{{invoiceNumber}}</strong> for {{amount}} attached, due on {{dueDate}}.'), button('View the invoice online'), p('Regards,<br>{{senderName}}<br>{{company}}')].join('\n'),
    variables: [v('customerName', 'Customer name', 'Mr. Sharma'), v('invoiceNumber', 'Invoice number', 'INV/2026-27/0034'), v('amount', 'Total', '₹1,18,000', 'money'), v('dueDate', 'Due date', '15 Nov 2026', 'date'), v('link', 'Online link', 'https://app.vistar.app/d/abc123', 'url'), v('senderName', 'Sender', 'Rahul Mehta')],
  },
  payment_reminder: {
    label: 'Payment reminder',
    description: 'Reminder for an unpaid invoice.',
    subject: 'Reminder: invoice {{invoiceNumber}} is due',
    html: [p('Dear {{customerName}},'), p('This is a reminder that {{amountDue}} on invoice <strong>{{invoiceNumber}}</strong> was due on {{dueDate}} ({{daysOverdue}} days ago).'), button('View the invoice'), p('Please ignore this message if you have already paid.<br>{{senderName}}, {{company}}')].join('\n'),
    variables: [v('customerName', 'Customer name', 'Mr. Sharma'), v('invoiceNumber', 'Invoice number', 'INV/2026-27/0034'), v('amountDue', 'Amount due', '₹18,000', 'money'), v('dueDate', 'Due date', '15 Nov 2026', 'date'), v('daysOverdue', 'Days overdue', '5'), v('link', 'Online link', 'https://app.vistar.app/d/abc123', 'url'), v('senderName', 'Sender', 'Rahul Mehta')],
  },
  follow_up: {
    label: 'Follow-up',
    description: 'General follow-up after a call or a meeting.',
    subject: 'Following up from {{company}}',
    html: [p('Dear {{customerName}},'), p('Thank you for your time. {{message}}'), p('Regards,<br>{{senderName}}<br>{{company}}')].join('\n'),
    variables: [v('customerName', 'Customer name', 'Mr. Sharma'), v('message', 'Message', 'As discussed, I am sharing the product catalogue and will call you on Monday.'), v('senderName', 'Sender', 'Rahul Mehta')],
  },
  meeting_invite: {
    label: 'Meeting invite',
    description: 'Sent to guests and contacts invited to a meeting.',
    subject: 'Meeting: {{meetingTitle}} on {{startTime}}',
    html: [p('Dear {{customerName}},'), p('You are invited to <strong>{{meetingTitle}}</strong> on {{startTime}} to {{endTime}}.'), p('Where: {{location}}'), button('Join the call', '{{videoLink}}'), p('Regards,<br>{{senderName}}<br>{{company}}')].join('\n'),
    variables: [v('customerName', 'Guest name', 'Mr. Sharma'), v('meetingTitle', 'Meeting title', 'Product demo'), v('startTime', 'Start', '05 Nov 2026, 11:00', 'date'), v('endTime', 'End', '11:30', 'date'), v('location', 'Place', 'Online'), v('videoLink', 'Video link', 'https://meet.google.com/abc-defg-hij', 'url'), v('senderName', 'Organiser', 'Rahul Mehta')],
  },
  welcome_lead: {
    label: 'Welcome new lead',
    description: 'First e-mail to a new lead (workflows can send it automatically).',
    subject: 'Thank you for contacting {{company}}',
    html: [p('Dear {{customerName}},'), p('Thank you for your enquiry. {{senderName}} from our team will contact you shortly on {{phone}}.'), p('Regards,<br>{{company}}')].join('\n'),
    variables: [v('customerName', 'Lead name', 'Mr. Sharma'), v('senderName', 'Owner', 'Rahul Mehta'), v('phone', 'Lead phone', '+91 98765 43210')],
  },
};

export function emailTemplateDefault(scope: EmailTemplateScope, key: string): EmailTemplateDefault | null {
  const table = (scope === 'platform' ? PLATFORM_EMAIL_DEFAULTS : COMPANY_EMAIL_DEFAULTS) as Record<string, EmailTemplateDefault>;
  return table[key] ?? null;
}

/** Declared variables of a key, including the common ones of its scope. */
export function emailTemplateVariables(scope: EmailTemplateScope, key: string): EmailTemplateVariable[] {
  const def = emailTemplateDefault(scope, key);
  const common = scope === 'platform' ? PLATFORM_COMMON_VARIABLES : COMPANY_COMMON_VARIABLES;
  return [...(def?.variables ?? []), ...common.filter((c) => !def?.variables.some((d) => d.name === c.name))];
}

export function sampleVariables(scope: EmailTemplateScope, key: string): Record<string, string> {
  return Object.fromEntries(emailTemplateVariables(scope, key).map((x) => [x.name, x.sample]));
}

// ---------------------------------------------------------------- engine

const VAR_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Variable names used by a text (unique, in order of first use). */
export function templateVariablesUsed(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

export interface EmailTemplateProblems {
  unknownVariables: string[];
  missingRequired: string[];
  /** Markup removed by the sanitiser (script, iframe, event handlers, ...). */
  unsafeMarkup: boolean;
}

/** Problems of a template before saving; the API answers 422 TEMPLATE_INVALID when any list is not empty. */
export function checkEmailTemplate(scope: EmailTemplateScope, key: string, subject: string, html: string): EmailTemplateProblems {
  const declared = emailTemplateVariables(scope, key);
  const used = [...templateVariablesUsed(subject), ...templateVariablesUsed(html)];
  const names = new Set(declared.map((d) => d.name));
  return {
    unknownVariables: [...new Set(used.filter((u) => !names.has(u)))],
    missingRequired: declared.filter((d) => d.required && !used.includes(d.name)).map((d) => d.name),
    unsafeMarkup: sanitizeEmailHtml(html) !== html,
  };
}

/** Remove active content. Idempotent: sanitizeEmailHtml(sanitizeEmailHtml(x)) === sanitizeEmailHtml(x). */
export function sanitizeEmailHtml(html: string): string {
  let out = html;
  let prev = '';
  // Loop so nested tricks (<scr<script>ipt>) cannot survive one pass.
  while (out !== prev) {
    prev = out;
    out = out
      .replace(/<\s*(script|style|iframe|object|embed|form|base|meta|link|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|input|button|textarea|select|base|meta|link|svg|math|frame|frameset)\b[^>]*>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(href|src|action|formaction|background|poster)\s*=\s*("|')\s*(javascript|vbscript|data):[^"']*\2/gi, ' $1="#"')
      .replace(/\s+(href|src|action|formaction|background|poster)\s*=\s*(javascript|vbscript|data):[^\s>]*/gi, ' $1="#"')
      .replace(/\s+style\s*=\s*("[^"]*expression\([^"]*"|'[^']*expression\([^']*')/gi, '');
  }
  return out;
}

const safeUrl = (value: string) => (/^https?:\/\//i.test(value.trim()) ? value.trim() : '#');

export type TemplateValues = Readonly<Record<string, string | number | null | undefined>>;

function valueOf(name: string, values: TemplateValues, kinds: ReadonlyMap<string, EmailTemplateVariable['kind']>): string {
  const raw = values[name];
  const text = raw === null || raw === undefined ? '' : String(raw);
  return kinds.get(name) === 'url' ? safeUrl(text) : text;
}

/** Fill `{{var}}` in a subject (plain text, single line, max 250 chars). */
export function renderSubject(subject: string, values: TemplateValues, variables: readonly EmailTemplateVariable[] = []): string {
  const kinds = new Map(variables.map((x) => [x.name, x.kind]));
  return subject
    .replace(VAR_RE, (_, name: string) => valueOf(name, values, kinds))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 250);
}

/** Fill `{{var}}` in an HTML fragment: values HTML-escaped, active markup removed. */
export function renderHtmlFragment(html: string, values: TemplateValues, variables: readonly EmailTemplateVariable[] = []): string {
  const kinds = new Map(variables.map((x) => [x.name, x.kind]));
  return sanitizeEmailHtml(html).replace(VAR_RE, (_, name: string) => escapeHtml(valueOf(name, values, kinds)));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', hellip: '…' };

/** Plain-text part derived from HTML: links as "text (url)", blocks as lines, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*(head|style|script)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_, _q, h1: string | undefined, h2: string | undefined, inner: string) => {
      const href = (h1 ?? h2 ?? '').trim();
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return !href || href === '#' || href === label ? label : `${label} (${href})`;
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li\b[^>]*>/gi, '\n- ')
    .replace(/<\s*\/\s*(p|div|h[1-6]|tr|table|ul|ol|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+|#39);/gi, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e]!;
      if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------- layout

export const EmailLayoutThemeSchema = z.enum(['light', 'dark']);
export type EmailLayoutTheme = z.infer<typeof EmailLayoutThemeSchema>;

/** Branding of the layout: platform branding (Super Admin) or company branding (logo, colour, address). */
export interface EmailBrand {
  name: string;
  logoUrl?: string | null;
  /** #RRGGBB, already contrast-checked (branding.colors.light.accent for companies). */
  brandColor?: string | null;
  /** Text colour on the brand colour (button label). */
  brandTextColor?: string | null;
  footerLines?: readonly string[];
  links?: readonly { label: string; url: string }[];
}

const LAYOUT_COLORS: Record<EmailLayoutTheme, { bg: string; surface: string; border: string; fg: string; muted: string; accent: string; accentFg: string }> = {
  light: { bg: '#F6F7F9', surface: '#FFFFFF', border: '#E5E7EB', fg: '#0F172A', muted: '#56657A', accent: '#4F46E5', accentFg: '#FFFFFF' },
  dark: { bg: '#0E1015', surface: '#171A21', border: '#2A2F3A', fg: '#E8EAF0', muted: '#A3ABBA', accent: '#818CF8', accentFg: '#0E1015' },
};

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Wrap a rendered fragment in the branded, table-based, inline-styled layout (works in Gmail and Outlook). */
export function wrapEmailLayout(fragmentHtml: string, subject: string, brand: EmailBrand, theme: EmailLayoutTheme = 'light'): string {
  const c = LAYOUT_COLORS[theme];
  const accent = brand.brandColor && HEX.test(brand.brandColor) ? brand.brandColor : c.accent;
  const accentFg = brand.brandTextColor && HEX.test(brand.brandTextColor) ? brand.brandTextColor : c.accentFg;
  const buttonStyle = `display:inline-block;padding:10px 18px;border-radius:8px;background:${accent};color:${accentFg};text-decoration:none;font-weight:600`;
  const body = fragmentHtml.replace(/<a\b([^>]*?)\sclass\s*=\s*("button"|'button')([^>]*)>/gi, `<a$1 style="${buttonStyle}"$3>`);
  const name = escapeHtml(brand.name);
  const logo = brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl) ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" height="32" style="height:32px;max-width:200px;border:0;display:block">` : `<span style="font-size:18px;font-weight:700;color:${c.fg}">${name}</span>`;
  const footer = [
    ...(brand.footerLines ?? []).map((l) => escapeHtml(l)),
    (brand.links ?? []).filter((l) => /^https?:\/\//i.test(l.url)).map((l) => `<a href="${escapeHtml(l.url)}" style="color:${c.muted}">${escapeHtml(l.label)}</a>`).join(' &middot; '),
  ].filter(Boolean).join('<br>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${theme}"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${c.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${c.surface};border:1px solid ${c.border};border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${accent}">${logo}</td></tr>
<tr><td style="padding:24px;color:${c.fg};font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans',Arial,sans-serif;font-size:15px;line-height:1.6">${body}</td></tr>
${footer ? `<tr><td style="padding:16px 24px;border-top:1px solid ${c.border};color:${c.muted};font-family:Arial,sans-serif;font-size:12px;line-height:1.5">${footer}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Subject + full HTML (layout) + plain text for one template and its values. */
export function renderEmail(template: { subject: string; html: string }, values: TemplateValues, opts: { brand: EmailBrand; variables?: readonly EmailTemplateVariable[]; theme?: EmailLayoutTheme }): RenderedEmail {
  const subject = renderSubject(template.subject, values, opts.variables);
  const fragment = renderHtmlFragment(template.html, values, opts.variables);
  const html = wrapEmailLayout(fragment, subject, opts.brand, opts.theme ?? 'light');
  const footerText = [...(opts.brand.footerLines ?? [])].join('\n');
  const text = [htmlToText(fragment), footerText].filter(Boolean).join('\n\n-- \n');
  return { subject, html, text };
}
