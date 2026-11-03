import {
  AccountCreateSchema,
  AccountUpdateSchema,
  CaptureFormCreateSchema,
  CaptureFormUpdateSchema,
  ContactCreateSchema,
  ContactUpdateSchema,
  CAPTURE_HONEYPOT_FIELD,
  captureFormHostedPath,
  computeDocument,
  DealCreateSchema,
  DEFAULT_DEAL_STAGES,
  documentHostedPath,
  EMPTY_BRANDING,
  financialYearOf,
  formatDocumentNumber,
  gstinCheckChar,
  InvoiceCreateSchema,
  MeetingCreateSchema,
  nextRoundRobin,
  PaymentCreateSchema,
  PriceListCreateSchema,
  ProductCreateSchema,
  QUOTATION_TRANSITIONS,
  QuotationCreateSchema,
  routingConditionMisses,
  RoutingRuleCreateSchema,
  RoutingTestSchema,
  SellerProfileSchema,
  stateName,
  type Account,
  type Address,
  type CaptureForm,
  type CaptureSubmission,
  type Contact,
  type CrmTimelineItem,
  type Deal,
  type DocumentShare,
  type DocumentDeliveryResult,
  type ErrorCode,
  type IndianStateCode,
  type Invoice,
  type LineItem,
  type LineItemInput,
  type Meeting,
  type Party,
  type Pipeline,
  type PriceList,
  type Product,
  type Quotation,
  type RoutingRule,
  type SellerProfile,
  type TimeOff,
  type UserSummary,
} from '@vistar/shared';
import { mockUsers } from '@vistar/shared/fixtures';
import { generateKeyBetween } from 'fractional-indexing';
import type { z, ZodType } from 'zod';
import { ApiRequestError } from '../api-error';
import { noteMockUse } from '../api/data-source';
import { mockLeadsSource } from '../leads/mock-source';
import { useSessionStore } from '../session/session';
import { uuid4 } from './ids';
import type { CrmSource } from './source';

/**
 * In-memory CRM backend for the test-only mock data mode (lib/api/data-source). Inputs are parsed with
 * the shared zod schemas (same defaults and field errors as the API), totals come from the shared GST
 * math, data scope follows the signed-in mock persona (own, team, all). Seeded on first use; edits last
 * for the tab. Never used in API mode.
 */

const users = mockUsers();
const userById = (id: string | null | undefined): UserSummary | null => users.find((u) => u.id === id) ?? null;
const delay = (ms = 80 + Math.random() * 120) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function fail(code: ErrorCode, message: string, status: number, details: Array<{ path: string; message: string }> = []): never {
  throw new ApiRequestError(code, message, details.map((d) => ({ ...d, code: 'invalid' })) as never, { status });
}

function parse<S extends ZodType>(schema: S, body: unknown): z.output<S> {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  fail(
    'VALIDATION_FAILED',
    'Some fields are invalid. Check them and try again.',
    400,
    r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

interface Viewer {
  userId: string | null;
  visible: Set<string> | null;
}
function viewer(): Viewer {
  const s = useSessionStore.getState().session;
  if (!s || s.audience !== 'workspace') return { userId: null, visible: null };
  const { me } = s;
  if (me.role.dataScope === 'all') return { userId: me.user.id, visible: null };
  if (me.role.dataScope === 'own') return { userId: me.user.id, visible: new Set([me.user.id]) };
  return { userId: me.user.id, visible: new Set([me.user.id, ...me.teamMemberIds]) };
}
const inScope = (ownerId: string | null | undefined, v = viewer()) => v.visible === null || (!!ownerId && v.visible.has(ownerId));
function ownerMatch(ownerId: string | null | undefined, filter: readonly string[] | undefined, v = viewer()) {
  if (!filter?.length) return true;
  return filter.some((f) => (f === 'me' ? ownerId === v.userId : f === 'unassigned' ? !ownerId : ownerId === f));
}

function page<T>(rows: readonly T[], q: { cursor?: unknown; limit?: unknown }) {
  const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
  const start = Number(q.cursor ?? 0) || 0;
  const items = rows.slice(start, start + limit);
  return { items: [...items], nextCursor: start + limit < rows.length ? String(start + limit) : null, total: rows.length };
}
function sortBy<T>(rows: T[], key: string | undefined, dir: unknown): T[] {
  if (!key) return rows;
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = (a as Record<string, unknown>)[key];
    const y = (b as Record<string, unknown>)[key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (x > y ? 1 : -1) * m;
  });
}
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? v.split(',') : []);
const text = (q: unknown, ...vals: Array<string | null | undefined>) => !q || vals.filter(Boolean).join(' ').toLowerCase().includes(String(q).toLowerCase());

// ---------------------------------------------------------------- seed

const id = (n: number) => `0190f5a0-0000-7000-8000-c${String(n).padStart(11, '0')}`;
const gstin = (state: string, pan: string) => {
  const first = `${state}${pan}1Z`;
  return `${first}${gstinCheckChar(first)}`;
};
const addr = (line1: string, city: string, stateCode: string, pincode: string): Address => ({ line1, line2: null, city, state: stateName(stateCode), stateCode: stateCode as IndianStateCode, pincode, country: 'IN' });

interface Store {
  accounts: Account[];
  contacts: Contact[];
  products: Product[];
  priceLists: PriceList[];
  pipelines: Pipeline[];
  deals: Deal[];
  quotations: Quotation[];
  invoices: Invoice[];
  notes: Map<string, CrmTimelineItem[]>;
  meetings: Meeting[];
  timeOff: TimeOff[];
  rules: RoutingRule[];
  forms: CaptureForm[];
  submissions: CaptureSubmission[];
  seller: SellerProfile | null;
  seq: { qt: number; inv: number; n: number };
}
let store: Store | null = null;

function db(): Store {
  noteMockUse('crm');
  return (store ??= seed());
}

function seed(): Store {
  const t = nowIso();
  const owner = (i: number) => users.filter((u) => u.role !== 'viewer')[i % Math.max(1, users.filter((u) => u.role !== 'viewer').length)] ?? null;
  const accountsSeed: Array<[string, string, string, string, string, string]> = [
    ['Mehta Traders', 'Mumbai', '27', 'AAMFM1234C', 'Distribution', '400001'],
    ['Shree Ganesh Steels', 'Pune', '27', 'AAFCS5678D', 'Manufacturing', '411001'],
    ['Karnavati Packaging', 'Ahmedabad', '24', 'AAGCK2345E', 'Packaging', '380001'],
    ['Bengaluru Office Systems', 'Bengaluru', '29', 'AABCB3456F', 'Office supplies', '560001'],
    ['Delhi Retail Hub', 'New Delhi', '07', 'AACFD4567G', 'Retail', '110001'],
    ['Chennai Agro Exports', 'Chennai', '33', 'AADFC6789H', 'Agriculture', '600001'],
  ];
  const accounts: Account[] = accountsSeed.map(([name, city, st, pan, industry, pin], i) => ({
    id: id(100 + i),
    name,
    industry,
    gstin: gstin(st, pan),
    phone: `+9198200${String(10000 + i).slice(-5)}`,
    email: `accounts@${name.toLowerCase().replace(/[^a-z]+/g, '')}.in`,
    website: `https://www.${name.toLowerCase().replace(/[^a-z]+/g, '')}.in/`,
    city,
    stateCode: st,
    owner: owner(i),
    tags: i % 2 ? ['distributor'] : [],
    contactCount: 2,
    openDealCount: 0,
    openDealValueInr: 0,
    lastActivityAt: t,
    version: 1,
    createdAt: t,
    updatedAt: t,
    pan,
    additionalPhones: [],
    additionalEmails: [],
    billingAddress: addr(`${12 + i} Market Road`, city, st, pin),
    shippingAddress: null,
    customFields: {},
    mergedIntoId: null,
  }));
  const firstNames = ['Rahul Mehta', 'Priya Shah', 'Anil Kulkarni', 'Sneha Patil', 'Vikram Desai', 'Kavya Iyer', 'Rohit Gupta', 'Neha Verma', 'Arjun Reddy', 'Meera Nair', 'Suresh Rao', 'Pooja Jain'];
  const contacts: Contact[] = firstNames.map((name, i) => {
    const a = accounts[i % accounts.length]!;
    return {
      id: id(200 + i),
      name,
      title: i % 3 === 0 ? 'Purchase manager' : i % 3 === 1 ? 'Owner' : 'Accounts',
      phone: `+9198765${String(43210 + i).slice(-5)}`,
      email: `${name.split(' ')[0]!.toLowerCase()}@${a.name.toLowerCase().replace(/[^a-z]+/g, '')}.in`,
      account: { id: a.id, name: a.name, gstin: a.gstin, city: a.city },
      city: a.city,
      stateCode: a.stateCode,
      owner: a.owner,
      tags: [],
      whatsappOptIn: i % 2 === 0 ? true : null,
      dnd: i === 11,
      leadCount: 1,
      openDealCount: 0,
      lastActivityAt: t,
      version: 1,
      createdAt: t,
      updatedAt: t,
      additionalPhones: [],
      additionalEmails: [],
      gstin: null,
      pan: null,
      billingAddress: null,
      shippingAddress: null,
      customFields: {},
      mergedIntoId: null,
    };
  });
  const productSeed: Array<[string, string, 'goods' | 'service', string, number, number]> = [
    ['RACK-HD-6', 'Heavy duty steel rack 6 ft', 'goods', '94032090', 18, 1_250_000],
    ['RACK-SL-4', 'Slotted angle rack 4 ft', 'goods', '73089090', 18, 640_000],
    ['BIN-PP-12', 'Plastic storage bin 12 L', 'goods', '39231090', 18, 32_000],
    ['PALLET-W', 'Wooden pallet', 'goods', '44152000', 12, 95_000],
    ['TAPE-48', 'Packing tape 48 mm', 'goods', '39191000', 18, 4_500],
    ['CARTON-5P', 'Corrugated carton 5 ply', 'goods', '48191010', 12, 2_800],
    ['RICE-25', 'Rice 25 kg bag', 'goods', '1006', 5, 180_000],
    ['INSTALL', 'Installation service', 'service', '995468', 18, 150_000],
    ['AMC-1Y', 'Annual maintenance contract', 'service', '998719', 18, 2_400_000],
    ['DELIVERY', 'Delivery charges', 'service', '996511', 18, 50_000],
  ];
  const products: Product[] = productSeed.map(([sku, name, kind, hsnSac, gstRate, price], i) => ({
    id: id(300 + i),
    sku,
    name,
    hsnSac,
    unit: kind === 'service' ? 'OTH' : sku.startsWith('RICE') ? 'BAG' : 'NOS',
    gstRate: gstRate as Product['gstRate'],
    unitPricePaise: price,
    active: true,
    description: null,
    kind,
    customFields: {},
    createdAt: t,
    updatedAt: t,
  }));
  const priceLists: PriceList[] = [
    {
      id: id(390),
      name: 'Dealer prices',
      description: '10% below list on racks',
      isDefault: false,
      active: true,
      validFrom: null,
      validTo: null,
      itemCount: 2,
      items: [products[0]!, products[1]!].map((p) => ({ productId: p.id, product: p, unitPricePaise: Math.round(p.unitPricePaise * 0.9) })),
      createdAt: t,
      updatedAt: t,
    },
  ];
  const pipelineId = id(400);
  const pipelines: Pipeline[] = [
    {
      id: pipelineId,
      key: 'deals',
      name: 'Deals',
      isDefault: true,
      packKey: null,
      entity: 'deal',
      stages: DEFAULT_DEAL_STAGES.map((s, i) => ({ id: id(401 + i), pipelineId, key: s.key, name: s.name, type: s.type, order: i, color: null, probability: s.probability })),
    },
  ];
  let pos: string | null = null;
  const deals: Deal[] = accounts.slice(0, 6).map((a, i) => {
    const stage = pipelines[0]!.stages[i % 4]!;
    pos = generateKeyBetween(pos, null);
    const c = contacts.find((x) => x.account?.id === a.id) ?? null;
    const value = [450_000, 120_000, 85_000, 260_000, 1_500_000, 64_000][i]!;
    return {
      id: id(500 + i),
      title: `${a.name} - ${['racks', 'bins and pallets', 'packaging', 'office fit-out', 'store racks', 'export bags'][i]}`,
      valueInr: value,
      pipelineId,
      stageId: stage.id,
      status: stage.type,
      position: pos,
      probability: stage.probability,
      weightedValueInr: Math.round((value * stage.probability) / 100),
      owner: a.owner,
      account: { id: a.id, name: a.name, gstin: a.gstin, city: a.city },
      contact: c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, accountId: a.id } : null,
      lead: null,
      expectedCloseAt: new Date(Date.now() + (i + 1) * 7 * 86_400_000).toISOString(),
      closedAt: stage.type === 'open' ? null : t,
      lostReason: null,
      lineCount: 0,
      version: 1,
      createdAt: t,
      updatedAt: t,
      description: null,
      probabilityOverride: null,
      lines: [],
      customFields: {},
    };
  });
  const seller: SellerProfile = SellerProfileSchema.parse({
    legalName: 'Shakti Storage Solutions Private Limited',
    tradeName: 'Shakti Storage',
    gstin: gstin('27', 'AAJCS9876K'),
    pan: 'AAJCS9876K',
    address: addr('Plot 21, MIDC Bhosari', 'Pune', '27', '411026'),
    phone: '+912027120000',
    email: 'sales@shaktistorage.in',
    bank: { accountName: 'Shakti Storage Solutions Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branch: 'Bhosari', upiId: 'shaktistorage@hdfcbank' },
    quotationTerms: 'Prices exclude freight. Delivery in 7 working days from the purchase order.',
    invoiceTerms: 'Payment within 15 days. Interest at 18% a year on late payment.',
  });
  const s: Store = { accounts, contacts, products, priceLists, pipelines, deals, quotations: [], invoices: [], notes: new Map(), meetings: [], timeOff: [], rules: [], forms: [], submissions: [], seller, seq: { qt: 0, inv: 0, n: 900 } };
  // Documents: one intra-state (Pune buyer) and one inter-state (Bengaluru buyer).
  s.quotations.push(makeQuotation(s, { accountId: accounts[1]!.id, lines: [{ productId: products[0]!.id, quantity: 4 }, { productId: products[7]!.id, quantity: 1 }] }, 'sent'));
  s.quotations.push(makeQuotation(s, { accountId: accounts[3]!.id, lines: [{ productId: products[1]!.id, quantity: 10 }, { productId: products[9]!.id, quantity: 1 }] }, 'draft'));
  const inv = makeInvoice(s, { accountId: accounts[0]!.id, lines: [{ productId: products[2]!.id, quantity: 50 }, { productId: products[4]!.id, quantity: 20 }] });
  issue(s, inv);
  s.invoices.push(inv);
  // Meetings this week.
  const base = Date.now() - (Date.now() % 3_600_000);
  [1, 3, 26, 50].forEach((h, i) => {
    const start = new Date(base + h * 3_600_000).toISOString();
    s.meetings.push(makeMeeting(s, { title: ['Site visit at Mehta Traders', 'Call with Priya Shah', 'Demo for Bengaluru Office Systems', 'Weekly sales review'][i]!, startAt: start, endAt: new Date(Date.parse(start) + 45 * 60_000).toISOString(), accountId: accounts[i]?.id ?? null }));
  });
  const team = users.filter((u) => u.role === 'employee').map((u) => u.id);
  s.rules.push(makeRule({ name: 'Website leads round robin', conditions: { sources: ['website'] }, userIds: team.slice(0, 3), fallbackOwnerId: users.find((u) => u.role === 'manager')?.id ?? null }, 1));
  s.rules.push(makeRule({ name: 'Big enquiries to the manager', conditions: { minValueInr: 500_000 }, userIds: users.filter((u) => u.role === 'manager').map((u) => u.id).slice(0, 1), strategy: 'least_busy' }, 2));
  s.forms.push(makeForm({ name: 'Website enquiry', fields: [
    { id: 'name', label: 'Your name', type: 'text', required: true, mapTo: 'name' },
    { id: 'phone', label: 'Mobile number', type: 'phone', required: true, mapTo: 'phone' },
    { id: 'email', label: 'Email', type: 'email', mapTo: 'email' },
    { id: 'city', label: 'City', type: 'text', mapTo: 'city' },
    { id: 'requirement', label: 'What do you need?', type: 'textarea', mapTo: 'requirement' },
  ] }, 'mockform000001'));
  recount(s);
  return s;
}

function recount(s: Store) {
  for (const a of s.accounts) {
    a.contactCount = s.contacts.filter((c) => c.account?.id === a.id).length;
    const open = s.deals.filter((d) => d.account?.id === a.id && d.status === 'open');
    a.openDealCount = open.length;
    a.openDealValueInr = open.reduce((x, d) => x + d.valueInr, 0);
  }
  for (const c of s.contacts) c.openDealCount = s.deals.filter((d) => d.contact?.id === c.id && d.status === 'open').length;
}

// ---------------------------------------------------------------- documents

function sellerState(s: Store) {
  return s.seller?.address.stateCode ?? null;
}

function partyFor(s: Store, accountId?: string | null, contactId?: string | null): Party {
  const a = s.accounts.find((x) => x.id === accountId);
  const c = s.contacts.find((x) => x.id === contactId);
  if (a) return { name: a.name, gstin: a.gstin, pan: a.pan, phone: a.phone, email: a.email, billingAddress: a.billingAddress, shippingAddress: a.shippingAddress, contactName: c?.name ?? null };
  if (c) return { name: c.name, gstin: c.gstin, pan: c.pan, phone: c.phone, email: c.email, billingAddress: c.billingAddress, shippingAddress: c.shippingAddress, contactName: null };
  return { name: 'Walk-in customer', gstin: null, pan: null, phone: null, email: null, billingAddress: null, shippingAddress: null, contactName: null };
}

function linesFor(s: Store, inputs: readonly Partial<LineItemInput>[], priceListId: string | null | undefined, pos: string | null) {
  const list = s.priceLists.find((p) => p.id === priceListId);
  const resolved = inputs.map((l, i) => {
    const p = s.products.find((x) => x.id === l.productId);
    if (l.productId && !p) fail('VALIDATION_FAILED', 'A product on this document no longer exists.', 400, [{ path: `lines.${i}.productId`, message: 'Pick another product' }]);
    const price = l.unitPricePaise ?? list?.items?.find((x) => x.productId === p?.id)?.unitPricePaise ?? p?.unitPricePaise ?? 0;
    return {
      productId: p?.id ?? null,
      name: l.name ?? p?.name ?? 'Item',
      description: l.description ?? p?.description ?? null,
      hsnSac: l.hsnSac ?? p?.hsnSac ?? null,
      unit: l.unit ?? p?.unit ?? 'NOS',
      quantity: l.quantity ?? 1,
      unitPricePaise: price,
      discountKind: l.discountKind ?? 'percent',
      discountValue: l.discountValue ?? 0,
      gstRate: (l.gstRate ?? p?.gstRate ?? 18) as LineItem['gstRate'],
    };
  });
  const { lines, totals } = computeDocument(resolved, { sellerStateCode: sellerState(s), placeOfSupplyStateCode: pos });
  return { lines: lines.map((l, i) => ({ ...l, id: uuid4(), position: i, gstRate: l.gstRate as LineItem['gstRate'] })) as LineItem[], totals };
}

const defaultPos = (s: Store, buyer: Party) => buyer.shippingAddress?.stateCode ?? buyer.billingAddress?.stateCode ?? sellerState(s);
const refsFor = (s: Store, accountId?: string | null, contactId?: string | null) => {
  const a = s.accounts.find((x) => x.id === accountId);
  const c = s.contacts.find((x) => x.id === contactId);
  return { account: a ? { id: a.id, name: a.name, gstin: a.gstin, city: a.city } : null, contact: c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, accountId: c.account?.id ?? null } : null };
};
const noShare = { active: false, expiresAt: null, lastSharedAt: null };

function makeQuotation(s: Store, input: Record<string, unknown>, status: Quotation['status'] = 'draft'): Quotation {
  const b = parse(QuotationCreateSchema, input);
  const buyer = b.buyer ?? partyFor(s, b.accountId, b.contactId);
  const pos = b.placeOfSupplyStateCode ?? defaultPos(s, buyer);
  const { lines, totals } = linesFor(s, b.lines, b.priceListId, pos);
  const issueDate = b.issueDate ?? today();
  const fy = financialYearOf(issueDate);
  s.seq.qt += 1;
  const t = nowIso();
  const v = viewer();
  return {
    id: uuid4(),
    number: formatDocumentNumber(s.seller?.quotationPrefix ?? 'QT', fy, s.seq.qt),
    status,
    issueDate,
    validUntil: b.validUntil ?? addDaysIso(issueDate, s.seller?.quotationValidityDays ?? 15),
    buyerName: buyer.name,
    owner: userById(b.ownerId ?? v.userId) ?? users[0] ?? null,
    ...refsFor(s, b.accountId, b.contactId),
    dealId: b.dealId ?? null,
    lead: null,
    taxMode: totals.taxMode,
    totalPaise: totals.totalPaise,
    convertedInvoiceId: null,
    sentAt: status === 'sent' ? t : null,
    version: 1,
    createdAt: t,
    updatedAt: t,
    seller: s.seller,
    buyer,
    placeOfSupplyStateCode: pos,
    priceListId: b.priceListId ?? null,
    lines,
    totals,
    notes: b.notes ?? null,
    terms: b.terms ?? s.seller?.quotationTerms ?? null,
    share: noShare,
    acceptedAt: null,
    rejectedAt: null,
    statusReason: null,
  };
}

function makeInvoice(s: Store, input: Record<string, unknown>): Invoice {
  const b = parse(InvoiceCreateSchema, input);
  const buyer = b.buyer ?? partyFor(s, b.accountId, b.contactId);
  const pos = b.placeOfSupplyStateCode ?? defaultPos(s, buyer);
  const { lines, totals } = linesFor(s, b.lines, b.priceListId, pos);
  const issueDate = b.issueDate ?? today();
  const t = nowIso();
  const v = viewer();
  return {
    id: uuid4(),
    number: null,
    status: 'draft',
    issueDate,
    dueDate: b.dueDate ?? addDaysIso(issueDate, s.seller?.paymentTermsDays ?? 15),
    buyerName: buyer.name,
    owner: userById(b.ownerId ?? v.userId) ?? users[0] ?? null,
    ...refsFor(s, b.accountId, b.contactId),
    dealId: b.dealId ?? null,
    lead: null,
    quotationId: null,
    taxMode: totals.taxMode,
    totalPaise: totals.totalPaise,
    paidPaise: 0,
    balancePaise: totals.totalPaise,
    overdue: false,
    issuedAt: null,
    version: 1,
    createdAt: t,
    updatedAt: t,
    seller: s.seller,
    buyer,
    placeOfSupplyStateCode: pos,
    priceListId: b.priceListId ?? null,
    lines,
    totals,
    notes: b.notes ?? null,
    terms: b.terms ?? s.seller?.invoiceTerms ?? null,
    share: noShare,
    payments: [],
    cancelledAt: null,
    cancelReason: null,
  };
}

function issue(s: Store, inv: Invoice, issueDate?: string) {
  if (!s.seller?.address.stateCode) fail('SELLER_PROFILE_INCOMPLETE', 'Add your legal name and state in Settings > GST and billing first.', 422);
  s.seq.inv += 1;
  inv.issueDate = issueDate ?? inv.issueDate;
  inv.number = formatDocumentNumber(s.seller.invoicePrefix, financialYearOf(inv.issueDate), s.seq.inv);
  inv.status = 'issued';
  inv.issuedAt = nowIso();
}

function share(token: string, days = 30, title = 'document'): DocumentShare {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const url = `${origin}${documentHostedPath(token)}`;
  return { url, pdfUrl: `${url}/pdf`, expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(), message: `Please find the ${title} here: ${url}` };
}

/** Mock data mode: nothing leaves the browser; the result says so (via "mock"). */
function mockDelivery(body: { channel: 'email'; to: string[]; cc?: string[] } | { channel: 'whatsapp'; to?: string }, sh: DocumentShare, buyer: { phone: string | null }): DocumentDeliveryResult {
  const to = body.channel === 'email' ? [...body.to, ...(body.cc ?? [])] : [body.to ?? buyer.phone ?? ''];
  if (body.channel === 'whatsapp' && !to[0]) fail('VALIDATION_FAILED', 'Give the WhatsApp number of the customer', 422);
  return { channel: body.channel, status: 'sent', via: 'mock', to, messageId: `mock-${uuid4()}`, conversationId: null, error: null, share: sh, sentAt: nowIso() };
}

function fakePdf(title: string) {
  const body = `%PDF-1.4\n% ${title} (mock data mode)\n%%EOF\n`;
  return { blob: new Blob([body], { type: 'application/pdf' }), filename: `${title.replace(/\//g, '-')}.pdf` };
}

// ---------------------------------------------------------------- calendar, routing, capture

function makeMeeting(s: Store, input: Record<string, unknown>): Meeting {
  const b = parse(MeetingCreateSchema, input);
  const v = viewer();
  const organizer = userById(b.organizerId ?? v.userId) ?? users[0] ?? null;
  const a = s.accounts.find((x) => x.id === b.accountId);
  const c = s.contacts.find((x) => x.id === b.contactId);
  const d = s.deals.find((x) => x.id === b.dealId);
  const t = nowIso();
  return {
    id: uuid4(),
    title: b.title,
    description: b.description ?? null,
    mode: b.mode,
    location: b.location ?? null,
    videoUrl: b.videoUrl ?? null,
    startAt: b.startAt,
    endAt: b.endAt,
    allDay: b.allDay,
    timezone: b.timezone ?? 'Asia/Kolkata',
    status: 'scheduled',
    organizer,
    attendees: [
      ...(organizer ? [{ id: uuid4(), userId: organizer.id, contactId: null, name: organizer.name, email: null, response: 'accepted' as const, isOrganizer: true }] : []),
      ...b.attendeeUserIds.map((u) => ({ id: uuid4(), userId: u, contactId: null, name: userById(u)?.name ?? 'Team member', email: null, response: 'pending' as const, isOrganizer: false })),
      ...b.attendeeContactIds.map((cid) => ({ id: uuid4(), userId: null, contactId: cid, name: s.contacts.find((x) => x.id === cid)?.name ?? 'Contact', email: null, response: 'pending' as const, isOrganizer: false })),
      ...b.guests.map((g) => ({ id: uuid4(), userId: null, contactId: null, name: g.name, email: g.email, response: 'pending' as const, isOrganizer: false })),
    ],
    lead: null,
    contact: c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, accountId: c.account?.id ?? null } : null,
    account: a ? { id: a.id, name: a.name, gstin: a.gstin, city: a.city } : null,
    deal: d ? { id: d.id, title: d.title } : null,
    reminders: b.reminders,
    recurrence: b.recurrence ?? null,
    exceptionDates: [],
    occurrenceStart: null,
    seriesId: null,
    outcome: null,
    cancelReason: null,
    version: 1,
    createdAt: t,
    updatedAt: t,
  };
}

function makeRule(input: Record<string, unknown>, priority: number): RoutingRule {
  const b = parse(RoutingRuleCreateSchema, input);
  const t = nowIso();
  return {
    id: uuid4(),
    name: b.name,
    active: b.active,
    priority,
    conditions: b.conditions,
    strategy: b.strategy,
    team: null,
    users: b.userIds.map((u) => userById(u)).filter((u): u is UserSummary => !!u),
    respectWorkingHours: b.respectWorkingHours,
    respectAvailability: b.respectAvailability,
    requireOnline: b.requireOnline,
    fallbackOwner: userById(b.fallbackOwnerId),
    lastAssignedUserId: null,
    assignedCount: 0,
    lastAssignedAt: null,
    createdAt: t,
    updatedAt: t,
  };
}

function makeForm(input: Record<string, unknown>, key = uuid4().replace(/-/g, '').slice(0, 16)): CaptureForm {
  const b = parse(CaptureFormCreateSchema, input);
  const t = nowIso();
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const hostedUrl = `${origin}${captureFormHostedPath(key)}`;
  return {
    id: uuid4(),
    key,
    name: b.name,
    status: b.status,
    fields: b.fields,
    settings: b.settings,
    submissionCount: 0,
    lastSubmissionAt: null,
    hostedUrl,
    embedHtml: `<iframe src="${hostedUrl}" title="${b.name}" style="width:100%;border:0" loading="lazy"></iframe>`,
    createdAt: t,
    updatedAt: t,
  };
}

function decide(s: Store, lead: z.output<typeof RoutingTestSchema>['lead']) {
  const ordered = [...s.rules].sort((a, b) => a.priority - b.priority);
  const checked = ordered.map((r) => {
    const misses = r.active ? routingConditionMisses(r.conditions, lead) : ['paused'];
    return { id: r.id, name: r.name, matched: misses.length === 0, reasons: misses.map((m) => (m === 'paused' ? 'rule is paused' : `${m} does not match`)) };
  });
  const hit = ordered.find((r, i) => checked[i]!.matched);
  if (!hit) return { outcome: 'no_rule' as const, rule: null, owner: null, rules: checked, candidates: [] };
  const pool = hit.users.map((u) => u.id);
  const eligible = new Set(pool);
  const pick = hit.strategy === 'round_robin' ? nextRoundRobin(pool, eligible, hit.lastAssignedUserId) : (pool[0] ?? null);
  const owner = userById(pick) ?? hit.fallbackOwner;
  return {
    outcome: pick ? ('rule' as const) : hit.fallbackOwner ? ('fallback' as const) : ('no_eligible_user' as const),
    rule: { id: hit.id, name: hit.name, strategy: hit.strategy },
    owner,
    rules: checked,
    candidates: hit.users.map((u) => ({ user: u, eligible: true, reasons: [], openLeads: 0 })),
  };
}

// ---------------------------------------------------------------- source

const timelineOf = (s: Store, key: string) => s.notes.get(key) ?? [];
const addNote = (s: Store, key: string, body: string): CrmTimelineItem => {
  const v = viewer();
  const item: CrmTimelineItem = { id: `note:${uuid4()}`, kind: 'note', at: nowIso(), actor: userById(v.userId), title: 'Note', body, ref: null };
  s.notes.set(key, [item, ...timelineOf(s, key)]);
  return item;
};
const emptyRelated = { contacts: [], leads: [], deals: [], quotations: [], invoices: [], meetings: [] };

function bulkOn<T extends { id: string; owner: UserSummary | null; tags?: string[] }>(list: T[], action: { action: string; ids: string[]; ownerId?: string | null; tags?: string[] }, remove: (id: string) => void) {
  let succeeded = 0;
  for (const rid of action.ids) {
    const r = list.find((x) => x.id === rid);
    if (!r || !inScope(r.owner?.id)) continue;
    succeeded += 1;
    if (action.action === 'assign') r.owner = userById(action.ownerId);
    if (action.action === 'add_tags' && r.tags) r.tags = [...new Set([...r.tags, ...(action.tags ?? [])])];
    if (action.action === 'remove_tags' && r.tags) r.tags = r.tags.filter((t) => !(action.tags ?? []).includes(t));
    if (action.action === 'delete') remove(rid);
  }
  return { succeeded, failed: [] };
}

function bumped<T extends { version: number; updatedAt: string }>(r: T): T {
  r.version += 1;
  r.updatedAt = nowIso();
  return r;
}

const notFound = (what: string): never => fail('NOT_FOUND', `This ${what} was not found. It may have been deleted.`, 404);

export const mockCrmSource: CrmSource = {
  contacts: {
    async list(q) {
      await delay();
      const s = db();
      const rows = s.contacts.filter((c) => !c.mergedIntoId && inScope(c.owner?.id) && ownerMatch(c.owner?.id, arr(q.ownerId)) && text(q.q, c.name, c.phone, c.email, c.gstin, c.account?.name) && (!arr(q.stateCode).length || arr(q.stateCode).includes(c.stateCode ?? '')) && (!arr(q.tag).length || arr(q.tag).some((t) => c.tags.includes(t))) && (!q.accountId || c.account?.id === q.accountId));
      return page(sortBy(rows, String(q.sort ?? 'createdAt'), q.dir ?? 'desc'), q);
    },
    async get(cid) {
      await delay();
      return db().contacts.find((c) => c.id === cid && inScope(c.owner?.id)) ?? notFound('contact');
    },
    async create(body) {
      await delay();
      const s = db();
      const b = parse(ContactCreateSchema, body);
      if (b.phone && s.contacts.some((c) => c.phone === b.phone)) fail('CONFLICT', 'A contact with this phone number already exists.', 409, [{ path: 'phone', message: 'Another contact has this number' }]);
      const t = nowIso();
      const a = s.accounts.find((x) => x.id === b.accountId);
      const c: Contact = { id: uuid4(), name: b.name, title: b.title ?? null, phone: b.phone ?? null, email: b.email ?? null, account: a ? { id: a.id, name: a.name, gstin: a.gstin, city: a.city } : null, city: b.city ?? null, stateCode: b.billingAddress?.stateCode ?? null, owner: userById(b.ownerId ?? viewer().userId), tags: b.tags, whatsappOptIn: null, dnd: b.dnd ?? false, leadCount: 0, openDealCount: 0, lastActivityAt: null, version: 1, createdAt: t, updatedAt: t, additionalPhones: b.additionalPhones, additionalEmails: b.additionalEmails, gstin: b.gstin ?? null, pan: b.pan ?? null, billingAddress: b.billingAddress ?? null, shippingAddress: b.shippingAddress ?? null, customFields: b.customFields, mergedIntoId: null };
      s.contacts.unshift(c);
      recount(s);
      return c;
    },
    async update(cid, patch) {
      await delay();
      const s = db();
      const c = s.contacts.find((x) => x.id === cid) ?? notFound('contact');
      const p = parse(ContactUpdateSchema, patch);
      if (p.expectedVersion !== undefined && p.expectedVersion !== c.version) fail('VERSION_CONFLICT', 'Someone changed this contact. Reload and try again.', 409);
      const { accountId, ownerId, expectedVersion: _v, customFields, ...rest } = p;
      Object.assign(c, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (accountId !== undefined) {
        const a = s.accounts.find((x) => x.id === accountId);
        c.account = a ? { id: a.id, name: a.name, gstin: a.gstin, city: a.city } : null;
      }
      if (ownerId !== undefined) c.owner = userById(ownerId);
      if (customFields) c.customFields = Object.fromEntries(Object.entries({ ...c.customFields, ...customFields }).filter(([, v]) => v !== null));
      c.stateCode = c.billingAddress?.stateCode ?? c.stateCode;
      recount(s);
      return bumped(c);
    },
    async remove(cid) {
      await delay();
      const s = db();
      s.contacts = s.contacts.filter((c) => c.id !== cid);
    },
    async bulk(action) {
      await delay();
      const s = db();
      return bulkOn(s.contacts, action as never, (rid) => (s.contacts = s.contacts.filter((c) => c.id !== rid)));
    },
    async merge(body) {
      await delay();
      const s = db();
      const primary = s.contacts.find((c) => c.id === body.primaryId) ?? notFound('contact');
      for (const d of body.duplicateIds) {
        const dup = s.contacts.find((c) => c.id === d);
        if (!dup || dup.id === primary.id) fail('RECORD_MERGE_INVALID', 'Pick other contacts to merge.', 400);
        dup.mergedIntoId = primary.id;
        primary.email ??= dup.email;
        primary.phone ??= dup.phone;
      }
      return bumped(primary);
    },
    async duplicates(cid) {
      await delay();
      const s = db();
      const c = s.contacts.find((x) => x.id === cid) ?? notFound('contact');
      return { items: s.contacts.filter((x) => x.id !== c.id && !x.mergedIntoId && ((x.email && x.email === c.email) || x.name.toLowerCase() === c.name.toLowerCase())) };
    },
    async related(cid) {
      await delay();
      const s = db();
      return { ...emptyRelated, deals: s.deals.filter((d) => d.contact?.id === cid), quotations: s.quotations.filter((q) => q.contact?.id === cid), invoices: s.invoices.filter((i) => i.contact?.id === cid), meetings: s.meetings.filter((m) => m.contact?.id === cid) };
    },
    async timeline(cid, cursor) {
      await delay();
      return page(timelineOf(db(), `contact:${cid}`), { cursor, limit: 30 });
    },
    async addNote(cid, body) {
      await delay();
      return addNote(db(), `contact:${cid}`, body);
    },
  },
  accounts: {
    async list(q) {
      await delay();
      const s = db();
      const rows = s.accounts.filter((a) => !a.mergedIntoId && inScope(a.owner?.id) && ownerMatch(a.owner?.id, arr(q.ownerId)) && text(q.q, a.name, a.gstin, a.phone, a.email, a.website) && (!arr(q.stateCode).length || arr(q.stateCode).includes(a.stateCode ?? '')) && (!arr(q.tag).length || arr(q.tag).some((t) => a.tags.includes(t))));
      return page(sortBy(rows, String(q.sort ?? 'createdAt'), q.dir ?? 'desc'), q);
    },
    async get(aid) {
      await delay();
      return db().accounts.find((a) => a.id === aid && inScope(a.owner?.id)) ?? notFound('account');
    },
    async create(body) {
      await delay();
      const s = db();
      const b = parse(AccountCreateSchema, body);
      const t = nowIso();
      const a: Account = { id: uuid4(), name: b.name, industry: b.industry ?? null, gstin: b.gstin ?? null, phone: b.phone ?? null, email: b.email ?? null, website: b.website ?? null, city: b.billingAddress?.city ?? null, stateCode: b.billingAddress?.stateCode ?? null, owner: userById(b.ownerId ?? viewer().userId), tags: b.tags, contactCount: 0, openDealCount: 0, openDealValueInr: 0, lastActivityAt: null, version: 1, createdAt: t, updatedAt: t, pan: b.pan ?? null, additionalPhones: b.additionalPhones, additionalEmails: b.additionalEmails, billingAddress: b.billingAddress ?? null, shippingAddress: b.shippingAddress ?? null, customFields: b.customFields, mergedIntoId: null };
      s.accounts.unshift(a);
      return a;
    },
    async update(aid, patch) {
      await delay();
      const s = db();
      const a = s.accounts.find((x) => x.id === aid) ?? notFound('account');
      const p = parse(AccountUpdateSchema, patch);
      if (p.expectedVersion !== undefined && p.expectedVersion !== a.version) fail('VERSION_CONFLICT', 'Someone changed this account. Reload and try again.', 409);
      const { ownerId, expectedVersion: _v, customFields, ...rest } = p;
      Object.assign(a, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)));
      if (ownerId !== undefined) a.owner = userById(ownerId);
      if (customFields) a.customFields = Object.fromEntries(Object.entries({ ...a.customFields, ...customFields }).filter(([, v]) => v !== null));
      a.city = a.billingAddress?.city ?? a.city;
      a.stateCode = a.billingAddress?.stateCode ?? a.stateCode;
      return bumped(a);
    },
    async remove(aid) {
      await delay();
      const s = db();
      s.accounts = s.accounts.filter((a) => a.id !== aid);
    },
    async bulk(action) {
      await delay();
      const s = db();
      return bulkOn(s.accounts, action as never, (rid) => (s.accounts = s.accounts.filter((a) => a.id !== rid)));
    },
    async merge(body) {
      await delay();
      const s = db();
      const primary = s.accounts.find((a) => a.id === body.primaryId) ?? notFound('account');
      for (const d of body.duplicateIds) {
        const dup = s.accounts.find((a) => a.id === d);
        if (!dup || dup.id === primary.id) fail('RECORD_MERGE_INVALID', 'Pick other accounts to merge.', 400);
        dup.mergedIntoId = primary.id;
        for (const c of s.contacts) if (c.account?.id === dup.id) c.account = { id: primary.id, name: primary.name, gstin: primary.gstin, city: primary.city };
      }
      recount(s);
      return bumped(primary);
    },
    async duplicates(aid) {
      await delay();
      const s = db();
      const a = s.accounts.find((x) => x.id === aid) ?? notFound('account');
      return { items: s.accounts.filter((x) => x.id !== a.id && !x.mergedIntoId && ((x.gstin && x.gstin === a.gstin) || x.name.toLowerCase() === a.name.toLowerCase())) };
    },
    async related(aid) {
      await delay();
      const s = db();
      return { ...emptyRelated, contacts: s.contacts.filter((c) => c.account?.id === aid), deals: s.deals.filter((d) => d.account?.id === aid), quotations: s.quotations.filter((q) => q.account?.id === aid), invoices: s.invoices.filter((i) => i.account?.id === aid), meetings: s.meetings.filter((m) => m.account?.id === aid) };
    },
    async timeline(aid, cursor) {
      await delay();
      return page(timelineOf(db(), `account:${aid}`), { cursor, limit: 30 });
    },
    async addNote(aid, body) {
      await delay();
      return addNote(db(), `account:${aid}`, body);
    },
  },
  deals: {
    async pipelines() {
      await delay();
      return { items: db().pipelines };
    },
    async list(q) {
      await delay();
      const s = db();
      const rows = s.deals.filter((d) => inScope(d.owner?.id) && ownerMatch(d.owner?.id, arr(q.ownerId)) && text(q.q, d.title, d.account?.name, d.contact?.name) && (!arr(q.status).length || arr(q.status).includes(d.status)) && (!arr(q.stageId).length || arr(q.stageId).includes(d.stageId)));
      return page(sortBy(rows, String(q.sort ?? 'createdAt'), q.dir ?? 'desc'), q);
    },
    async board(q) {
      await delay();
      const s = db();
      const pipeline = s.pipelines[0]!;
      const rows = s.deals.filter((d) => inScope(d.owner?.id) && ownerMatch(d.owner?.id, arr(q.ownerId)) && text(q.q, d.title, d.account?.name, d.contact?.name) && (!arr(q.status).length || arr(q.status).includes(d.status)));
      return {
        pipeline,
        columns: pipeline.stages.map((stage) => {
          const deals = rows.filter((d) => d.stageId === stage.id).sort((a, b) => (a.position < b.position ? -1 : 1));
          return { stage, count: deals.length, totalValueInr: deals.reduce((x, d) => x + d.valueInr, 0), weightedValueInr: deals.reduce((x, d) => x + d.weightedValueInr, 0), deals, nextCursor: null };
        }),
      };
    },
    async get(did) {
      await delay();
      return db().deals.find((d) => d.id === did && inScope(d.owner?.id)) ?? notFound('deal');
    },
    async create(body) {
      await delay();
      const s = db();
      const b = parse(DealCreateSchema, body);
      const pipeline = s.pipelines[0]!;
      const stage = pipeline.stages.find((x) => x.id === b.stageId) ?? pipeline.stages[0]!;
      const { lines } = linesFor(s, b.lines, null, sellerState(s));
      const value = lines.length ? Math.round(lines.reduce((x, l) => x + l.taxablePaise, 0) / 100) : b.valueInr;
      const last = s.deals.filter((d) => d.stageId === stage.id).sort((a, x) => (a.position < x.position ? -1 : 1)).at(-1);
      const t = nowIso();
      const refs = refsFor(s, b.accountId, b.contactId);
      const prob = b.probability ?? stage.probability;
      const d: Deal = { id: uuid4(), title: b.title, valueInr: value, pipelineId: pipeline.id, stageId: stage.id, status: stage.type, position: generateKeyBetween(last?.position ?? null, null), probability: prob, weightedValueInr: Math.round((value * prob) / 100), owner: userById(b.ownerId ?? viewer().userId), ...refs, lead: null, expectedCloseAt: b.expectedCloseAt ?? null, closedAt: null, lostReason: null, lineCount: lines.length, version: 1, createdAt: t, updatedAt: t, description: b.description ?? null, probabilityOverride: b.probability ?? null, lines, customFields: b.customFields };
      s.deals.unshift(d);
      recount(s);
      return d;
    },
    async update(did, patch) {
      await delay();
      const s = db();
      const d = s.deals.find((x) => x.id === did) ?? notFound('deal');
      if (patch.expectedVersion !== undefined && patch.expectedVersion !== d.version) fail('VERSION_CONFLICT', 'Someone changed this deal. Reload and try again.', 409);
      if (patch.title !== undefined) d.title = patch.title;
      if (patch.description !== undefined) d.description = patch.description;
      if (patch.expectedCloseAt !== undefined) d.expectedCloseAt = patch.expectedCloseAt;
      if (patch.ownerId !== undefined) d.owner = userById(patch.ownerId);
      if (patch.accountId !== undefined || patch.contactId !== undefined) Object.assign(d, refsFor(s, patch.accountId ?? d.account?.id, patch.contactId ?? d.contact?.id));
      if (patch.lines) {
        const { lines } = linesFor(s, patch.lines, null, sellerState(s));
        d.lines = lines;
        d.lineCount = lines.length;
      }
      d.valueInr = d.lines.length ? Math.round(d.lines.reduce((x, l) => x + l.taxablePaise, 0) / 100) : (patch.valueInr ?? d.valueInr);
      if (patch.stageId) {
        const stage = s.pipelines[0]!.stages.find((x) => x.id === patch.stageId);
        if (stage) Object.assign(d, { stageId: stage.id, status: stage.type });
      }
      if (patch.probability !== undefined) d.probabilityOverride = patch.probability;
      const stageProb = s.pipelines[0]!.stages.find((x) => x.id === d.stageId)?.probability ?? 0;
      d.probability = d.probabilityOverride ?? stageProb;
      d.weightedValueInr = Math.round((d.valueInr * d.probability) / 100);
      if (patch.customFields) d.customFields = Object.fromEntries(Object.entries({ ...d.customFields, ...patch.customFields }).filter(([, v]) => v !== null));
      recount(s);
      return bumped(d);
    },
    async move(did, mv) {
      await delay();
      const s = db();
      const d = s.deals.find((x) => x.id === did) ?? notFound('deal');
      const stage = s.pipelines[0]!.stages.find((x) => x.id === mv.stageId) ?? notFound('stage');
      const col = s.deals.filter((x) => x.stageId === stage.id && x.id !== d.id).sort((a, b) => (a.position < b.position ? -1 : 1));
      const before = col.find((x) => x.id === mv.beforeDealId)?.position ?? (mv.afterDealId ? null : (col.at(-1)?.position ?? null));
      const after = col.find((x) => x.id === mv.afterDealId)?.position ?? null;
      d.position = generateKeyBetween(before, after && before && after <= before ? null : after);
      d.stageId = stage.id;
      d.status = stage.type;
      d.probability = d.probabilityOverride ?? stage.probability;
      d.weightedValueInr = Math.round((d.valueInr * d.probability) / 100);
      d.lostReason = stage.type === 'lost' ? (mv.lostReason ?? null) : null;
      d.closedAt = stage.type === 'open' ? null : nowIso();
      recount(s);
      return bumped(d);
    },
    async remove(did) {
      await delay();
      const s = db();
      s.deals = s.deals.filter((d) => d.id !== did);
      recount(s);
    },
    async bulk(action) {
      await delay();
      const s = db();
      let succeeded = 0;
      for (const did of action.ids) {
        const d = s.deals.find((x) => x.id === did);
        if (!d || !inScope(d.owner?.id)) continue;
        succeeded += 1;
        if (action.action === 'assign') d.owner = userById(action.ownerId);
        if (action.action === 'change_stage') {
          const stage = s.pipelines[0]!.stages.find((x) => x.id === action.stageId);
          if (stage) Object.assign(d, { stageId: stage.id, status: stage.type, probability: d.probabilityOverride ?? stage.probability });
        }
        if (action.action === 'delete') s.deals = s.deals.filter((x) => x.id !== did);
      }
      recount(s);
      return { succeeded, failed: [] };
    },
    async related(did) {
      await delay();
      const s = db();
      return { ...emptyRelated, quotations: s.quotations.filter((q) => q.dealId === did), invoices: s.invoices.filter((i) => i.dealId === did), meetings: s.meetings.filter((m) => m.deal?.id === did) };
    },
    async timeline(did, cursor) {
      await delay();
      return page(timelineOf(db(), `deal:${did}`), { cursor, limit: 30 });
    },
    async addNote(did, body) {
      await delay();
      return addNote(db(), `deal:${did}`, body);
    },
    async convertLead(leadId, body) {
      await delay();
      const s = db();
      const lead = await mockLeadsSource.get(leadId);
      const contact = await mockCrmSource.contacts.create({ name: lead.name, phone: lead.phone, email: lead.email, city: lead.city });
      const account = lead.companyName && body.account?.mode !== 'none' ? await mockCrmSource.accounts.create({ name: lead.companyName }) : null;
      const deal = body.deal === null ? null : await mockCrmSource.deals.create({ title: body.deal?.title ?? `${lead.companyName ?? lead.name} deal`, valueInr: body.deal?.valueInr ?? lead.valueInr, accountId: account?.id ?? null, contactId: contact.id });
      recount(s);
      return { leadId, contact, account, deal };
    },
  },
  products: {
    async list(q) {
      await delay();
      const s = db();
      const rates = arr(q.gstRate).map(Number);
      const active = q.active === undefined || q.active === null ? undefined : String(q.active) === 'true';
      const rows = s.products.filter((p) => text(q.q, p.name, p.sku, p.hsnSac) && (active === undefined || p.active === active) && (!q.kind || p.kind === q.kind) && (!rates.length || rates.includes(p.gstRate)));
      return page(sortBy(rows, String(q.sort ?? 'name'), q.dir ?? 'asc'), q);
    },
    async get(pid) {
      await delay();
      return db().products.find((p) => p.id === pid) ?? notFound('product');
    },
    async create(body) {
      await delay();
      const s = db();
      const b = parse(ProductCreateSchema, body);
      if (s.products.some((p) => p.sku.toLowerCase() === b.sku.toLowerCase())) fail('PRODUCT_SKU_TAKEN', 'Another product has this SKU.', 409, [{ path: 'sku', message: 'This SKU is taken' }]);
      const t = nowIso();
      const p: Product = { id: uuid4(), ...b, createdAt: t, updatedAt: t };
      s.products.unshift(p);
      return p;
    },
    async update(pid, patch) {
      await delay();
      const p = db().products.find((x) => x.id === pid) ?? notFound('product');
      const { expectedUpdatedAt: _u, ...rest } = patch;
      Object.assign(p, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: nowIso() });
      return p;
    },
    async remove(pid) {
      await delay();
      const s = db();
      s.products = s.products.filter((p) => p.id !== pid);
    },
    async priceLists() {
      await delay();
      return { items: db().priceLists.map(({ items: _i, ...l }) => l) };
    },
    async priceList(lid) {
      await delay();
      return db().priceLists.find((l) => l.id === lid) ?? notFound('price list');
    },
    async createPriceList(body) {
      await delay();
      const s = db();
      const b = parse(PriceListCreateSchema, body);
      const t = nowIso();
      if (b.isDefault) s.priceLists.forEach((l) => (l.isDefault = false));
      const items = b.items.map((i) => ({ productId: i.productId, product: s.products.find((p) => p.id === i.productId)!, unitPricePaise: i.unitPricePaise })).filter((i) => i.product);
      const l: PriceList = { id: uuid4(), name: b.name, description: b.description, isDefault: b.isDefault, active: b.active, validFrom: b.validFrom, validTo: b.validTo, itemCount: items.length, items, createdAt: t, updatedAt: t };
      s.priceLists.push(l);
      return l;
    },
    async updatePriceList(lid, patch) {
      await delay();
      const s = db();
      const l = s.priceLists.find((x) => x.id === lid) ?? notFound('price list');
      if (patch.isDefault) s.priceLists.forEach((x) => (x.isDefault = false));
      const { items, ...rest } = patch;
      Object.assign(l, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: nowIso() });
      if (items) {
        l.items = items.map((i) => ({ productId: i.productId, product: s.products.find((p) => p.id === i.productId)!, unitPricePaise: i.unitPricePaise })).filter((i) => i.product);
        l.itemCount = l.items.length;
      }
      return l;
    },
    async removePriceList(lid) {
      await delay();
      const s = db();
      s.priceLists = s.priceLists.filter((l) => l.id !== lid);
    },
  },
  billing: {
    async profile() {
      await delay();
      const s = db();
      return { profile: s.seller, stateCode: sellerState(s), complete: !!s.seller?.legalName && !!s.seller.address.stateCode };
    },
    async saveProfile(body) {
      await delay();
      const s = db();
      s.seller = parse(SellerProfileSchema, body);
      return { profile: s.seller, stateCode: sellerState(s), complete: true };
    },
  },
  quotations: {
    async list(q) {
      await delay();
      const s = db();
      const rows = s.quotations.filter((d) => inScope(d.owner?.id) && ownerMatch(d.owner?.id, arr(q.ownerId)) && text(q.q, d.number, d.buyerName) && (!arr(q.status).length || arr(q.status).includes(d.status)) && (!q.accountId || d.account?.id === q.accountId) && (!q.dealId || d.dealId === q.dealId));
      return page(sortBy(rows, String(q.sort ?? 'issueDate'), q.dir ?? 'desc'), q);
    },
    async get(qid) {
      await delay();
      return db().quotations.find((d) => d.id === qid && inScope(d.owner?.id)) ?? notFound('quotation');
    },
    async create(body) {
      await delay();
      const s = db();
      const d = makeQuotation(s, body as Record<string, unknown>);
      s.quotations.unshift(d);
      return d;
    },
    async update(qid, patch) {
      await delay();
      const s = db();
      const d = s.quotations.find((x) => x.id === qid) ?? notFound('quotation');
      if (d.status !== 'draft') fail('DOCUMENT_STATE_INVALID', 'Only drafts can be edited. Reopen the quotation as a draft first.', 409);
      const next = makeQuotation(s, { ...patch, lines: patch.lines ?? d.lines.map((l) => ({ productId: l.productId, name: l.name, hsnSac: l.hsnSac, unit: l.unit, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountKind: l.discountKind, discountValue: l.discountValue, gstRate: l.gstRate })) });
      s.seq.qt -= 1;
      Object.assign(d, { ...next, id: d.id, number: d.number, createdAt: d.createdAt, status: d.status, version: d.version });
      return bumped(d);
    },
    async remove(qid) {
      await delay();
      const s = db();
      s.quotations = s.quotations.filter((d) => d.id !== qid);
    },
    async setStatus(qid, body) {
      await delay();
      const d = db().quotations.find((x) => x.id === qid) ?? notFound('quotation');
      if (!QUOTATION_TRANSITIONS[d.status].includes(body.status)) fail('DOCUMENT_STATE_INVALID', `A ${d.status} quotation cannot become ${body.status}.`, 409);
      d.status = body.status;
      d.statusReason = body.reason ?? null;
      if (body.status === 'accepted') d.acceptedAt = nowIso();
      if (body.status === 'rejected') d.rejectedAt = nowIso();
      return bumped(d);
    },
    async send(qid, body) {
      await delay();
      const s = db();
      const d = s.quotations.find((x) => x.id === qid) ?? notFound('quotation');
      if (!s.seller?.address.stateCode) fail('SELLER_PROFILE_INCOMPLETE', 'Add your legal name and state in Settings > GST and billing first.', 422);
      d.status = 'sent';
      d.sentAt = nowIso();
      const sh = share(uuid4().replace(/-/g, ''), body.expiresInDays, `quotation ${d.number}`);
      d.share = { active: true, expiresAt: sh.expiresAt, lastSharedAt: nowIso() };
      return { quotation: bumped(d), share: sh };
    },
    async deliver(qid, body) {
      const r = await mockCrmSource.quotations.send(qid, { expiresInDays: body.expiresInDays });
      return mockDelivery(body, r.share, r.quotation.buyer);
    },
    async share(qid, body) {
      await delay();
      const d = db().quotations.find((x) => x.id === qid) ?? notFound('quotation');
      const sh = share(uuid4().replace(/-/g, ''), body.expiresInDays, `quotation ${d.number}`);
      d.share = { active: true, expiresAt: sh.expiresAt, lastSharedAt: nowIso() };
      return sh;
    },
    async revokeShare(qid) {
      await delay();
      const d = db().quotations.find((x) => x.id === qid) ?? notFound('quotation');
      d.share = noShare;
    },
    async pdf(qid) {
      await delay();
      const d = db().quotations.find((x) => x.id === qid) ?? notFound('quotation');
      return fakePdf(d.number);
    },
    async convert(qid) {
      await delay();
      const s = db();
      const d = s.quotations.find((x) => x.id === qid) ?? notFound('quotation');
      const inv = makeInvoice(s, { accountId: d.account?.id ?? null, contactId: d.contact?.id ?? null, dealId: d.dealId, buyer: d.buyer, placeOfSupplyStateCode: d.placeOfSupplyStateCode, lines: d.lines.map((l) => ({ productId: l.productId, name: l.name, hsnSac: l.hsnSac, unit: l.unit, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountKind: l.discountKind, discountValue: l.discountValue, gstRate: l.gstRate })) });
      inv.quotationId = d.id;
      d.convertedInvoiceId = inv.id;
      s.invoices.unshift(inv);
      return inv;
    },
    async duplicate(qid) {
      await delay();
      const s = db();
      const d = s.quotations.find((x) => x.id === qid) ?? notFound('quotation');
      const copy = makeQuotation(s, { accountId: d.account?.id ?? null, contactId: d.contact?.id ?? null, buyer: d.buyer, lines: d.lines.map((l) => ({ productId: l.productId, name: l.name, quantity: l.quantity, unitPricePaise: l.unitPricePaise, gstRate: l.gstRate })) });
      s.quotations.unshift(copy);
      return copy;
    },
  },
  invoices: {
    async list(q) {
      await delay();
      const s = db();
      const rows = s.invoices.filter((d) => inScope(d.owner?.id) && ownerMatch(d.owner?.id, arr(q.ownerId)) && text(q.q, d.number, d.buyerName) && (!arr(q.status).length || arr(q.status).includes(d.status)) && (!q.accountId || d.account?.id === q.accountId) && (String(q.overdue) !== 'true' || d.overdue));
      return page(sortBy(rows, String(q.sort ?? 'issueDate'), q.dir ?? 'desc'), q);
    },
    async get(iid) {
      await delay();
      return db().invoices.find((d) => d.id === iid && inScope(d.owner?.id)) ?? notFound('invoice');
    },
    async create(body) {
      await delay();
      const s = db();
      const d = makeInvoice(s, body as Record<string, unknown>);
      s.invoices.unshift(d);
      return d;
    },
    async update(iid, patch) {
      await delay();
      const s = db();
      const d = s.invoices.find((x) => x.id === iid) ?? notFound('invoice');
      if (d.status !== 'draft') fail('DOCUMENT_STATE_INVALID', 'Issued invoices cannot be edited. Cancel it and make a new one.', 409);
      const next = makeInvoice(s, { ...patch, lines: patch.lines ?? d.lines.map((l) => ({ productId: l.productId, name: l.name, hsnSac: l.hsnSac, unit: l.unit, quantity: l.quantity, unitPricePaise: l.unitPricePaise, discountKind: l.discountKind, discountValue: l.discountValue, gstRate: l.gstRate })) });
      Object.assign(d, { ...next, id: d.id, createdAt: d.createdAt, version: d.version });
      return bumped(d);
    },
    async remove(iid) {
      await delay();
      const s = db();
      s.invoices = s.invoices.filter((d) => d.id !== iid);
    },
    async issue(iid, body) {
      await delay();
      const s = db();
      const d = s.invoices.find((x) => x.id === iid) ?? notFound('invoice');
      if (d.status !== 'draft') fail('DOCUMENT_STATE_INVALID', 'This invoice is already issued.', 409);
      issue(s, d, body.issueDate);
      return bumped(d);
    },
    async cancel(iid, body) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      if (d.status === 'draft' || d.status === 'paid' || d.status === 'cancelled') fail('DOCUMENT_STATE_INVALID', 'Only issued invoices can be cancelled.', 409);
      Object.assign(d, { status: 'cancelled', cancelledAt: nowIso(), cancelReason: body.reason, balancePaise: 0 });
      return bumped(d);
    },
    async send(iid, body) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      const sh = share(uuid4().replace(/-/g, ''), body.expiresInDays, `invoice ${d.number ?? ''}`);
      d.share = { active: true, expiresAt: sh.expiresAt, lastSharedAt: nowIso() };
      return { invoice: bumped(d), share: sh };
    },
    async deliver(iid, body) {
      const r = await mockCrmSource.invoices.send(iid, { expiresInDays: body.expiresInDays });
      return mockDelivery(body, r.share, r.invoice.buyer);
    },
    async share(iid, body) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      const sh = share(uuid4().replace(/-/g, ''), body.expiresInDays, `invoice ${d.number ?? ''}`);
      d.share = { active: true, expiresAt: sh.expiresAt, lastSharedAt: nowIso() };
      return sh;
    },
    async revokeShare(iid) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      d.share = noShare;
    },
    async pdf(iid) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      return fakePdf(d.number ?? 'draft-invoice');
    },
    async recordPayment(iid, body) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      const b = parse(PaymentCreateSchema, body);
      if (b.clientPaymentId && d.payments.some((p) => p.note === `client:${b.clientPaymentId}`)) return d;
      if (b.amountPaise > d.balancePaise) fail('PAYMENT_EXCEEDS_BALANCE', 'The payment is more than the balance due.', 422, [{ path: 'amountPaise', message: 'More than the balance' }]);
      d.payments.push({ id: uuid4(), invoiceId: d.id, amountPaise: b.amountPaise, paidOn: b.paidOn ?? today(), mode: b.mode, reference: b.reference ?? null, note: b.note ?? null, recordedBy: userById(viewer().userId), createdAt: nowIso() });
      d.paidPaise += b.amountPaise;
      d.balancePaise = d.totalPaise - d.paidPaise;
      d.status = d.balancePaise === 0 ? 'paid' : 'partially_paid';
      return bumped(d);
    },
    async deletePayment(iid, paymentId) {
      await delay();
      const d = db().invoices.find((x) => x.id === iid) ?? notFound('invoice');
      const p = d.payments.find((x) => x.id === paymentId) ?? notFound('payment');
      d.payments = d.payments.filter((x) => x.id !== paymentId);
      d.paidPaise -= p.amountPaise;
      d.balancePaise = d.totalPaise - d.paidPaise;
      d.status = d.paidPaise === 0 ? 'issued' : 'partially_paid';
      return bumped(d);
    },
  },
  calendar: {
    async meetings(q) {
      await delay();
      const s = db();
      const v = viewer();
      const from = Date.parse(q.from);
      const to = Date.parse(q.to);
      const who = arr(q.userId);
      const items = s.meetings.filter((m) => {
        if (Date.parse(m.endAt) <= from || Date.parse(m.startAt) >= to) return false;
        const people = m.attendees.map((a) => a.userId).filter(Boolean) as string[];
        if (!who.length || who.includes('me')) return people.includes(v.userId ?? '');
        if (who.includes('all')) return v.visible === null || people.some((p) => v.visible!.has(p));
        return people.some((p) => who.includes(p));
      });
      return { items };
    },
    async get(mid) {
      await delay();
      return db().meetings.find((m) => m.id === mid) ?? notFound('meeting');
    },
    async create(body) {
      await delay();
      const s = db();
      const m = makeMeeting(s, body as Record<string, unknown>);
      s.meetings.push(m);
      return m;
    },
    async update(mid, patch) {
      await delay();
      const m = db().meetings.find((x) => x.id === mid) ?? notFound('meeting');
      const { scope: _s, occurrenceStart: _o, expectedVersion: _v, attendeeUserIds: _u, attendeeContactIds: _c, guests: _g, organizerId: _org, leadId: _l, contactId: _ct, accountId: _a, dealId: _d, ...rest } = patch;
      Object.assign(m, Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== undefined)));
      return bumped(m);
    },
    async cancel(mid, body) {
      await delay();
      const m = db().meetings.find((x) => x.id === mid) ?? notFound('meeting');
      m.status = 'cancelled';
      m.cancelReason = body.reason ?? null;
      return bumped(m);
    },
    async respond(mid, body) {
      await delay();
      const m = db().meetings.find((x) => x.id === mid) ?? notFound('meeting');
      const v = viewer();
      m.attendees = m.attendees.map((a) => (a.userId === v.userId ? { ...a, response: body.response } : a));
      return bumped(m);
    },
    async remove(mid) {
      await delay();
      const s = db();
      s.meetings = s.meetings.filter((m) => m.id !== mid);
    },
    async availability(q) {
      await delay();
      const s = db();
      const v = viewer();
      const list = users.filter((u) => u.role !== 'viewer' && (v.visible === null || v.visible.has(u.id)));
      return {
        items: list.map((u) => ({
          user: u,
          workingHours: [{ start: q.from, end: new Date(Date.parse(q.from) + 9 * 3_600_000).toISOString() }],
          busy: s.meetings.filter((m) => m.attendees.some((a) => a.userId === u.id) && Date.parse(m.startAt) < Date.parse(q.to) && Date.parse(m.endAt) > Date.parse(q.from)).map((m) => ({ start: m.startAt, end: m.endAt, kind: 'meeting' as const, title: m.title, meetingId: m.id })),
          presence: null,
          availableNow: u.status === 'idle',
        })),
      };
    },
    async timeOff() {
      await delay();
      return { items: db().timeOff };
    },
    async createTimeOff(body) {
      await delay();
      const s = db();
      const t: TimeOff = { id: uuid4(), user: userById(body.userId ?? viewer().userId) ?? users[0]!, kind: body.kind ?? 'leave', startAt: body.startAt, endAt: body.endAt, note: body.note ?? null, createdAt: nowIso() };
      s.timeOff.push(t);
      return t;
    },
    async deleteTimeOff(tid) {
      await delay();
      const s = db();
      s.timeOff = s.timeOff.filter((t) => t.id !== tid);
    },
  },
  routing: {
    async list() {
      await delay();
      return { items: [...db().rules].sort((a, b) => a.priority - b.priority) };
    },
    async create(body) {
      await delay();
      const s = db();
      const r = makeRule(body as Record<string, unknown>, s.rules.length + 1);
      s.rules.push(r);
      return r;
    },
    async update(rid, patch) {
      await delay();
      const r = db().rules.find((x) => x.id === rid) ?? notFound('rule');
      const { userIds, fallbackOwnerId, teamId: _t, ...rest } = patch;
      Object.assign(r, Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), { updatedAt: nowIso() });
      if (userIds) r.users = userIds.map((u) => userById(u)).filter((u): u is UserSummary => !!u);
      if (fallbackOwnerId !== undefined) r.fallbackOwner = userById(fallbackOwnerId);
      return r;
    },
    async remove(rid) {
      await delay();
      const s = db();
      s.rules = s.rules.filter((r) => r.id !== rid);
    },
    async reorder(ids) {
      await delay();
      const s = db();
      ids.forEach((rid, i) => {
        const r = s.rules.find((x) => x.id === rid);
        if (r) r.priority = i + 1;
      });
      return { items: [...s.rules].sort((a, b) => a.priority - b.priority) };
    },
    async test(body) {
      await delay();
      const b = parse(RoutingTestSchema, body);
      return decide(db(), b.lead);
    },
  },
  capture: {
    async list() {
      await delay();
      return { items: db().forms };
    },
    async get(fid) {
      await delay();
      return db().forms.find((f) => f.id === fid) ?? notFound('form');
    },
    async create(body) {
      await delay();
      const s = db();
      const f = makeForm(body as Record<string, unknown>);
      s.forms.push(f);
      return f;
    },
    async update(fid, patch) {
      await delay();
      const f = db().forms.find((x) => x.id === fid) ?? notFound('form');
      const p = parse(CaptureFormUpdateSchema, patch);
      if (p.name) f.name = p.name;
      if (p.status) f.status = p.status;
      if (p.fields) f.fields = p.fields;
      if (p.settings) f.settings = { ...f.settings, ...p.settings, consent: p.settings.consent ?? f.settings.consent };
      f.updatedAt = nowIso();
      return f;
    },
    async remove(fid) {
      await delay();
      const s = db();
      s.forms = s.forms.filter((f) => f.id !== fid);
    },
    async submissions(fid, cursor) {
      await delay();
      return page(db().submissions.filter((x) => x.formId === fid), { cursor, limit: 50 });
    },
  },
  public: {
    async form(key) {
      await delay();
      const f = db().forms.find((x) => x.key === key) ?? notFound('form');
      if (f.status !== 'active') fail('CAPTURE_FORM_CLOSED', 'This form is closed.', 410);
      return { key: f.key, name: f.name, fields: f.fields.map(({ mapTo: _m, ...rest }) => rest), submitLabel: f.settings.submitLabel, successMessage: f.settings.successMessage, consent: f.settings.consent, layout: f.settings.layout, showLogo: f.settings.showLogo, honeypotField: CAPTURE_HONEYPOT_FIELD, workspaceName: 'Shakti Storage', branding: EMPTY_BRANDING };
    },
    async submit(key, body) {
      await delay();
      const s = db();
      const f = s.forms.find((x) => x.key === key) ?? notFound('form');
      if (f.status !== 'active') fail('CAPTURE_FORM_CLOSED', 'This form is closed.', 410);
      if (body.hp) return { ok: true as const, message: f.settings.successMessage, redirectUrl: null };
      if (f.settings.consent.enabled && f.settings.consent.required && !body.consent) fail('VALIDATION_FAILED', 'Tick the consent box to send.', 422, [{ path: 'consent', message: 'Required' }]);
      if (body.clientSubmissionId && s.submissions.some((x) => x.id === body.clientSubmissionId)) return { ok: true as const, message: f.settings.successMessage, redirectUrl: f.settings.redirectUrl };
      const answer = (target: string) => {
        const fl = f.fields.find((x) => x.mapTo === target);
        const v = fl ? body.values[fl.id] : undefined;
        return v === undefined || v === null ? null : String(v);
      };
      const routed = decide(s, { source: 'website', city: answer('city'), state: answer('state'), productInterest: answer('productInterest'), requirement: answer('requirement'), valueInr: 0, tags: [], captureFormId: f.id });
      const lead = await mockLeadsSource.create({ name: answer('name') ?? 'Website visitor', phone: answer('phone') ?? undefined, email: answer('email') ?? undefined, city: answer('city') ?? undefined, requirement: answer('requirement') ?? undefined, source: 'website', ownerId: f.settings.ownerId ?? routed.owner?.id ?? undefined, valueInr: 0, tags: f.settings.defaultTags } as Parameters<typeof mockLeadsSource.create>[0]);
      if (routed.rule) {
        const r = s.rules.find((x) => x.id === routed.rule!.id);
        if (r && routed.owner) Object.assign(r, { lastAssignedUserId: routed.owner.id, assignedCount: r.assignedCount + 1, lastAssignedAt: nowIso() });
      }
      s.submissions.unshift({ id: body.clientSubmissionId ?? uuid4(), formId: f.id, leadId: lead.id, duplicateOfLeadId: null, values: body.values, utm: body.utm ?? {}, consent: body.consent ?? null, pageUrl: body.pageUrl ?? null, referrer: body.referrer ?? null, createdAt: nowIso() });
      f.submissionCount += 1;
      f.lastSubmissionAt = nowIso();
      return { ok: true as const, message: f.settings.successMessage, redirectUrl: f.settings.redirectUrl };
    },
    async document() {
      await delay();
      return fail('SHARE_LINK_EXPIRED', 'Shared links are not available in the mock data mode.', 410);
    },
    async documentPdf() {
      await delay();
      return fakePdf('shared-document');
    },
  },
};
