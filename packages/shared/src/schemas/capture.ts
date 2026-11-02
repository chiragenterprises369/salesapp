import { z } from 'zod';
import { CaptureFieldTypeSchema, CaptureFormStatusSchema } from '../enums.js';
import { WorkspaceBrandingSchema } from './branding.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, UtmSchema } from './common.js';

/**
 * LEAD CAPTURE FORMS (change #19 wave B, SPEC 29.9).
 * - Builder: fields mapped to lead fields or lead custom fields (`custom.<key>`); a form must map one
 *   field to `name` and one to `phone` or `email`. Unmapped answers are appended to the lead requirement.
 * - Hosted page `<WEB_ORIGIN>/f/<key>` (web route), embeddable as an iframe (`embedHtml`); the page reads
 *   utm_* / gclid / fbclid from its URL and sends them as `utm`; hidden fields can read any URL param.
 * - Public submit: rate limited per IP and form (CAPTURE_RATE_LIMITS, 429 RATE_LIMITED), honeypot field
 *   (a filled honeypot answers 200 and stores nothing), optional consent checkbox (required = 422 when
 *   unchecked; checked = ConsentRecord source web_form), `clientSubmissionId` makes retries idempotent.
 * - Each submission creates a lead with source `website` (or, with dedupe phone_or_email, adds a note to
 *   the open lead with the same phone or email) and runs lead routing when the form has no fixed owner.
 */

export const LEAD_FORM_TARGETS = ['name', 'phone', 'email', 'companyName', 'city', 'state', 'productInterest', 'requirement', 'valueInr', 'tags'] as const;
export const LeadFormTargetSchema = z.union([z.enum(LEAD_FORM_TARGETS), z.string().regex(/^custom\.[a-z][a-z0-9_]{0,39}$/)]);
export type LeadFormTarget = z.infer<typeof LeadFormTargetSchema>;

export const CaptureFieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).describe('Form field key (input name)'),
  label: z.string().trim().min(1).max(120),
  type: CaptureFieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(120).nullable().default(null),
  helpText: z.string().trim().max(300).nullable().default(null),
  /** select / multi_select */
  options: z.array(z.object({ value: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(120) })).max(100).default([]),
  mapTo: LeadFormTargetSchema.nullable().default(null),
  /** hidden fields: URL query param to read (e.g. "campaign"); else `defaultValue` */
  param: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).nullable().default(null),
  defaultValue: z.string().max(200).nullable().default(null),
});
export type CaptureField = z.infer<typeof CaptureFieldSchema>;

export const CaptureConsentSchema = z.object({
  enabled: z.boolean().default(false),
  required: z.boolean().default(false),
  text: z.string().trim().max(500).default('I agree to be contacted on phone, WhatsApp and email about my enquiry.'),
});

export const CaptureFormSettingsSchema = z.object({
  submitLabel: z.string().trim().min(1).max(40).default('Submit'),
  successMessage: z.string().trim().min(1).max(300).default('Thank you. We will contact you shortly.'),
  redirectUrl: z.url().max(500).nullable().default(null),
  consent: CaptureConsentSchema.default(CaptureConsentSchema.parse({})),
  defaultTags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /** Fixed owner; null = lead routing decides. */
  ownerId: IdSchema.nullable().default(null),
  /** Stage for new leads; null = first stage of the default pipeline. */
  stageId: IdSchema.nullable().default(null),
  notifyOwner: z.boolean().default(true),
  dedupe: z.enum(['none', 'phone_or_email']).default('phone_or_email'),
  layout: z.enum(['card', 'plain']).default('card'),
  showLogo: z.boolean().default(true),
});
export type CaptureFormSettings = z.infer<typeof CaptureFormSettingsSchema>;

function fieldProblems(fields: readonly CaptureField[]): Array<{ path: (string | number)[]; message: string }> {
  const out: Array<{ path: (string | number)[]; message: string }> = [];
  const ids = new Set<string>();
  fields.forEach((f, i) => {
    if (ids.has(f.id)) out.push({ path: ['fields', i, 'id'], message: 'Field keys must be unique' });
    ids.add(f.id);
    if ((f.type === 'select' || f.type === 'multi_select') && !f.options.length) out.push({ path: ['fields', i, 'options'], message: 'Add at least one option' });
  });
  const targets = fields.map((f) => f.mapTo);
  if (!targets.includes('name')) out.push({ path: ['fields'], message: 'Map one field to the lead name' });
  if (!targets.includes('phone') && !targets.includes('email')) out.push({ path: ['fields'], message: 'Map one field to the phone or the email' });
  const mapped = targets.filter((t): t is LeadFormTarget => !!t && t !== 'tags');
  if (new Set(mapped).size !== mapped.length) out.push({ path: ['fields'], message: 'Each lead field can be mapped once' });
  return out;
}

const FieldsSchema = z.array(CaptureFieldSchema).min(1).max(40);

export const CaptureFormSchema = z.object({
  id: IdSchema,
  /** Public key in URLs (/f/<key>, /public/forms/<key>). */
  key: z.string(),
  name: z.string(),
  status: CaptureFormStatusSchema,
  fields: z.array(CaptureFieldSchema),
  settings: CaptureFormSettingsSchema,
  submissionCount: z.number().int(),
  lastSubmissionAt: IsoDateTimeSchema.nullable(),
  hostedUrl: z.string(),
  embedHtml: z.string().describe('<iframe> snippet for any website'),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type CaptureForm = z.infer<typeof CaptureFormSchema>;

export const CaptureFormCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: CaptureFormStatusSchema.default('active'),
    fields: FieldsSchema,
    settings: CaptureFormSettingsSchema.default(CaptureFormSettingsSchema.parse({})),
  })
  .superRefine((f, ctx) => fieldProblems(f.fields).forEach((p) => ctx.addIssue({ code: 'custom', ...p })));
export type CaptureFormCreate = z.infer<typeof CaptureFormCreateSchema>;

/** `fields` replaces all fields; `settings` is merged key by key (default-free patch: Zod 4 `.partial()` keeps defaults). */
export const CaptureFormSettingsPatchSchema = z
  .object({
    submitLabel: z.string().trim().min(1).max(40),
    successMessage: z.string().trim().min(1).max(300),
    redirectUrl: z.url().max(500).nullable(),
    consent: z.object({ enabled: z.boolean(), required: z.boolean(), text: z.string().trim().max(500) }),
    defaultTags: z.array(z.string().trim().min(1).max(40)).max(10),
    ownerId: IdSchema.nullable(),
    stageId: IdSchema.nullable(),
    notifyOwner: z.boolean(),
    dedupe: z.enum(['none', 'phone_or_email']),
    layout: z.enum(['card', 'plain']),
    showLogo: z.boolean(),
  })
  .partial();
export const CaptureFormUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    status: CaptureFormStatusSchema,
    fields: FieldsSchema,
    settings: CaptureFormSettingsPatchSchema,
  })
  .partial()
  .superRefine((f, ctx) => {
    if (f.fields) fieldProblems(f.fields).forEach((p) => ctx.addIssue({ code: 'custom', ...p }));
  });
export type CaptureFormUpdate = z.infer<typeof CaptureFormUpdateSchema>;

export const CaptureSubmissionSchema = z.object({
  id: IdSchema,
  formId: IdSchema,
  leadId: IdSchema.nullable(),
  /** Set when dedupe matched an open lead (a note was added instead of a new lead). */
  duplicateOfLeadId: IdSchema.nullable(),
  values: z.record(z.string(), z.unknown()),
  utm: UtmSchema,
  consent: z.boolean().nullable(),
  pageUrl: z.string().nullable(),
  referrer: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type CaptureSubmission = z.infer<typeof CaptureSubmissionSchema>;
export const CaptureSubmissionListQuerySchema = CursorPaginationQuerySchema;

// ---------------------------------------------------------------- public

export const CaptureFormKeyParamSchema = z.object({ key: z.string().regex(/^[A-Za-z0-9]{10,32}$/) });

/** Name of the honeypot input the hosted page renders off-screen (bots fill it, people do not). */
export const CAPTURE_HONEYPOT_FIELD = 'company_website';
/** Per form: 5 submissions per IP per minute, 30 per IP per hour, 120 per minute in total. */
export const CAPTURE_RATE_LIMITS = { perIpPerMinute: 5, perIpPerHour: 30, perFormPerMinute: 120 } as const;

export const PublicCaptureFormSchema = z.object({
  key: z.string(),
  name: z.string(),
  fields: z.array(CaptureFieldSchema.omit({ mapTo: true })),
  submitLabel: z.string(),
  successMessage: z.string(),
  consent: CaptureConsentSchema,
  layout: z.enum(['card', 'plain']),
  showLogo: z.boolean(),
  honeypotField: z.string(),
  workspaceName: z.string(),
  branding: WorkspaceBrandingSchema,
});
export type PublicCaptureForm = z.infer<typeof PublicCaptureFormSchema>;

export const CaptureValueSchema = z.union([z.string().max(4000), z.number(), z.boolean(), z.array(z.string().max(200)).max(100), z.null()]);

export const PublicCaptureSubmitSchema = z.object({
  values: z.record(z.string().max(40), CaptureValueSchema).describe('field id -> answer'),
  consent: z.boolean().optional(),
  utm: UtmSchema.default({}),
  pageUrl: z.string().max(2000).nullable().optional(),
  referrer: z.string().max(2000).nullable().optional(),
  /** Honeypot (CAPTURE_HONEYPOT_FIELD); must be empty. */
  hp: z.string().max(500).optional(),
  clientSubmissionId: z.uuid().optional(),
});
export type PublicCaptureSubmit = z.infer<typeof PublicCaptureSubmitSchema>;

export const PublicCaptureSubmitResultSchema = z.object({ ok: z.literal(true), message: z.string(), redirectUrl: z.string().nullable() });
export type PublicCaptureSubmitResult = z.infer<typeof PublicCaptureSubmitResultSchema>;

/** Web path of the hosted form page. */
export const captureFormHostedPath = (key: string): string => `/f/${key}`;
