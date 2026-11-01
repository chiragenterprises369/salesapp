import { DEFAULT_STAGES, type CompareOp, type LeadSource } from '@vistar/shared';

/** Field labels for generated config forms (keys from nodeConfigSchemas). */
export const FIELD_LABELS: Record<string, string> = {
  formKey: 'Form',
  endpointId: 'Webhook endpoint',
  keywords: 'Keywords',
  sources: 'Lead sources',
  fromStageKey: 'From stage',
  toStageKey: 'To stage',
  cron: 'Schedule',
  leadFilter: 'Leads to enrol',
  stageKeys: 'Stages',
  inactiveDays: 'Inactive for (days)',
  createDeal: 'Create a deal',
  dealValueInr: 'Deal value (INR)',
  templateName: 'Template',
  language: 'Language',
  variables: 'Template variables',
  body: 'Message',
  mediaFileId: 'Media file ID',
  subject: 'Subject',
  dltTemplateId: 'DLT template ID',
  title: 'Title',
  notes: 'Notes',
  dueInMinutes: 'Due in (minutes)',
  priority: 'Priority',
  assignTo: 'Assign to',
  userId: 'User',
  userIds: 'People',
  teamId: 'Team',
  strategy: 'Strategy',
  rules: 'Rules',
  onlyIfUnassigned: 'Only if the lead has no owner',
  tags: 'Tags',
  stageKey: 'Stage',
  field: 'Field',
  value: 'Value',
  url: 'URL',
  headers: 'Headers',
  bodyTemplate: 'Request body',
  amount: 'Wait for',
  unit: 'Unit',
  businessHoursOnly: 'Count business hours only',
  resumeOnReply: 'Continue early when the lead replies',
  kind: 'Condition',
  since: 'Since',
  matchAll: 'Match all keywords',
  rule: 'Rule',
  on: 'Route by',
  cases: 'Cases',
  matchBy: 'Match by',
  withinDays: 'Within (days)',
  max: 'Maximum passes',
  reason: 'Reason',
  labels: 'Intent labels',
  op: 'Operator',
  key: 'Output key',
  label: 'Label',
};

/** Friendlier hints than the schema descriptions. */
export const FIELD_HINTS: Record<string, string> = {
  formKey: 'Leave empty to start on any form.',
  keywords: 'Leave empty to start on any message. Case-insensitive.',
  sources: 'Leave empty to start for every source.',
  dealValueInr: 'Leave empty to use the lead value.',
  mediaFileId: 'Optional. Attach an uploaded file.',
  dltTemplateId: 'Registered DLT template for this message.',
  bodyTemplate: 'JSON with {{variables}}. Leave empty to send the lead payload.',
  inactiveDays: 'Only leads with no activity for this long.',
  userIds: 'Leave empty to use every active sales rep.',
  withinDays: 'Look back this many days for an existing lead.',
  max: 'After this many passes the run continues on Exceeded.',
};

export function fieldLabel(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const s = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Path like "rule.value" or "cases.0.label" -> "Value" / "Case 1 label". */
export function pathLabel(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split('.');
  if (parts[0] === 'cases' && parts.length >= 2) return `Case ${Number(parts[1]) + 1}${parts[2] ? ` ${fieldLabel(parts[2]).toLowerCase()}` : ''}`;
  if (parts[0] === 'rules' && parts.length >= 2) return `Rule ${Number(parts[1]) + 1}${parts[2] ? ` ${fieldLabel(parts[2]).toLowerCase()}` : ''}`;
  const last = [...parts].reverse().find((p) => Number.isNaN(Number(p))) ?? parts[0]!;
  return fieldLabel(last);
}

export const ENUM_LABELS: Record<string, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
  owner: 'Lead owner',
  user: 'A specific person',
  phone: 'Phone',
  email: 'Email',
  sourceRef: 'Source reference (IndiaMART ID)',
  minutes: 'Minutes',
  hours: 'Hours',
  days: 'Days',
  run_start: 'Since the run started',
  last_outbound: 'Since our last message',
  source: 'Lead source',
  city: 'City',
  valueInr: 'Deal value',
  reply_keyword: 'Reply keyword',
  field: 'Another field',
  round_robin: 'Round robin',
  least_busy: 'Least busy',
  rule: 'By rule',
  specific: 'Specific person',
};

export const OP_LABELS: Record<CompareOp, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is one of',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  contains: 'contains',
  exists: 'has a value',
};

export const SOURCE_LABELS: Record<LeadSource, string> = {
  indiamart: 'IndiaMART',
  website: 'Website',
  whatsapp: 'WhatsApp',
  manual: 'Manual',
  webhook: 'Webhook',
  import: 'Import',
  api: 'API',
};

export const STAGE_OPTIONS = DEFAULT_STAGES.map((s) => ({ value: s.key, label: s.name }));

export function stageName(key: string | undefined | null): string {
  if (!key) return '';
  return STAGE_OPTIONS.find((s) => s.value === key)?.label ?? key;
}

export function enumLabel(v: string): string {
  return ENUM_LABELS[v] ?? (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ');
}

export const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
];

/** Fields the engine reads for update_field. */
export const UPDATE_FIELD_OPTIONS = [
  { value: 'temperature', label: 'Temperature' },
  { value: 'valueInr', label: 'Deal value (INR)' },
  { value: 'nextFollowUpAt', label: 'Next follow-up' },
];

/** Variable paths usable in rules (condition field, switch field, assignment rules). */
export const RULE_FIELD_OPTIONS = [
  { value: 'lead.city', label: 'City' },
  { value: 'lead.source', label: 'Source' },
  { value: 'lead.valueInr', label: 'Deal value (INR)' },
  { value: 'lead.stageKey', label: 'Stage' },
  { value: 'lead.temperature', label: 'Temperature' },
  { value: 'lead.productInterest', label: 'Product' },
  { value: 'lead.companyName', label: 'Company' },
  { value: 'reply.text', label: 'Latest reply' },
];
