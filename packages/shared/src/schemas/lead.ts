import { z } from 'zod';
import { LeadSourceSchema, LeadsViewModeSchema, LeadTemperatureSchema, StageTypeSchema, type LeadsViewMode } from '../enums.js';
import {
  CursorPaginationQuerySchema,
  CustomFieldValuesSchema,
  IdSchema,
  InrSchema,
  IsoDateTimeSchema,
  PhoneSchema,
  queryArray,
  SortDirSchema,
} from './common.js';
import { UserSummarySchema } from './workspace.js';

export const LeadScoreBreakdownSchema = z.array(
  z.object({ rule: z.string(), points: z.number().int() }),
);

/** Compact lead used in tables, kanban cards, events and the Team Floor. */
export const LeadListItemSchema = z.object({
  id: IdSchema,
  name: z.string(),
  companyName: z.string().nullable(),
  phone: PhoneSchema.nullable(),
  email: z.email().nullable(),
  city: z.string().nullable(),
  source: LeadSourceSchema,
  pipelineId: IdSchema,
  stageId: IdSchema,
  /** Fractional-index rank within the stage column (lexicographic sort). Server-computed. */
  position: z.string(),
  owner: UserSummarySchema.nullable(),
  valueInr: InrSchema,
  score: z.number().int().min(0).max(100),
  temperature: LeadTemperatureSchema,
  tags: z.array(z.string()),
  nextFollowUpAt: IsoDateTimeSchema.nullable(),
  lastActivityAt: IsoDateTimeSchema.nullable(),
  /** Optimistic concurrency version; incremented on every write. */
  version: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LeadListItem = z.infer<typeof LeadListItemSchema>;

export const LeadSchema = LeadListItemSchema.extend({
  contactId: IdSchema.nullable(),
  companyId: IdSchema.nullable(),
  state: z.string().nullable(),
  productInterest: z.string().nullable(),
  requirement: z.string().nullable().describe('Free text enquiry, e.g. IndiaMART message'),
  sourceRef: z.string().nullable().describe('External id, e.g. IndiaMART UNIQUE_QUERY_ID; used for dedupe'),
  scoreBreakdown: LeadScoreBreakdownSchema,
  customFields: CustomFieldValuesSchema,
  stageType: StageTypeSchema,
  whatsappOptIn: z.boolean().nullable().describe('null = unknown'),
  dnd: z.boolean(),
  mergedIntoId: IdSchema.nullable(),
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  companyName: z.string().trim().max(160).optional(),
  phone: PhoneSchema.optional(),
  email: z.email().optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  source: LeadSourceSchema.default('manual'),
  sourceRef: z.string().max(120).optional(),
  productInterest: z.string().max(200).optional(),
  requirement: z.string().max(4000).optional(),
  ownerId: IdSchema.optional(),
  stageId: IdSchema.optional().describe('Defaults to first stage of default pipeline'),
  valueInr: InrSchema.default(0),
  tags: z.array(z.string().max(40)).max(30).default([]),
  customFields: CustomFieldValuesSchema.default({}),
});
export type LeadCreate = z.infer<typeof LeadCreateSchema>;

export const LeadUpdateSchema = LeadCreateSchema.omit({ source: true, sourceRef: true })
  .partial()
  .extend({
    nextFollowUpAt: IsoDateTimeSchema.nullable().optional(),
    ownerId: IdSchema.nullable().optional(),
    expectedVersion: z.number().int().optional().describe('If set and stale, server returns VERSION_CONFLICT'),
  });
export type LeadUpdate = z.infer<typeof LeadUpdateSchema>;

export const LEAD_SORT_FIELDS = ['createdAt', 'updatedAt', 'name', 'valueInr', 'score', 'nextFollowUpAt', 'lastActivityAt'] as const;

/**
 * Lead filters shared by the Board view, the Table view, saved views and exports.
 * Both views read the SAME filter state, so switching views never resets filters.
 * URL-serialisable: arrays are comma-separated query params.
 */
export const LeadFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().describe('Full-text search: name, company, phone, email, requirement'),
  source: queryArray(LeadSourceSchema),
  stageId: queryArray(IdSchema),
  ownerId: queryArray(z.union([IdSchema, z.literal('unassigned'), z.literal('me')])).describe('Omit = "All users"'),
  tag: queryArray(z.string()),
  temperature: queryArray(LeadTemperatureSchema),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  createdFrom: IsoDateTimeSchema.optional(),
  createdTo: IsoDateTimeSchema.optional(),
});
export type LeadFilters = z.infer<typeof LeadFiltersSchema>;

export const LeadListQuerySchema = CursorPaginationQuerySchema.extend(LeadFiltersSchema.shape).extend({
  sort: z.enum(LEAD_SORT_FIELDS).default('createdAt'),
  dir: SortDirSchema.default('desc'),
  viewId: IdSchema.optional().describe('Apply a saved view; explicit params override it'),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

// ---------------------------------------------------------------- leads page view mode
// LEADS_VIEW_MODES / LeadsViewModeSchema live in enums.ts (avoids a lead <-> workspace import cycle).

/**
 * Leads page views. Default is "board" (kanban). Resolution order (resolveLeadsViewMode):
 *   1. URL param ?view=board|table (wins for that visit; NOT persisted unless the user toggles)
 *   2. User setting `leads.viewMode` (server, follows the user across devices)
 *   3. localStorage `vistar.leads.viewMode` (instant fallback before settings load)
 *   4. Workspace setting `leads.defaultViewMode` (set by admins)
 *   5. "board"
 * When the user toggles: write localStorage immediately, then PATCH /me/settings { leadsViewMode }.
 */
export const DEFAULT_LEADS_VIEW_MODE: LeadsViewMode = 'board';
export const LEADS_VIEW_QUERY_PARAM = 'view';
export const LEADS_VIEW_STORAGE_KEY = 'vistar.leads.viewMode';

export function parseLeadsViewMode(value: unknown): LeadsViewMode | null {
  const r = LeadsViewModeSchema.safeParse(value);
  return r.success ? r.data : null;
}

export function resolveLeadsViewMode(input: {
  urlParam?: string | null;
  userSetting?: LeadsViewMode | null;
  localStorageValue?: string | null;
  workspaceDefault?: LeadsViewMode | null;
}): LeadsViewMode {
  return (
    parseLeadsViewMode(input.urlParam) ??
    input.userSetting ??
    parseLeadsViewMode(input.localStorageValue) ??
    input.workspaceDefault ??
    DEFAULT_LEADS_VIEW_MODE
  );
}

export const LeadBulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), leadIds: z.array(IdSchema).min(1).max(1000), ownerId: IdSchema.nullable() }),
  z.object({ action: z.literal('change_stage'), leadIds: z.array(IdSchema).min(1).max(1000), stageId: IdSchema }),
  z.object({ action: z.literal('add_tags'), leadIds: z.array(IdSchema).min(1).max(1000), tags: z.array(z.string()).min(1) }),
  z.object({ action: z.literal('remove_tags'), leadIds: z.array(IdSchema).min(1).max(1000), tags: z.array(z.string()).min(1) }),
  z.object({ action: z.literal('delete'), leadIds: z.array(IdSchema).min(1).max(1000) }),
  z.object({
    action: z.literal('whatsapp_template'),
    leadIds: z.array(IdSchema).min(1).max(1000),
    templateId: IdSchema,
    variables: z.record(z.string(), z.string()).default({}),
  }),
]);
export type LeadBulkAction = z.infer<typeof LeadBulkActionSchema>;

export const BulkResultSchema = z.object({
  succeeded: z.number().int(),
  failed: z.array(z.object({ id: IdSchema, code: z.string(), message: z.string() })),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;

/** Lead fields an import column / webhook payload can be mapped to. */
export const LEAD_IMPORT_FIELDS = [
  'name',
  'companyName',
  'phone',
  'email',
  'city',
  'state',
  'source',
  'sourceRef',
  'productInterest',
  'requirement',
  'valueInr',
  'tags',
  'ownerEmail',
  'stageName',
] as const;
export const LeadImportFieldSchema = z.union([z.enum(LEAD_IMPORT_FIELDS), z.string().regex(/^custom\.[a-z0-9_]+$/)]);

export const ImportPreviewResponseSchema = z.object({
  importId: IdSchema,
  columns: z.array(z.string()),
  sampleRows: z.array(z.record(z.string(), z.string())).max(20),
  suggestedMapping: z.record(z.string(), LeadImportFieldSchema.nullable()),
  rowCount: z.number().int(),
});
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;

export const ImportCommitRequestSchema = z.object({
  mapping: z.record(z.string(), LeadImportFieldSchema.nullable()).describe('column -> lead field; null = skip'),
  duplicateStrategy: z.enum(['skip', 'update', 'create']).default('skip').describe('Duplicates matched by phone, then email'),
  defaultOwnerId: IdSchema.optional(),
  defaultTags: z.array(z.string()).default([]),
});
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

export const ImportJobSchema = z.object({
  id: IdSchema,
  status: z.enum(['previewed', 'running', 'completed', 'failed']),
  rowCount: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })).max(500),
  createdAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.nullable(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

export const LeadMergeSchema = z.object({
  primaryId: IdSchema,
  duplicateIds: z.array(IdSchema).min(1).max(10),
  /** Field -> lead id whose value wins. Unlisted fields keep primary's value. */
  fieldWinners: z.record(z.string(), IdSchema).default({}),
});
export type LeadMerge = z.infer<typeof LeadMergeSchema>;

export const NoteCreateSchema = z.object({ body: z.string().trim().min(1).max(10_000) });
export type NoteCreate = z.infer<typeof NoteCreateSchema>;

export const SavedViewSchema = z.object({
  id: IdSchema,
  name: z.string(),
  entity: z.literal('lead'),
  filters: LeadFiltersSchema.extend({ sort: z.enum(LEAD_SORT_FIELDS).optional(), dir: SortDirSchema.optional() }),
  /** Table columns (ignored by the Board view). */
  columns: z.array(z.string()),
  /** Optional view the saved view opens in; null = keep the user's current view. */
  viewMode: LeadsViewModeSchema.nullable().default(null),
  isShared: z.boolean(),
  ownerId: IdSchema.nullable(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;
export const SavedViewCreateSchema = SavedViewSchema.omit({ id: true, ownerId: true, entity: true });
export type SavedViewCreate = z.infer<typeof SavedViewCreateSchema>;

export const TagSchema = z.object({ id: IdSchema, name: z.string(), color: z.string().nullable(), usageCount: z.number().int() });
export type Tag = z.infer<typeof TagSchema>;

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean', 'url'] as const;
export const CustomFieldSchema = z.object({
  id: IdSchema,
  entity: z.enum(['lead', 'contact']),
  key: z.string().regex(/^[a-z0-9_]+$/),
  label: z.string(),
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string()).default([]),
  required: z.boolean(),
  order: z.number().int(),
});
export type CustomField = z.infer<typeof CustomFieldSchema>;
