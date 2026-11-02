/**
 * Demo CRM data (change #19 wave B, seed:demo only; the clean seed stays clean). Per company:
 * accounts from the distinct company names of the demo leads (valid GSTINs, PAN, billing address with the
 * GST state code), contacts linked to their account and owner, the deal pipeline with the existing deals
 * placed on it, 40 products and services (HSN/SAC, GST 0/5/12/18/28), the seller profile, 30 quotations and
 * 15 invoices in mixed states (intra- and inter-state, payments), meetings for the next 14 days (and one
 * weekly series), 2 routing rules and 1 capture form (key `demo<n>enquiry`). The first company also gets
 * 3 field staff with consent, attendance sessions and GPS pings (requests-19b #14).
 */
import {
  computeDocument,
  DEFAULT_DEAL_PIPELINE_KEY,
  DEFAULT_DEAL_STAGES,
  financialYearOf,
  formatDocumentNumber,
  gstinCheckChar,
  INDIAN_STATES,
  stateCodeFromName,
  stateName,
  TRACKING_CONSENT_VERSION,
  type GstLineAmounts,
  type GstRate,
  type ProductUnit,
} from '@vistar/shared';
import { generateNKeysBetween } from 'fractional-indexing';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { CompanyCtx } from './company.js';
import { DAY, HOUR, int, MIN, pick, rngFor, shuffle, type Rng } from './util.js';

const IST = 330 * MIN;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Seller state per demo company (index in COMPANY_FIXTURES). */
const SELLERS = [
  { city: 'Pune', stateCode: '27', line1: 'Plot 14, MIDC Bhosari', pincode: '411026' },
  { city: 'Ahmedabad', stateCode: '24', line1: '402 Shapath Hexa, SG Highway', pincode: '380054' },
  { city: 'Bengaluru', stateCode: '29', line1: '21 Peenya Industrial Area, 2nd Stage', pincode: '560058' },
] as const;

/** 40 products and services: name, HSN/SAC, unit, GST rate, price in rupees, kind. */
const CATALOG: ReadonlyArray<[string, string, ProductUnit, GstRate, number, 'goods' | 'service']> = [
  ['CNC Turning Machine', '8458', 'NOS', 18, 1_250_000, 'goods'],
  ['Industrial Air Compressor 10 HP', '8414', 'NOS', 18, 185_000, 'goods'],
  ['Solar Panel 540 W', '8541', 'NOS', 12, 14_500, 'goods'],
  ['Solar Inverter 5 kW', '8504', 'NOS', 18, 62_000, 'goods'],
  ['LED Panel Light 18 W', '9405', 'PCS', 12, 450, 'goods'],
  ['LED Street Light 60 W', '9405', 'PCS', 12, 3_200, 'goods'],
  ['PVC Pipe 4 inch (6 m)', '3917', 'PCS', 18, 980, 'goods'],
  ['GI Pipe 2 inch (6 m)', '7306', 'PCS', 18, 2_650, 'goods'],
  ['TMT Steel Bar 12 mm', '7214', 'TON', 18, 58_000, 'goods'],
  ['Cement OPC 53 (50 kg)', '2523', 'BAG', 28, 390, 'goods'],
  ['Water Treatment Plant 1000 LPH', '8421', 'NOS', 18, 275_000, 'goods'],
  ['RO Membrane 4040', '8421', 'PCS', 18, 7_800, 'goods'],
  ['Submersible Pump 1.5 HP', '8413', 'NOS', 12, 16_500, 'goods'],
  ['Diesel Generator 15 kVA', '8502', 'NOS', 18, 345_000, 'goods'],
  ['Electric Motor 5 HP', '8501', 'NOS', 18, 24_500, 'goods'],
  ['Safety Helmet', '6506', 'PCS', 18, 240, 'goods'],
  ['Safety Shoes', '6403', 'PRS', 18, 1_150, 'goods'],
  ['Nitrile Gloves (box of 100)', '4015', 'BOX', 12, 690, 'goods'],
  ['Corrugated Box 5-ply', '4819', 'PCS', 12, 38, 'goods'],
  ['Stretch Film Roll 23 micron', '3920', 'ROL', 18, 420, 'goods'],
  ['Ergonomic Office Chair', '9401', 'NOS', 18, 8_900, 'goods'],
  ['Steel Almirah 6 ft', '9403', 'NOS', 18, 14_200, 'goods'],
  ['Laptop 14 inch i5', '8471', 'NOS', 18, 56_000, 'goods'],
  ['Laser Printer A4', '8443', 'NOS', 18, 17_800, 'goods'],
  ['CCTV Camera 2 MP', '8525', 'NOS', 18, 2_350, 'goods'],
  ['Basmati Rice (25 kg)', '1006', 'BAG', 5, 2_450, 'goods'],
  ['Cotton Yarn 40s', '5205', 'KGS', 5, 310, 'goods'],
  ['Fresh Vegetables Crate', '0709', 'NOS', 0, 650, 'goods'],
  ['Printed Training Manual', '4901', 'NOS', 0, 350, 'goods'],
  ['Ayurvedic Immunity Kit', '3004', 'NOS', 12, 899, 'goods'],
  ['Tractor Spare Parts Kit', '8708', 'SET', 28, 12_500, 'goods'],
  ['Two-wheeler Tyre 90/90-17', '4011', 'NOS', 28, 1_850, 'goods'],
  ['Exterior Emulsion Paint 20 L', '3209', 'CAN', 18, 5_600, 'goods'],
  ['Industrial Lubricant 5 L', '2710', 'CAN', 18, 1_480, 'goods'],
  ['Machine Installation', '998719', 'OTH', 18, 15_000, 'service'],
  ['Annual Maintenance Contract', '998713', 'OTH', 18, 36_000, 'service'],
  ['Goods Transport (per trip)', '996511', 'OTH', 5, 4_500, 'service'],
  ['CRM Software Subscription (annual)', '997331', 'OTH', 18, 48_000, 'service'],
  ['Business Consulting (per day)', '998311', 'OTH', 18, 25_000, 'service'],
  ['Operator Training Session', '999293', 'OTH', 18, 8_000, 'service'],
];

const INDUSTRIES = ['Manufacturing', 'Construction', 'Agriculture', 'Pharmaceuticals', 'Textiles', 'Logistics', 'Retail', 'Hospitality', 'Education', 'Automotive'];
const MEETING_TOPICS = ['Product demo', 'Site visit', 'Price negotiation', 'Requirement discussion', 'Follow-up call', 'Contract review', 'Installation planning'];

const panOf = (rng: Rng, kind = 'C') =>
  `${LETTERS[int(rng, 0, 25)]}${LETTERS[int(rng, 0, 25)]}${LETTERS[int(rng, 0, 25)]}${kind}${LETTERS[int(rng, 0, 25)]}${String(int(rng, 1000, 9999))}${LETTERS[int(rng, 0, 25)]}`;
export function demoGstin(rng: Rng, stateCode: string, pan = panOf(rng)): string {
  const first14 = `${stateCode}${pan}${int(rng, 1, 9)}Z`;
  return `${first14}${gstinCheckChar(first14)}`;
}

/** IST wall-clock instant on the local day of `at` + `days`. */
function istAt(at: number, days: number, hour: number, minute = 0): number {
  const localMidnight = Math.floor((at + IST) / DAY) * DAY - IST;
  return localMidnight + days * DAY + hour * HOUR + minute * MIN;
}
const isoDate = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const dateCol = (d: string) => new Date(`${d}T00:00:00.000Z`);

export interface CrmSeedSummary {
  accounts: number;
  contactsLinked: number;
  deals: number;
  products: number;
  quotations: number;
  invoices: number;
  meetings: number;
  captureFormKey: string;
}

export async function seedCrm(prisma: PrismaClient, ctx: CompanyCtx, index: number): Promise<CrmSeedSummary> {
  const rng = rngFor(`${ctx.fx.slug}:crm`);
  const wid = ctx.workspaceId;
  const now = Date.now();
  const seller = SELLERS[index % SELLERS.length]!;
  const sellerPan = panOf(rng);
  const sellerGstin = demoGstin(rng, seller.stateCode, sellerPan);

  // ---------------------------------------------------------------- seller profile
  await prisma.setting.create({
    data: {
      workspaceId: wid,
      scope: 'workspace',
      scopeId: wid,
      key: 'billing.sellerProfile',
      value: {
        legalName: `${ctx.workspaceName} Private Limited`,
        tradeName: ctx.workspaceName,
        gstin: sellerGstin,
        pan: sellerPan,
        address: { line1: seller.line1, line2: null, city: seller.city, state: stateName(seller.stateCode), stateCode: seller.stateCode, pincode: seller.pincode, country: 'IN' },
        phone: ctx.admin.phone,
        email: ctx.admin.email,
        website: null,
        bank: { accountName: `${ctx.workspaceName} Private Limited`, accountNumber: `50200${int(rng, 10_000_000, 99_999_999)}`, ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branch: seller.city, upiId: `${ctx.fx.slug.replace(/[^a-z0-9]/g, '')}@hdfcbank` },
        quotationPrefix: 'QT',
        invoicePrefix: 'INV',
        quotationValidityDays: 15,
        paymentTermsDays: 15,
        quotationTerms: 'Prices exclude freight unless stated. Delivery 2-3 weeks from the purchase order. 50% advance, balance before dispatch.',
        invoiceTerms: 'Payment within 15 days. Interest at 18% p.a. on overdue amounts. Subject to local jurisdiction.',
        signatureLabel: 'Authorised signatory',
      },
    },
  });

  // ---------------------------------------------------------------- accounts from the lead company names
  const byCompany = new Map<string, (typeof ctx.drafts)[number][]>();
  for (const d of ctx.drafts) {
    const name = d.lead.companyName;
    if (name) byCompany.set(name, [...(byCompany.get(name) ?? []), d]);
  }
  const accountRows: Prisma.CompanyCreateManyInput[] = [];
  const accountByName = new Map<string, { id: string; stateCode: string; city: string; gstin: string | null; ownerId: string | null; name: string; billing: Prisma.InputJsonObject }>();
  for (const [name, drafts] of byCompany) {
    const first = drafts[0]!.lead;
    const stateCode = stateCodeFromName(first.state) ?? seller.stateCode;
    const city = first.city ?? seller.city;
    const pan = panOf(rng);
    const gstin = rng() < 0.8 ? demoGstin(rng, stateCode, pan) : null;
    const id = randomUUID();
    const billing = { line1: `${int(rng, 1, 250)}, ${pick(rng, ['Industrial Estate', 'Market Yard', 'Business Park', 'Trade Centre', 'MG Road'])}`, line2: null, city, state: stateName(stateCode), stateCode, pincode: String(int(rng, 110001, 799999)), country: 'IN' };
    accountRows.push({
      id,
      workspaceId: wid,
      name,
      gstin,
      pan,
      industry: pick(rng, INDUSTRIES),
      phone: first.phone ?? null,
      email: `accounts@${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.in`,
      billingAddress: billing,
      shippingAddress: billing,
      city,
      state: stateName(stateCode),
      stateCode,
      ownerId: first.ownerId ?? null,
      tags: [],
      createdAt: first.createdAt,
    });
    accountByName.set(name, { id, stateCode, city, gstin, ownerId: first.ownerId ?? null, name, billing });
  }
  for (let i = 0; i < accountRows.length; i += 1000) await prisma.company.createMany({ data: accountRows.slice(i, i + 1000) });

  // leads, contacts and deals point at their account; contacts get owner and state code from their lead
  const stateMap = INDIAN_STATES.map((s) => `('${s.name.replace(/'/g, "''")}', '${s.code}')`).join(', ');
  await prisma.$executeRaw`UPDATE "Lead" l SET "companyId" = c."id" FROM "Company" c WHERE c."workspaceId" = l."workspaceId" AND c."name" = l."companyName" AND l."workspaceId" = ${wid}::uuid`;
  const contactsLinked = await prisma.$executeRawUnsafe(
    `UPDATE "Contact" ct SET "companyId" = l."companyId", "ownerId" = COALESCE(ct."ownerId", l."ownerId"), "title" = COALESCE(ct."title", 'Purchase manager'), "stateCode" = m.code
     FROM "Lead" l LEFT JOIN (VALUES ${stateMap}) AS m(name, code) ON m.name = l."state"
     WHERE l."contactId" = ct."id" AND ct."workspaceId" = $1::uuid AND l."workspaceId" = $1::uuid`,
    wid,
  );

  // ---------------------------------------------------------------- deal pipeline and the existing deals on it
  const pipeline = await prisma.pipeline.create({ data: { workspaceId: wid, key: DEFAULT_DEAL_PIPELINE_KEY, name: 'Deals', entity: 'deal', isDefault: false } });
  const stages = await Promise.all(
    DEFAULT_DEAL_STAGES.map((s, order) => prisma.stage.create({ data: { workspaceId: wid, pipelineId: pipeline.id, key: s.key, name: s.name, type: s.type, probability: s.probability, order } })),
  );
  const openStages = stages.filter((s) => s.type === 'open');
  const deals = await prisma.deal.findMany({ where: { workspaceId: wid }, select: { id: true, status: true, leadId: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  const byStage = new Map<string, string[]>();
  for (const d of deals) {
    const stage = d.status === 'open' ? openStages[int(rng, 0, openStages.length - 1)]! : stages.find((s) => s.type === d.status)!;
    byStage.set(stage.id, [...(byStage.get(stage.id) ?? []), d.id]);
  }
  const ids: string[] = [];
  const stageIds: string[] = [];
  const positions: string[] = [];
  for (const [stageId, list] of byStage) {
    const keys = generateNKeysBetween(null, null, list.length);
    list.forEach((id, i) => {
      ids.push(id);
      stageIds.push(stageId);
      positions.push(keys[i]!);
    });
  }
  if (ids.length) {
    await prisma.$executeRaw`UPDATE "Deal" d SET "pipelineId" = ${pipeline.id}::uuid, "stageId" = v.stage, "position" = v.pos,
      "ownerId" = COALESCE(d."ownerId", l."ownerId"), "contactId" = COALESCE(d."contactId", l."contactId"), "companyId" = COALESCE(d."companyId", l."companyId")
      FROM (SELECT unnest(${ids}::uuid[]) AS id, unnest(${stageIds}::uuid[]) AS stage, unnest(${positions}::text[]) AS pos) v, "Lead" l
      WHERE d."id" = v.id AND l."id" = d."leadId" AND d."workspaceId" = ${wid}::uuid`;
  }

  // ---------------------------------------------------------------- products and a price list
  const products = CATALOG.map(([name, hsnSac, unit, gstRate, price, kind], i) => ({
    id: randomUUID(),
    workspaceId: wid,
    sku: `${kind === 'service' ? 'SRV' : 'PRD'}-${String(i + 1).padStart(3, '0')}`,
    name,
    description: kind === 'service' ? 'Service, billed as per the agreed scope' : null,
    kind,
    hsnSac,
    unit,
    gstRate,
    unitPricePaise: BigInt(price * 100),
    active: !(index === 0 && i === 39),
    createdAt: new Date(ctx.createdAt + DAY),
  }));
  await prisma.product.createMany({ data: products });
  const dealerList = await prisma.priceList.create({ data: { workspaceId: wid, name: 'Dealer price list', description: '8% below list price for registered dealers', isDefault: false, active: true } });
  await prisma.priceListItem.createMany({ data: products.slice(0, 20).map((p) => ({ workspaceId: wid, priceListId: dealerList.id, productId: p.id, unitPricePaise: (p.unitPricePaise * 92n) / 100n })) });

  // ---------------------------------------------------------------- quotations and invoices
  const accounts = [...accountByName.values()];
  const interState = shuffle(rng, accounts.filter((a) => a.stateCode !== seller.stateCode)).slice(0, 25);
  const intraState = shuffle(rng, accounts.filter((a) => a.stateCode === seller.stateCode)).slice(0, 25);
  const buyers = shuffle(rng, [...interState.slice(0, 18), ...intraState.slice(0, 18)]);
  const contactByAccount = new Map<string, { id: string; name: string }>();
  for (const c of await prisma.contact.findMany({ where: { workspaceId: wid, companyId: { in: buyers.map((b) => b.id) } }, select: { id: true, name: true, companyId: true } })) {
    if (c.companyId && !contactByAccount.has(c.companyId)) contactByAccount.set(c.companyId, { id: c.id, name: c.name });
  }
  const sellerSnapshot = {
    legalName: `${ctx.workspaceName} Private Limited`,
    tradeName: ctx.workspaceName,
    gstin: sellerGstin,
    pan: sellerPan,
    address: { line1: seller.line1, line2: null, city: seller.city, state: stateName(seller.stateCode), stateCode: seller.stateCode, pincode: seller.pincode, country: 'IN' },
    phone: ctx.admin.phone,
    email: ctx.admin.email,
    website: null,
    bank: { accountName: `${ctx.workspaceName} Private Limited`, accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', branch: seller.city, upiId: null },
    signatureLabel: 'Authorised signatory',
  };
  const salesIds = ctx.sales.map((u) => u.id);
  const makeLines = () =>
    Array.from({ length: int(rng, 1, 4) }, () => {
      const p = pick(rng, products);
      const quantity = p.unit === 'TON' || p.unit === 'KGS' ? Math.round((1 + rng() * 9) * 10) / 10 : int(rng, 1, p.unitPricePaise > 10_000_000n ? 2 : 25);
      const discount = rng() < 0.4 ? int(rng, 2, 12) : 0;
      return { productId: p.id, name: p.name, description: null, hsnSac: p.hsnSac, unit: p.unit, quantity, unitPricePaise: Number(p.unitPricePaise), discountKind: 'percent' as const, discountValue: discount, gstRate: p.gstRate as GstRate };
    });
  const totalsCols = (t: ReturnType<typeof computeDocument>['totals']) => ({
    taxMode: t.taxMode,
    subtotalPaise: BigInt(t.subtotalPaise),
    discountPaise: BigInt(t.discountPaise),
    taxablePaise: BigInt(t.taxablePaise),
    cgstPaise: BigInt(t.cgstPaise),
    sgstPaise: BigInt(t.sgstPaise),
    igstPaise: BigInt(t.igstPaise),
    roundOffPaise: BigInt(t.roundOffPaise),
    totalPaise: BigInt(t.totalPaise),
  });
  type SeedLine = { productId: string | null; name: string; description: string | null; hsnSac: string | null; unit: string; quantity: number; unitPricePaise: number; discountKind: string; discountValue: number; gstRate: number } & GstLineAmounts;
  const lineCols = (workspaceId: string, l: SeedLine, position: number) => ({
    workspaceId,
    position,
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit,
    quantity: String(l.quantity),
    unitPricePaise: BigInt(l.unitPricePaise),
    discountKind: l.discountKind,
    discountValue: String(l.discountValue),
    gstRate: l.gstRate,
    grossPaise: BigInt(l.grossPaise),
    discountPaise: BigInt(l.discountPaise),
    taxablePaise: BigInt(l.taxablePaise),
    cgstPaise: BigInt(l.cgstPaise),
    sgstPaise: BigInt(l.sgstPaise),
    igstPaise: BigInt(l.igstPaise),
    totalPaise: BigInt(l.totalPaise),
  });
  const partyOf = (a: (typeof accounts)[number]) => ({
    name: a.name,
    gstin: a.gstin,
    pan: a.gstin ? a.gstin.slice(2, 12) : null,
    phone: null,
    email: null,
    billingAddress: a.billing,
    shippingAddress: a.billing,
    contactName: contactByAccount.get(a.id)?.name ?? null,
  });

  const QUOTE_STATUSES: Array<'draft' | 'sent' | 'accepted' | 'rejected' | 'expired'> = [...Array(6).fill('draft'), ...Array(10).fill('sent'), ...Array(7).fill('accepted'), ...Array(3).fill('rejected'), ...Array(4).fill('expired')];
  const seq = new Map<string, number>();
  const nextNumber = (kind: 'QT' | 'INV', issue: string) => {
    const fy = financialYearOf(issue);
    const n = (seq.get(`${kind}:${fy}`) ?? 0) + 1;
    seq.set(`${kind}:${fy}`, n);
    return { number: formatDocumentNumber(kind, fy, n), fy, n };
  };
  const quotations: Array<{ id: string; status: string; buyer: (typeof accounts)[number]; lines: ReturnType<typeof makeLines>; ownerId: string; issue: string }> = [];
  const qOrder = QUOTE_STATUSES.map((status, i) => ({ status, issueAt: istAt(now, -int(rng, status === 'expired' ? 25 : 1, 40) + (i % 3), 11) })).sort((a, b) => a.issueAt - b.issueAt);
  for (const [i, q] of qOrder.entries()) {
    const buyer = buyers[i % buyers.length]!;
    const lines = makeLines();
    const computed = computeDocument(lines, { sellerStateCode: seller.stateCode, placeOfSupplyStateCode: buyer.stateCode });
    const issue = isoDate(q.issueAt);
    const validUntil = isoDate(q.status === 'expired' ? q.issueAt + 15 * DAY : Math.max(q.issueAt + 15 * DAY, now + 3 * DAY));
    const n = nextNumber('QT', issue);
    const id = randomUUID();
    const ownerId = buyer.ownerId ?? pick(rng, salesIds);
    const sentAt = q.status === 'draft' ? null : new Date(q.issueAt + HOUR);
    await prisma.quotation.create({
      data: {
        id,
        workspaceId: wid,
        number: n.number,
        financialYear: n.fy,
        sequence: n.n,
        status: q.status,
        issueDate: dateCol(issue),
        validUntil: dateCol(validUntil),
        ownerId,
        companyId: buyer.id,
        contactId: contactByAccount.get(buyer.id)?.id ?? null,
        buyerName: buyer.name,
        buyer: partyOf(buyer),
        seller: sellerSnapshot,
        placeOfSupply: buyer.stateCode,
        ...totalsCols(computed.totals),
        terms: 'Prices exclude freight unless stated. Delivery 2-3 weeks from the purchase order.',
        sentAt,
        acceptedAt: q.status === 'accepted' ? new Date(q.issueAt + 2 * DAY) : null,
        rejectedAt: q.status === 'rejected' ? new Date(q.issueAt + 3 * DAY) : null,
        statusReason: q.status === 'rejected' ? 'Price higher than the competitor' : null,
        createdById: ownerId,
        createdAt: new Date(q.issueAt),
        lines: { create: computed.lines.map((l, p) => lineCols(wid, l, p)) },
      },
    });
    quotations.push({ id, status: q.status, buyer, lines, ownerId, issue });
  }
  for (const [key, n] of seq) {
    const [kind, fy] = key.split(':') as ['QT', string];
    await prisma.documentSeries.create({ data: { workspaceId: wid, kind: kind === 'QT' ? 'quotation' : 'invoice', financialYear: fy, prefix: kind, nextNumber: n + 1 } });
  }
  seq.clear();

  const INVOICE_STATUSES: Array<'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled'> = ['draft', 'draft', 'draft', 'issued', 'issued', 'issued', 'issued', 'partially_paid', 'partially_paid', 'partially_paid', 'partially_paid', 'paid', 'paid', 'paid', 'cancelled'];
  const accepted = quotations.filter((q) => q.status === 'accepted');
  const iOrder = INVOICE_STATUSES.map((status) => ({ status, issueAt: istAt(now, -int(rng, status === 'draft' ? 0 : 3, status === 'issued' ? 40 : 30), 12) })).sort((a, b) => a.issueAt - b.issueAt);
  for (const [i, inv] of iOrder.entries()) {
    const fromQuote = i < accepted.length ? accepted[i] : undefined;
    const buyer = fromQuote?.buyer ?? buyers[(i + 7) % buyers.length]!;
    const lines = fromQuote?.lines ?? makeLines();
    const computed = computeDocument(lines, { sellerStateCode: seller.stateCode, placeOfSupplyStateCode: buyer.stateCode });
    const issue = isoDate(inv.issueAt);
    const issued = inv.status !== 'draft';
    const n = issued ? nextNumber('INV', issue) : null;
    const total = computed.totals.totalPaise;
    const payments =
      inv.status === 'paid'
        ? [Math.round(total * 0.5), total - Math.round(total * 0.5)]
        : inv.status === 'partially_paid'
          ? [Math.round((total * int(rng, 20, 70)) / 100)]
          : [];
    const paid = payments.reduce((s, p) => s + p, 0);
    const ownerId = fromQuote?.ownerId ?? buyer.ownerId ?? pick(rng, salesIds);
    await prisma.invoice.create({
      data: {
        workspaceId: wid,
        number: n?.number ?? null,
        financialYear: n?.fy ?? null,
        sequence: n?.n ?? null,
        status: inv.status,
        issueDate: dateCol(issue),
        dueDate: dateCol(isoDate(inv.issueAt + 15 * DAY)),
        ownerId,
        companyId: buyer.id,
        contactId: contactByAccount.get(buyer.id)?.id ?? null,
        quotationId: fromQuote?.id ?? null,
        buyerName: buyer.name,
        buyer: partyOf(buyer),
        seller: sellerSnapshot,
        placeOfSupply: buyer.stateCode,
        ...totalsCols(computed.totals),
        paidPaise: BigInt(paid),
        terms: 'Payment within 15 days. Interest at 18% p.a. on overdue amounts.',
        issuedAt: issued ? new Date(inv.issueAt + HOUR) : null,
        lastPaymentAt: payments.length ? new Date(Math.min(now, inv.issueAt + 6 * DAY)) : null,
        cancelledAt: inv.status === 'cancelled' ? new Date(inv.issueAt + DAY) : null,
        cancelReason: inv.status === 'cancelled' ? 'Raised on the wrong buyer GSTIN' : null,
        createdById: ownerId,
        createdAt: new Date(inv.issueAt),
        lines: { create: computed.lines.map((l, p) => lineCols(wid, l, p)) },
        payments: {
          create: payments.map((amount, k) => ({
            workspaceId: wid,
            amountPaise: BigInt(amount),
            paidOn: dateCol(isoDate(Math.min(now, inv.issueAt + (k + 1) * 3 * DAY))),
            mode: pick(rng, ['upi', 'bank_transfer', 'cheque'] as const),
            reference: `UTR${int(rng, 100_000_000, 999_999_999)}`,
            recordedById: ownerId,
            createdAt: new Date(Math.min(now, inv.issueAt + (k + 1) * 3 * DAY)),
          })),
        },
      },
    });
  }
  for (const [key, n] of seq) {
    const [, fy] = key.split(':') as ['INV', string];
    await prisma.documentSeries.create({ data: { workspaceId: wid, kind: 'invoice', financialYear: fy, prefix: 'INV', nextNumber: n + 1 } });
  }

  // ---------------------------------------------------------------- meetings: next 14 days + one weekly series
  const withContacts = ctx.drafts.filter((d) => d.lead.ownerId && d.contact.id).slice(0, 400);
  let meetings = 0;
  for (let i = 0; i < 24; i++) {
    const d = pick(rng, withContacts);
    const day = int(rng, 0, 13);
    const start = istAt(now, day, int(rng, 10, 17), pick(rng, [0, 30]));
    if (start < now) continue;
    const organizerId = d.lead.ownerId!;
    const account = d.lead.companyName ? accountByName.get(d.lead.companyName) : undefined;
    const video = rng() < 0.4;
    await prisma.meeting.create({
      data: {
        workspaceId: wid,
        title: `${pick(rng, MEETING_TOPICS)}: ${d.lead.companyName ?? d.lead.name}`,
        mode: video ? 'video' : 'in_person',
        location: video ? null : `${d.lead.city ?? seller.city} office`,
        videoUrl: video ? 'https://meet.google.com/abc-defg-hij' : null,
        startAt: new Date(start),
        endAt: new Date(start + pick(rng, [30, 45, 60]) * MIN),
        timezone: 'Asia/Kolkata',
        organizerId,
        leadId: d.lead.id,
        contactId: d.contact.id,
        companyId: account?.id ?? null,
        reminders: [15],
        createdById: organizerId,
        attendees: {
          create: [
            { workspaceId: wid, userId: organizerId, name: ctx.userById.get(organizerId)?.name ?? 'Organizer', email: ctx.userById.get(organizerId)?.email ?? null, response: 'accepted' },
            { workspaceId: wid, contactId: d.contact.id, name: String(d.contact.name), email: (d.contact.email as string | null | undefined) ?? null, response: pick(rng, ['pending', 'accepted'] as const) },
          ],
        },
      },
    });
    meetings++;
  }
  const manager = ctx.managers[0] ?? ctx.admin;
  const team = ctx.teams.find((t) => t.managerId === manager.id);
  const mondays = [1, 2, 3, 4, 5, 6, 7].map((k) => istAt(now, k, 10)).find((t) => new Date(t + IST).getUTCDay() === 1)!;
  await prisma.meeting.create({
    data: {
      workspaceId: wid,
      title: 'Weekly sales review',
      description: 'Pipeline review, stuck deals and next week targets',
      mode: 'video',
      videoUrl: 'https://meet.google.com/xyz-weekly-rev',
      startAt: new Date(mondays),
      endAt: new Date(mondays + 45 * MIN),
      timezone: 'Asia/Kolkata',
      organizerId: manager.id,
      reminders: [10, 60],
      recurrence: { freq: 'weekly', interval: 1, byWeekday: ['mon'], count: 12 },
      seriesEndAt: new Date(mondays + 11 * 7 * DAY + 45 * MIN),
      createdById: manager.id,
      attendees: {
        create: [manager.id, ...(team?.memberIds ?? [])].filter((v, i, a) => a.indexOf(v) === i).map((uid) => ({ workspaceId: wid, userId: uid, name: ctx.userById.get(uid)?.name ?? 'Member', email: ctx.userById.get(uid)?.email ?? null, response: uid === manager.id ? ('accepted' as const) : ('pending' as const) })),
      },
    },
  });
  meetings++;
  const someone = ctx.sales.find((u) => u.kind === 'employee');
  if (someone) await prisma.timeOff.create({ data: { workspaceId: wid, userId: someone.id, kind: 'leave', startAt: new Date(istAt(now, 3, 0)), endAt: new Date(istAt(now, 4, 0)), note: 'Family function', createdById: someone.id } });

  // ---------------------------------------------------------------- routing rules and a capture form
  await prisma.routingRule.createMany({
    data: [
      {
        workspaceId: wid,
        name: 'IndiaMART and website leads: round robin',
        priority: 0,
        conditions: { sources: ['indiamart', 'website'], cities: [], states: [], productKeywords: [], minValueInr: null, maxValueInr: 499_999, tags: [], captureFormIds: [] },
        strategy: 'round_robin',
        teamId: team?.id ?? null,
        userIds: team ? [] : ctx.sales.filter((u) => u.kind === 'employee').slice(0, 3).map((u) => u.id),
        respectWorkingHours: true,
        respectAvailability: true,
        fallbackOwnerId: manager.id,
      },
      {
        workspaceId: wid,
        name: 'High value enquiries (Rs. 5 lakh and above)',
        priority: 1,
        conditions: { sources: [], cities: [], states: [], productKeywords: [], minValueInr: 500_000, maxValueInr: null, tags: [], captureFormIds: [] },
        strategy: 'least_busy',
        userIds: ctx.managers.length ? ctx.managers.map((m) => m.id) : [ctx.admin.id],
        respectWorkingHours: false,
        respectAvailability: true,
        fallbackOwnerId: ctx.admin.id,
      },
    ],
  });
  const captureFormKey = `demo${index + 1}enquiry`;
  await prisma.captureForm.create({
    data: {
      workspaceId: wid,
      key: captureFormKey,
      name: 'Website enquiry',
      status: 'active',
      fields: [
        { id: 'name', label: 'Your name', type: 'text', required: true, placeholder: 'Full name', helpText: null, options: [], mapTo: 'name', param: null, defaultValue: null },
        { id: 'phone', label: 'Mobile number', type: 'phone', required: true, placeholder: '98765 43210', helpText: null, options: [], mapTo: 'phone', param: null, defaultValue: null },
        { id: 'email', label: 'Email', type: 'email', required: false, placeholder: null, helpText: null, options: [], mapTo: 'email', param: null, defaultValue: null },
        { id: 'company', label: 'Company', type: 'text', required: false, placeholder: null, helpText: null, options: [], mapTo: 'companyName', param: null, defaultValue: null },
        { id: 'city', label: 'City', type: 'text', required: false, placeholder: null, helpText: null, options: [], mapTo: 'city', param: null, defaultValue: null },
        { id: 'product', label: 'Product', type: 'select', required: false, placeholder: null, helpText: null, options: products.slice(0, 8).map((p) => ({ value: p.sku, label: p.name })), mapTo: 'productInterest', param: null, defaultValue: null },
        { id: 'requirement', label: 'Your requirement', type: 'textarea', required: false, placeholder: 'Quantity, delivery city, timeline', helpText: null, options: [], mapTo: 'requirement', param: null, defaultValue: null },
        { id: 'campaign', label: 'Campaign', type: 'hidden', required: false, placeholder: null, helpText: null, options: [], mapTo: null, param: 'utm_campaign', defaultValue: null },
      ],
      settings: {
        submitLabel: 'Send enquiry',
        successMessage: 'Thank you. Our team will call you within one working hour.',
        redirectUrl: null,
        consent: { enabled: true, required: false, text: 'I agree to be contacted on phone, WhatsApp and email about my enquiry.' },
        defaultTags: ['website-form'],
        ownerId: null,
        stageId: null,
        notifyOwner: true,
        dedupe: 'phone_or_email',
        layout: 'card',
        showLogo: true,
      },
      createdById: ctx.admin.id,
    },
  });

  // ---------------------------------------------------------------- field staff (first company; plan with field_tracking)
  if (index === 0) await seedFieldStaff(prisma, ctx, rng, now);

  return { accounts: accountRows.length, contactsLinked, deals: ids.length, products: products.length, quotations: quotations.length, invoices: INVOICE_STATUSES.length, meetings, captureFormKey };
}

/** Pune routes with stops for 3 field staff: consent, sessions today (2 open, 1 closed) and yesterday, pings every 2 minutes. */
async function seedFieldStaff(prisma: PrismaClient, ctx: CompanyCtx, rng: Rng, now: number): Promise<void> {
  const wid = ctx.workspaceId;
  const people = ctx.sales.filter((u) => u.kind === 'employee').slice(0, 3);
  if (!people.length) return;
  await prisma.user.updateMany({ where: { id: { in: people.map((p) => p.id) } }, data: { isFieldStaff: true } });
  await prisma.trackingConsent.createMany({ data: people.map((p) => ({ workspaceId: wid, userId: p.id, version: TRACKING_CONSENT_VERSION, accepted: true, at: new Date(now - 10 * DAY) })) });
  const ROUTES: Array<[number, number, number, number]> = [
    [18.5204, 73.8567, 18.5590, 73.7868], // Shivajinagar -> Baner
    [18.5089, 73.9260, 18.5679, 73.9143], // Hadapsar -> Viman Nagar
    [18.4575, 73.8508, 18.5314, 73.8446], // Katraj -> Deccan
  ];
  const openNow = now > istAt(now, 0, 10) && now < istAt(now, 0, 18, 30);
  for (const [k, person] of people.entries()) {
    const [aLat, aLng, bLat, bLng] = ROUTES[k % ROUTES.length]!;
    for (const dayOffset of [-1, 0]) {
      const start = istAt(now, dayOffset, 9, 45 + k * 5);
      if (start > now) continue;
      const closedToday = dayOffset === 0 && (k === 2 || !openNow);
      const end = dayOffset === -1 || closedToday ? Math.min(now, istAt(now, dayOffset, 18, 15 - k * 10)) : null;
      const session = await prisma.attendanceSession.create({
        data: {
          workspaceId: wid,
          userId: person.id,
          date: isoDate(start),
          checkInAt: new Date(start),
          checkInLat: aLat,
          checkInLng: aLng,
          checkInAccuracy: 12,
          checkOutAt: end ? new Date(end) : null,
          checkOutLat: end ? bLat : null,
          checkOutLng: end ? bLng : null,
          checkOutAccuracy: end ? 15 : null,
          checkOutReason: end ? 'manual' : null,
        },
      });
      const last = end ?? Math.min(now - MIN, istAt(now, dayOffset, 18, 30));
      const pings: Prisma.LocationPingCreateManyInput[] = [];
      const steps = Math.max(1, Math.floor((last - start) / (2 * MIN)));
      const stops = [0.3, 0.65].map((f) => Math.floor(steps * f));
      let progress = 0;
      for (let s = 0; s <= steps; s++) {
        const at = start + s * 2 * MIN;
        // a 20-30 minute stop (10-15 pings) at two points of the route
        const atStop = stops.some((st) => s >= st && s < st + 10 + (k % 2) * 5);
        if (!atStop) progress = Math.min(1, progress + 1 / Math.max(1, steps - 25));
        const jitter = () => (rng() - 0.5) * 0.0004;
        pings.push({ workspaceId: wid, userId: person.id, sessionId: session.id, at: new Date(at), lat: aLat + (bLat - aLat) * progress + jitter(), lng: aLng + (bLng - aLng) * progress + jitter(), accuracy: 8 + rng() * 20, speed: atStop ? 0 : 6 + rng() * 6, battery: Math.max(15, 95 - Math.floor(s / 6)) });
      }
      await prisma.locationPing.createMany({ data: pings, skipDuplicates: true });
    }
  }
}
