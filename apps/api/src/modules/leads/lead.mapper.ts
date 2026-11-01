import {
  CustomFieldValuesSchema,
  LeadScoreBreakdownSchema,
  type Lead as LeadDto,
  type LeadListItem,
} from '@vistar/shared';
import { iso, toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** Include for every query that returns LeadListItem (tables, board cards, events). */
export const LEAD_LIST_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
} as const satisfies Prisma.LeadInclude;

/** Include for lead detail (LeadSchema). */
export const LEAD_DETAIL_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  stage: { select: { type: true } },
  contact: { select: { whatsappOptIn: true, dnd: true } },
} as const satisfies Prisma.LeadInclude;

export type LeadListRow = Prisma.LeadGetPayload<{ include: typeof LEAD_LIST_INCLUDE }>;
export type LeadDetailRow = Prisma.LeadGetPayload<{ include: typeof LEAD_DETAIL_INCLUDE }>;

export function toLeadListItem(l: LeadListRow): LeadListItem {
  return {
    id: l.id,
    name: l.name,
    companyName: l.companyName,
    phone: l.phone,
    email: l.email,
    city: l.city,
    source: l.source,
    pipelineId: l.pipelineId,
    stageId: l.stageId,
    position: l.position,
    owner: toUserSummary(l.owner),
    valueInr: l.valueInr,
    score: l.score,
    temperature: l.temperature,
    tags: l.tags,
    nextFollowUpAt: iso(l.nextFollowUpAt),
    lastActivityAt: iso(l.lastActivityAt),
    version: l.version,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export function toLead(l: LeadDetailRow): LeadDto {
  const optIn = l.contact?.whatsappOptIn;
  return {
    ...toLeadListItem(l),
    contactId: l.contactId,
    companyId: l.companyId,
    state: l.state,
    productInterest: l.productInterest,
    requirement: l.requirement,
    sourceRef: l.sourceRef,
    scoreBreakdown: parseBreakdown(l.scoreBreakdown),
    customFields: parseCustomFields(l.customFields),
    stageType: l.stage.type,
    whatsappOptIn: optIn === 'opted_in' ? true : optIn === 'opted_out' ? false : null,
    dnd: l.contact?.dnd ?? false,
    mergedIntoId: l.mergedIntoId,
  };
}

export function parseBreakdown(json: unknown): LeadDto['scoreBreakdown'] {
  const r = LeadScoreBreakdownSchema.safeParse(json);
  return r.success ? r.data : [];
}

export function parseCustomFields(json: unknown): LeadDto['customFields'] {
  const r = CustomFieldValuesSchema.safeParse(json);
  return r.success ? r.data : {};
}
