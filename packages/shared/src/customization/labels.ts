import { z } from 'zod';

/**
 * Configurable labels (contract). Display text only: URLs, API paths, events and DB names keep the
 * core names. Stored as workspace overrides in Setting `ui.labels` (SETTING_KEYS.workspace.labels).
 */
export const LABEL_KEYS = ['lead', 'contact', 'company', 'deal', 'task', 'call', 'pipeline', 'stage'] as const;
export const LabelKeySchema = z.enum(LABEL_KEYS);
export type LabelKey = z.infer<typeof LabelKeySchema>;

export const LabelSchema = z.object({
  singular: z.string().trim().min(1).max(40),
  plural: z.string().trim().min(1).max(40),
});
export type Label = z.infer<typeof LabelSchema>;

export const LabelOverridesSchema = z.partialRecord(LabelKeySchema, LabelSchema);
export type LabelOverrides = z.infer<typeof LabelOverridesSchema>;

export const ResolvedLabelsSchema = z.record(LabelKeySchema, LabelSchema);
export type ResolvedLabels = Record<LabelKey, Label>;

export const DEFAULT_LABELS: ResolvedLabels = {
  lead: { singular: 'Lead', plural: 'Leads' },
  contact: { singular: 'Contact', plural: 'Contacts' },
  company: { singular: 'Company', plural: 'Companies' },
  deal: { singular: 'Deal', plural: 'Deals' },
  task: { singular: 'Task', plural: 'Tasks' },
  call: { singular: 'Call', plural: 'Calls' },
  pipeline: { singular: 'Pipeline', plural: 'Pipelines' },
  stage: { singular: 'Stage', plural: 'Stages' },
};

export function resolveLabels(overrides?: LabelOverrides | null): ResolvedLabels {
  return { ...DEFAULT_LABELS, ...(overrides ?? {}) } as ResolvedLabels;
}

/** labelOf(labels, 'lead') -> "Enquiry"; { plural: true } -> "Enquiries"; { lower: true } for mid-sentence use. */
export function labelOf(labels: ResolvedLabels, key: LabelKey, opts: { plural?: boolean; lower?: boolean } = {}): string {
  const l = labels[key] ?? DEFAULT_LABELS[key];
  const text = opts.plural ? l.plural : l.singular;
  return opts.lower ? text.toLowerCase() : text;
}

export const LabelsResponseSchema = z.object({ labels: ResolvedLabelsSchema, overrides: LabelOverridesSchema });
export type LabelsResponse = z.infer<typeof LabelsResponseSchema>;
export const LabelsUpdateSchema = z.object({ overrides: LabelOverridesSchema });
