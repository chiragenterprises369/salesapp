import { z } from 'zod';
import { MeetingSchema } from './calendar.js';
import { AccountSchema, ContactListItemSchema, ContactSchema, DealListItemSchema, DealSchema } from './crm.js';
import { InvoiceListItemSchema, QuotationListItemSchema } from './documents.js';
import { LeadListItemSchema } from './lead.js';
import { PipelineSchema, StageSchema } from './pipeline.js';

/**
 * Related records on a contact, account or deal detail page (each list newest first, at most 50,
 * filtered by the caller's data scope and permissions: a list the caller may not read is empty).
 */
export const CrmRelatedSchema = z.object({
  contacts: z.array(ContactListItemSchema).describe('Accounts only'),
  leads: z.array(LeadListItemSchema),
  deals: z.array(DealListItemSchema),
  quotations: z.array(QuotationListItemSchema),
  invoices: z.array(InvoiceListItemSchema),
  /** Upcoming first, then the last 20 past meetings. */
  meetings: z.array(MeetingSchema),
});
export type CrmRelated = z.infer<typeof CrmRelatedSchema>;

/** POST /leads/{id}/convert result. */
export const LeadConvertResultSchema = z.object({
  leadId: z.uuid(),
  contact: ContactSchema,
  account: AccountSchema.nullable(),
  deal: DealSchema.nullable(),
});
export type LeadConvertResult = z.infer<typeof LeadConvertResultSchema>;

/**
 * GET /deals/board. Columns follow the stage order; each holds the first `perColumn` deals by position.
 * More of one column: GET /deals?pipelineId&stageId=<id>&sort=position&dir=asc&cursor=<nextCursor>.
 */
export const DealBoardColumnSchema = z.object({
  stage: StageSchema,
  count: z.number().int(),
  totalValueInr: z.number().int().min(0),
  weightedValueInr: z.number().int().min(0),
  deals: z.array(DealListItemSchema),
  nextCursor: z.string().nullable(),
});
export type DealBoardColumn = z.infer<typeof DealBoardColumnSchema>;
export const DealBoardSchema = z.object({ pipeline: PipelineSchema, columns: z.array(DealBoardColumnSchema) });
export type DealBoard = z.infer<typeof DealBoardSchema>;
