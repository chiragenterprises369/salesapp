import { z } from 'zod';
import { LeadSourceSchema, TaskPrioritySchema } from '../enums.js';

/**
 * Workflow node catalogue. Node `type` strings are `<category>.<name>`.
 * Configs reference stable keys (stageKey, templateName) rather than ids so templates are portable.
 * Output handles: every node exposes one input handle "in" (except triggers) and the outputs below.
 */

const minutes = z.number().int().min(0).max(60 * 24 * 90);

export const COMPARE_OPS = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;
export const CompareOpSchema = z.enum(COMPARE_OPS);
export type CompareOp = z.infer<typeof CompareOpSchema>;

const fieldRule = z.object({
  field: z.string().describe('Variable path, e.g. lead.city, lead.valueInr, lead.custom.gst'),
  op: CompareOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});

export const nodeConfigSchemas = {
  // ---------- triggers ----------
  'trigger.indiamart_lead': z.object({}),
  'trigger.website_form': z.object({ formKey: z.string().optional().describe('Empty = any form') }),
  'trigger.inbound_webhook': z.object({ endpointId: z.string().min(1) }),
  'trigger.whatsapp_message': z.object({ keywords: z.array(z.string()).default([]).describe('Empty = any message') }),
  'trigger.contact_created': z.object({ sources: z.array(LeadSourceSchema).default([]) }),
  'trigger.stage_changed': z.object({ fromStageKey: z.string().optional(), toStageKey: z.string().optional() }),
  'trigger.call_missed': z.object({}),
  'trigger.schedule': z.object({
    cron: z.string().min(9).describe('5-field cron, workspace timezone, e.g. "0 10 * * 1-6"'),
    leadFilter: z
      .object({
        stageKeys: z.array(z.string()).default([]),
        inactiveDays: z.number().int().min(1).max(365).optional(),
        tags: z.array(z.string()).default([]),
      })
      .describe('Leads to enrol on each tick'),
  }),

  // ---------- actions ----------
  'action.upsert_contact': z.object({
    createDeal: z.boolean().default(true),
    dealValueInr: z.number().int().min(0).nullable().default(null).describe('null = use lead.valueInr'),
  }),
  'action.send_whatsapp_template': z.object({
    templateName: z.string().min(1),
    language: z.string().default('en'),
    variables: z.record(z.string(), z.string()).default({}).describe('Template slot -> text with {{variables}}'),
  }),
  'action.send_whatsapp_text': z.object({
    body: z.string().min(1).max(4096),
    mediaFileId: z.string().optional(),
  }),
  'action.send_email': z.object({ subject: z.string().min(1).max(200), body: z.string().min(1) }),
  'action.send_sms': z.object({ body: z.string().min(1).max(612), dltTemplateId: z.string().optional() }),
  'action.create_task': z.object({
    title: z.string().min(1).max(200),
    notes: z.string().optional(),
    dueInMinutes: minutes.default(60),
    priority: TaskPrioritySchema.default('normal'),
    assignTo: z.enum(['owner', 'user']).default('owner'),
    userId: z.string().optional(),
  }),
  'action.create_call_task': z.object({
    title: z.string().min(1).max(200).default('Call {{lead.name}}'),
    dueInMinutes: minutes.default(30),
    priority: TaskPrioritySchema.default('high'),
  }),
  'action.assign_owner': z.object({
    strategy: z.enum(['round_robin', 'least_busy', 'rule', 'specific']),
    userIds: z.array(z.string()).default([]).describe('Pool; empty = all active sales reps'),
    teamId: z.string().optional(),
    rules: z.array(fieldRule.extend({ userId: z.string() })).default([]),
    onlyIfUnassigned: z.boolean().default(true),
  }),
  'action.add_tag': z.object({ tags: z.array(z.string().min(1)).min(1) }),
  'action.change_stage': z.object({ stageKey: z.string().min(1) }),
  'action.update_field': z.object({
    field: z.string().describe('temperature | valueInr | nextFollowUpAt | custom.<key>'),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
  'action.outbound_webhook': z.object({
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    bodyTemplate: z.string().optional().describe('JSON with {{variables}}; default = lead payload'),
  }),

  // ---------- logic ----------
  'logic.wait': z.object({
    amount: z.number().int().min(1).max(10_000),
    unit: z.enum(['minutes', 'hours', 'days']),
    businessHoursOnly: z.boolean().default(true),
    resumeOnReply: z.boolean().default(false).describe('Continue early when the lead replies'),
  }),
  'logic.condition': z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('replied'), since: z.enum(['run_start', 'last_outbound']).default('last_outbound') }),
    z.object({ kind: z.literal('keyword'), keywords: z.array(z.string()).min(1), matchAll: z.boolean().default(false) }),
    z.object({ kind: z.literal('field'), rule: fieldRule }),
  ]),
  'logic.switch': z.object({
    on: z.enum(['source', 'city', 'valueInr', 'reply_keyword', 'field']),
    field: z.string().optional().describe('Required when on = field'),
    cases: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9_]+$/).describe('Output handle id'),
          label: z.string(),
          op: CompareOpSchema,
          value: z.union([z.string(), z.number(), z.array(z.string())]),
        }),
      )
      .min(1)
      .max(12),
  }),
  'logic.dedupe': z.object({
    matchBy: z.array(z.enum(['phone', 'email', 'sourceRef'])).min(1).default(['phone', 'sourceRef']),
    withinDays: z.number().int().min(1).max(365).default(90),
  }),
  'logic.loop_limit': z.object({ max: z.number().int().min(1).max(50) }),
  'logic.stop': z.object({ reason: z.string().optional() }),

  // ---------- ai (behind FEATURE_AI_NODE) ----------
  'ai.classify_intent': z.object({
    labels: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(2).default(['price', 'catalog', 'not_interested', 'other']),
  }),
} as const;

export type NodeType = keyof typeof nodeConfigSchemas;
export const NODE_TYPES = Object.keys(nodeConfigSchemas) as NodeType[];
export const NodeTypeSchema = z.enum(NODE_TYPES as [NodeType, ...NodeType[]]);
export type NodeConfig<T extends NodeType> = z.infer<(typeof nodeConfigSchemas)[T]>;
export type NodeCategory = 'trigger' | 'action' | 'logic' | 'ai';

export interface NodeDefinition {
  type: NodeType;
  category: NodeCategory;
  label: string;
  description: string;
  /** lucide-react icon name */
  icon: string;
  /** Output handle ids given the node config. [] = terminal node. */
  outputs: (config: Record<string, unknown>) => string[];
  /** Messaging nodes pass through compliance guards (consent, 24h window, quiet hours, rate limit). */
  sendsMessage?: boolean;
  featureFlag?: 'FEATURE_AI_NODE';
}

const OUT = () => ['out'];

export const NODE_CATALOG: Record<NodeType, NodeDefinition> = {
  'trigger.indiamart_lead': { type: 'trigger.indiamart_lead', category: 'trigger', label: 'IndiaMART lead', description: 'A new enquiry arrives from IndiaMART', icon: 'Store', outputs: OUT },
  'trigger.website_form': { type: 'trigger.website_form', category: 'trigger', label: 'Website form', description: 'A website form is submitted', icon: 'Globe', outputs: OUT },
  'trigger.inbound_webhook': { type: 'trigger.inbound_webhook', category: 'trigger', label: 'Inbound webhook', description: 'A signed webhook is received', icon: 'Webhook', outputs: OUT },
  'trigger.whatsapp_message': { type: 'trigger.whatsapp_message', category: 'trigger', label: 'WhatsApp message received', description: 'A contact sends a WhatsApp message', icon: 'MessageCircle', outputs: OUT },
  'trigger.contact_created': { type: 'trigger.contact_created', category: 'trigger', label: 'New contact', description: 'A lead or contact is created', icon: 'UserPlus', outputs: OUT },
  'trigger.stage_changed': { type: 'trigger.stage_changed', category: 'trigger', label: 'Stage changed', description: 'A lead moves between pipeline stages', icon: 'Columns3', outputs: OUT },
  'trigger.call_missed': { type: 'trigger.call_missed', category: 'trigger', label: 'Call missed', description: 'An inbound call is missed', icon: 'PhoneMissed', outputs: OUT },
  'trigger.schedule': { type: 'trigger.schedule', category: 'trigger', label: 'Schedule', description: 'Runs on a schedule for matching leads', icon: 'CalendarClock', outputs: OUT },

  'action.upsert_contact': { type: 'action.upsert_contact', category: 'action', label: 'Create or update contact', description: 'Create the contact and optionally a deal', icon: 'Contact', outputs: OUT },
  'action.send_whatsapp_template': { type: 'action.send_whatsapp_template', category: 'action', label: 'Send WhatsApp template', description: 'Send an approved template message', icon: 'MessageSquareText', outputs: OUT, sendsMessage: true },
  'action.send_whatsapp_text': { type: 'action.send_whatsapp_text', category: 'action', label: 'Send WhatsApp message', description: 'Free-form message, only inside the 24h window', icon: 'MessageSquare', outputs: OUT, sendsMessage: true },
  'action.send_email': { type: 'action.send_email', category: 'action', label: 'Send email', description: 'Send an email to the lead', icon: 'Mail', outputs: OUT, sendsMessage: true },
  'action.send_sms': { type: 'action.send_sms', category: 'action', label: 'Send SMS', description: 'Send a DLT-registered SMS', icon: 'Smartphone', outputs: OUT, sendsMessage: true },
  'action.create_task': { type: 'action.create_task', category: 'action', label: 'Create task', description: 'Create a task for the owner or a user', icon: 'ListTodo', outputs: OUT },
  'action.create_call_task': { type: 'action.create_call_task', category: 'action', label: 'Create call task', description: 'Schedule a call for the owner', icon: 'PhoneOutgoing', outputs: OUT },
  'action.assign_owner': { type: 'action.assign_owner', category: 'action', label: 'Assign owner', description: 'Round-robin, least busy or by rule', icon: 'UserCheck', outputs: OUT },
  'action.add_tag': { type: 'action.add_tag', category: 'action', label: 'Add tag', description: 'Add tags to the lead', icon: 'Tag', outputs: OUT },
  'action.change_stage': { type: 'action.change_stage', category: 'action', label: 'Change stage', description: 'Move the lead to a stage', icon: 'MoveRight', outputs: OUT },
  'action.update_field': { type: 'action.update_field', category: 'action', label: 'Update field', description: 'Set a lead or custom field', icon: 'PencilLine', outputs: OUT },
  'action.outbound_webhook': { type: 'action.outbound_webhook', category: 'action', label: 'Call webhook', description: 'POST a signed payload to a URL', icon: 'Send', outputs: OUT },

  'logic.wait': { type: 'logic.wait', category: 'logic', label: 'Wait', description: 'Pause for a duration (business-hours aware)', icon: 'Hourglass', outputs: OUT },
  'logic.condition': { type: 'logic.condition', category: 'logic', label: 'Condition', description: 'Branch on reply, keyword or field', icon: 'GitBranch', outputs: () => ['yes', 'no'] },
  'logic.switch': {
    type: 'logic.switch',
    category: 'logic',
    label: 'Switch',
    description: 'Route by source, city, value or keyword',
    icon: 'Split',
    outputs: (c) => [...((c.cases as Array<{ key: string }> | undefined) ?? []).map((x) => x.key), 'default'],
  },
  'logic.dedupe': { type: 'logic.dedupe', category: 'logic', label: 'Dedupe', description: 'Check for an existing lead', icon: 'CopyCheck', outputs: () => ['unique', 'duplicate'] },
  'logic.loop_limit': { type: 'logic.loop_limit', category: 'logic', label: 'Loop limit', description: 'Stop after N passes', icon: 'Repeat', outputs: () => ['out', 'exceeded'] },
  'logic.stop': { type: 'logic.stop', category: 'logic', label: 'Stop', description: 'End the run', icon: 'CircleStop', outputs: () => [] },

  'ai.classify_intent': {
    type: 'ai.classify_intent',
    category: 'ai',
    label: 'Classify reply intent',
    description: 'AI labels the latest reply',
    icon: 'Sparkles',
    outputs: (c) => ((c.labels as string[] | undefined) ?? ['price', 'catalog', 'not_interested', 'other']),
    featureFlag: 'FEATURE_AI_NODE',
  },
};

/** Variables available in message bodies, task titles and webhook templates. */
export const WORKFLOW_VARIABLES = [
  { key: 'lead.name', label: 'Lead name', example: 'Rakesh Gupta' },
  { key: 'lead.firstName', label: 'Lead first name', example: 'Rakesh' },
  { key: 'lead.companyName', label: 'Company', example: 'Gupta Steel Works' },
  { key: 'lead.phone', label: 'Phone', example: '+919876543210' },
  { key: 'lead.email', label: 'Email', example: 'rakesh@guptasteel.in' },
  { key: 'lead.city', label: 'City', example: 'Ludhiana' },
  { key: 'lead.productInterest', label: 'Product', example: 'SS pipes 2 inch' },
  { key: 'lead.valueInr', label: 'Deal value (INR)', example: '85000' },
  { key: 'lead.source', label: 'Source', example: 'indiamart' },
  { key: 'owner.name', label: 'Owner name', example: 'Priya Sharma' },
  { key: 'owner.phone', label: 'Owner phone', example: '+919812345678' },
  { key: 'workspace.name', label: 'Business name', example: 'Shakti Industries' },
  { key: 'reply.text', label: 'Latest reply', example: 'Please share price' },
] as const;
export type WorkflowVariableKey = (typeof WORKFLOW_VARIABLES)[number]['key'];

/** Replace {{path}} placeholders. Unknown paths render as empty string. */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), context);
    return value === undefined || value === null ? '' : String(value);
  });
}
