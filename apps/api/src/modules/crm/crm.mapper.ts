import type { Account, AccountListItem, AccountSummary, Contact, ContactListItem, ContactSummary, Deal, DealListItem, LineItem } from '@vistar/shared';
import { iso, toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { num, parseAddress, parseCustom, parseEmails, parsePhones } from './lib/values.js';

export const ACCOUNT_SUMMARY_SELECT = { id: true, name: true, gstin: true, city: true } as const satisfies Prisma.CompanySelect;
export const CONTACT_SUMMARY_SELECT = { id: true, name: true, phone: true, email: true, companyId: true } as const satisfies Prisma.ContactSelect;

export const toAccountSummary = (a: { id: string; name: string; gstin: string | null; city: string | null } | null | undefined): AccountSummary | null =>
  a ? { id: a.id, name: a.name, gstin: a.gstin, city: a.city } : null;
export const toContactSummary = (c: { id: string; name: string; phone: string | null; email: string | null; companyId: string | null } | null | undefined): ContactSummary | null =>
  c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, accountId: c.companyId } : null;

const optIn = (v: string | null): boolean | null => (v === 'opted_in' ? true : v === 'opted_out' ? false : null);

// ---------------------------------------------------------------- contacts

export const CONTACT_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  company: { select: ACCOUNT_SUMMARY_SELECT },
  _count: { select: { leads: { where: { deletedAt: null } }, deals: { where: { status: 'open', deletedAt: null } } } },
} as const satisfies Prisma.ContactInclude;
export type ContactRow = Prisma.ContactGetPayload<{ include: typeof CONTACT_INCLUDE }>;

export function toContactListItem(c: ContactRow): ContactListItem {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    phone: c.phone,
    email: c.email,
    account: toAccountSummary(c.company),
    city: c.city,
    stateCode: c.stateCode,
    owner: toUserSummary(c.owner),
    tags: c.tags,
    whatsappOptIn: optIn(c.whatsappOptIn),
    dnd: c.dnd,
    leadCount: c._count.leads,
    openDealCount: c._count.deals,
    lastActivityAt: iso(c.lastActivityAt),
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toContact(c: ContactRow): Contact {
  return {
    ...toContactListItem(c),
    additionalPhones: parsePhones(c.additionalPhones),
    additionalEmails: parseEmails(c.additionalEmails),
    gstin: c.gstin,
    pan: c.pan,
    billingAddress: parseAddress(c.billingAddress),
    shippingAddress: parseAddress(c.shippingAddress),
    customFields: parseCustom(c.customFields),
    mergedIntoId: c.mergedIntoId,
  };
}

// ---------------------------------------------------------------- accounts

export const ACCOUNT_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  _count: { select: { contacts: { where: { deletedAt: null } }, deals: { where: { status: 'open', deletedAt: null } } } },
} as const satisfies Prisma.CompanyInclude;
export type AccountRow = Prisma.CompanyGetPayload<{ include: typeof ACCOUNT_INCLUDE }>;

export function toAccountListItem(a: AccountRow, openDealValueInr = 0): AccountListItem {
  return {
    id: a.id,
    name: a.name,
    industry: a.industry,
    gstin: a.gstin,
    phone: a.phone,
    email: a.email,
    website: a.website,
    city: a.city,
    stateCode: a.stateCode,
    owner: toUserSummary(a.owner),
    tags: a.tags,
    contactCount: a._count.contacts,
    openDealCount: a._count.deals,
    openDealValueInr,
    lastActivityAt: iso(a.lastActivityAt),
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toAccount(a: AccountRow, openDealValueInr = 0): Account {
  return {
    ...toAccountListItem(a, openDealValueInr),
    pan: a.pan,
    additionalPhones: parsePhones(a.additionalPhones),
    additionalEmails: parseEmails(a.additionalEmails),
    billingAddress: parseAddress(a.billingAddress),
    shippingAddress: parseAddress(a.shippingAddress),
    customFields: parseCustom(a.customFields),
    mergedIntoId: a.mergedIntoId,
  };
}

// ---------------------------------------------------------------- deals

export const DEAL_LIST_INCLUDE = {
  owner: { select: USER_SUMMARY_SELECT },
  company: { select: ACCOUNT_SUMMARY_SELECT },
  contact: { select: CONTACT_SUMMARY_SELECT },
  lead: { select: { id: true, name: true } },
  stage: { select: { probability: true, type: true } },
  _count: { select: { lines: true } },
} as const satisfies Prisma.DealInclude;
export type DealListRow = Prisma.DealGetPayload<{ include: typeof DEAL_LIST_INCLUDE }>;

export const DEAL_DETAIL_INCLUDE = { ...DEAL_LIST_INCLUDE, lines: { orderBy: { position: 'asc' } } } as const satisfies Prisma.DealInclude;
export type DealDetailRow = Prisma.DealGetPayload<{ include: typeof DEAL_DETAIL_INCLUDE }>;

export const dealProbability = (d: { probability: number | null; stage: { probability: number } | null; status: string }): number =>
  d.status === 'won' ? 100 : d.status === 'lost' ? 0 : (d.probability ?? d.stage?.probability ?? 0);

/** Deals always have a stage after the backfill (DealsService.ensurePipeline); the fallbacks keep the mapper total. */
export function toDealListItem(d: DealListRow): DealListItem {
  const probability = dealProbability(d);
  return {
    id: d.id,
    title: d.title,
    valueInr: d.valueInr,
    pipelineId: d.pipelineId ?? '00000000-0000-7000-8000-000000000000',
    stageId: d.stageId ?? '00000000-0000-7000-8000-000000000000',
    status: d.status,
    position: d.position,
    probability,
    weightedValueInr: Math.round((d.valueInr * probability) / 100),
    owner: toUserSummary(d.owner),
    account: toAccountSummary(d.company),
    contact: toContactSummary(d.contact),
    lead: d.lead ? { id: d.lead.id, name: d.lead.name } : null,
    expectedCloseAt: iso(d.expectedCloseAt),
    closedAt: iso(d.closedAt),
    lostReason: d.lostReason,
    lineCount: d._count.lines,
    version: d.version,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

type LineRow = {
  id: string;
  position: number;
  productId: string | null;
  name: string;
  description: string | null;
  hsnSac: string | null;
  unit: string;
  quantity: { toString(): string };
  unitPricePaise: bigint;
  discountKind: string;
  discountValue: { toString(): string };
  gstRate: number;
};

/** Stored line + computed amounts (deal lines keep only the taxable value; GST follows the seller state). */
export function toLineItem(l: LineRow & Partial<Record<'grossPaise' | 'discountPaise' | 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise', bigint>>, computed?: Pick<LineItem, 'grossPaise' | 'discountPaise' | 'taxablePaise' | 'cgstPaise' | 'sgstPaise' | 'igstPaise' | 'totalPaise'>): LineItem {
  return {
    id: l.id,
    position: l.position,
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit as LineItem['unit'],
    quantity: num(l.quantity),
    unitPricePaise: num(l.unitPricePaise),
    discountKind: l.discountKind === 'amount' ? 'amount' : 'percent',
    discountValue: num(l.discountValue),
    gstRate: l.gstRate as LineItem['gstRate'],
    grossPaise: computed?.grossPaise ?? num(l.grossPaise),
    discountPaise: computed?.discountPaise ?? num(l.discountPaise),
    taxablePaise: computed?.taxablePaise ?? num(l.taxablePaise),
    cgstPaise: computed?.cgstPaise ?? num(l.cgstPaise),
    sgstPaise: computed?.sgstPaise ?? num(l.sgstPaise),
    igstPaise: computed?.igstPaise ?? num(l.igstPaise),
    totalPaise: computed?.totalPaise ?? num(l.totalPaise),
  };
}

export function toDeal(d: DealDetailRow, lines: LineItem[]): Deal {
  return {
    ...toDealListItem(d),
    description: d.description,
    probabilityOverride: d.probability,
    lines,
    customFields: parseCustom(d.customFields),
  };
}
