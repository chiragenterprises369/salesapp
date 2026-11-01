import { z } from 'zod';
import { StageTypeSchema } from '../enums.js';
import { HexColorSchema, IdSchema } from './common.js';
import { LeadListItemSchema } from './lead.js';

export const StageSchema = z.object({
  id: IdSchema,
  pipelineId: IdSchema,
  key: z.string().describe('Stable slug, e.g. "quote_sent"'),
  name: z.string(),
  type: StageTypeSchema,
  order: z.number().int(),
  color: HexColorSchema.nullable(),
  /** Win probability 0-100, used for revenue forecast. */
  probability: z.number().int().min(0).max(100),
});
export type Stage = z.infer<typeof StageSchema>;

export const PipelineSchema = z.object({
  id: IdSchema,
  /** Stable slug, unique per workspace ("sales" for the default pipeline). Packs match pipelines by key. */
  key: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  /** Pack that created the pipeline (null = created by the workspace). */
  packKey: z.string().nullable(),
  stages: z.array(StageSchema),
});
export type Pipeline = z.infer<typeof PipelineSchema>;

const StageInputFields = z.object({
  name: z.string().trim().min(1).max(40),
  type: StageTypeSchema,
  color: HexColorSchema.nullable().optional(),
  probability: z.number().int().min(0).max(100),
});

export const StageCreateSchema = StageInputFields.extend({
  type: StageTypeSchema.default('open'),
  probability: z.number().int().min(0).max(100).default(10),
  afterStageId: IdSchema.nullable().optional().describe('Insert after this stage; null = first'),
});
export type StageCreate = z.infer<typeof StageCreateSchema>;

/** Built from the default-free base (Zod 4 `.partial()` keeps defaults). */
export const StageUpdateSchema = StageInputFields.partial();
export type StageUpdate = z.infer<typeof StageUpdateSchema>;

export const StageReorderSchema = z.object({ stageIds: z.array(IdSchema).min(1) });

/**
 * Move a lead on the board. The server computes `position` between the neighbours.
 * No neighbours given = END of the target column (e.g. Table inline stage change).
 * Clients apply the move optimistically and roll back on error.
 */
export const LeadMoveSchema = z.object({
  stageId: IdSchema,
  beforeLeadId: IdSchema.nullable().optional().describe('Lead that will be directly above the moved card'),
  afterLeadId: IdSchema.nullable().optional().describe('Lead that will be directly below the moved card'),
  expectedVersion: z.number().int().optional(),
});
export type LeadMove = z.infer<typeof LeadMoveSchema>;

export const BoardColumnSchema = z.object({
  stage: StageSchema,
  count: z.number().int(),
  totalValueInr: z.number().int().min(0).describe('Sum of valueInr in the column (whole rupees)'),
  leads: z.array(LeadListItemSchema),
  nextCursor: z.string().nullable(),
});
export type BoardColumn = z.infer<typeof BoardColumnSchema>;

export const BoardSchema = z.object({
  pipeline: PipelineSchema,
  columns: z.array(BoardColumnSchema),
});
export type Board = z.infer<typeof BoardSchema>;

/** Default stages created for every new workspace. */
export const DEFAULT_STAGES: ReadonlyArray<Pick<Stage, 'key' | 'name' | 'type' | 'probability'>> = [
  { key: 'new', name: 'New', type: 'open', probability: 5 },
  { key: 'contacted', name: 'Contacted', type: 'open', probability: 15 },
  { key: 'interested', name: 'Interested', type: 'open', probability: 35 },
  { key: 'quote_sent', name: 'Quote sent', type: 'open', probability: 60 },
  { key: 'won', name: 'Won', type: 'won', probability: 100 },
  { key: 'lost', name: 'Lost', type: 'lost', probability: 0 },
];
