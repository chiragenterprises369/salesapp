import {
  addBillingCycle,
  computeDocument,
  financialYearOf,
  gstinCheckChar,
  formatDocumentNumber,
  PLATFORM_SETTING_KEYS,
  planPricePaise,
  PlanDefinitionSchema,
  stateName,
  type BillingCycle,
  type GstRate,
  type Plan,
  type PlatformBillingProfile,
  type PlatformInvoiceKind,
} from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { CompanyCtx } from './company.js';

/**
 * Demo billing (change #19 wave C, `seed:demo` only): the Vistar billing profile (Pune, state 27), a subscription
 * per company in mixed states and 6 Vistar invoices with payments, numbered VST/<FY>/<seq> from the platform series.
 *   Shakti (growth, monthly, active, buyer state 27 = CGST + SGST): 3 paid invoices (two past periods and the current one).
 *   Navkar (starter, monthly, past due, buyer state 24 = IGST): 1 paid, 1 overdue for 5 days (reminders day 0 and 3 sent).
 *   Sunrise (free, trialing, 10 days left, buyer state 29): 1 open manual invoice (onboarding), a pending upgrade request.
 */

const DAY = 86_400_000;

export const VISTAR_PROFILE: PlatformBillingProfile = {
  legalName: 'Vistar Technologies Private Limited',
  tradeName: 'Vistar',
  gstin: `27AAHCV4821K1Z${gstinCheckChar('27AAHCV4821K1Z')}`,
  pan: 'AAHCV4821K',
  address: { line1: '5th Floor, Panchshil Tech Park, Yerawada', line2: null, city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411006', country: 'IN' },
  phone: '+912067300000',
  email: 'billing@vistar.example',
  website: null,
  bank: { accountName: 'Vistar Technologies Private Limited', accountNumber: '50200087654321', ifsc: 'HDFC0000123', bankName: 'HDFC Bank', branch: 'Yerawada, Pune', upiId: 'vistar@hdfcbank' },
  signatureLabel: 'Authorised signatory',
  invoicePrefix: 'VST',
  sacCode: '998314',
  gstRate: 18,
  paymentTermsDays: 7,
  invoiceTerms: 'Payment within 7 days by UPI, bank transfer or the Pay button on the Billing page. GST is charged under SAC 998314 (IT services).',
  brandColor: '#4F46E5',
};

/** Vistar's seller identity for platform invoices (PlatformSetting billing.vistarProfile). */
export async function seedVistarProfile(prisma: PrismaClient): Promise<void> {
  const value = VISTAR_PROFILE as unknown as Prisma.InputJsonObject;
  await prisma.platformSetting.upsert({ where: { key: PLATFORM_SETTING_KEYS.billingProfile }, create: { key: PLATFORM_SETTING_KEYS.billingProfile, value }, update: { value } });
}

const istDate = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
const dbDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('-');

async function allocate(prisma: PrismaClient, issueDate: string): Promise<{ number: string; financialYear: string; sequence: number }> {
  const fy = financialYearOf(issueDate);
  const rows = await prisma.$queryRaw<Array<{ seq: number; prefix: string }>>`
    INSERT INTO "PlatformInvoiceSeries" ("id", "financialYear", "prefix", "nextNumber", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${fy}, ${VISTAR_PROFILE.invoicePrefix}, 2, now(), now())
    ON CONFLICT ("financialYear") DO UPDATE SET "nextNumber" = "PlatformInvoiceSeries"."nextNumber" + 1, "updatedAt" = now()
    RETURNING ("nextNumber" - 1)::int AS seq, "prefix"`;
  const row = rows[0]!;
  return { number: formatDocumentNumber(row.prefix, fy, row.seq), financialYear: fy, sequence: row.seq };
}

interface DemoInvoice {
  kind: PlatformInvoiceKind;
  lines: Array<{ name: string; description: string; unitPricePaise: number; quantity?: number }>;
  plan: Plan | null;
  cycle: BillingCycle | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  issuedAt: number;
  dueDays: number;
  paid: null | { at: number; provider: 'mock' | 'manual'; mode: 'upi' | 'bank_transfer' | null; reference: string | null };
}

export interface BillingSeedSummary {
  status: string;
  plan: Plan;
  invoices: number;
  paid: number;
}

/** Subscription, billing contact, invoices and payments of one demo company. */
export async function seedBilling(prisma: PrismaClient, ctx: CompanyCtx, index: number): Promise<BillingSeedSummary> {
  const wid = ctx.workspaceId;
  const now = Date.now();
  const planKey = ctx.fx.plan;
  const planRow = await prisma.planDefinition.findUniqueOrThrow({ where: { key: planKey } });
  const plan = PlanDefinitionSchema.parse({ ...planRow, overage: planRow.overage ?? null });
  const seller = (await prisma.setting.findFirst({ where: { workspaceId: wid, scope: 'workspace', key: 'billing.sellerProfile' }, select: { value: true } }))?.value as { legalName: string; gstin: string | null; address: Record<string, unknown> & { stateCode: string } } | undefined;
  const stateCode = seller?.address.stateCode ?? '27';
  const contact = {
    name: seller?.legalName ?? `${ctx.workspaceName} Private Limited`,
    email: ctx.admin.email,
    phone: ctx.admin.phone ?? null,
    gstin: seller?.gstin ?? null,
    address: seller?.address ? { ...seller.address, state: stateName(stateCode) } : null,
  };
  const price = planPricePaise(plan, 'monthly', 0);
  const variant = ctx.fx.status === 'trial' ? 2 : index % 2;
  const periodStart = new Date(now - 10 * DAY);
  const periodEnd = addBillingCycle(periodStart, 'monthly');
  const invoices: DemoInvoice[] = [];
  let status: 'trialing' | 'active' | 'past_due' = 'active';
  let pastDueSince: Date | null = null;
  let dunningStep = 0;
  let trialEndsAt: Date | null = null;
  const periodLine = (start: Date, end: Date) => ({ name: `${plan.name} plan, monthly`, description: `Service period ${fmt(start)} to ${fmt(new Date(end.getTime() - 1))}`, unitPricePaise: price });
  if (variant === 0) {
    // Shakti: active, three paid monthly invoices (paid with the mock checkout)
    for (let k = 2; k >= 0; k--) {
      const start = addMonths(periodStart, -k);
      const end = addBillingCycle(start, 'monthly');
      invoices.push({ kind: 'subscription', lines: [periodLine(start, end)], plan: planKey, cycle: 'monthly', periodStart: start, periodEnd: new Date(end.getTime() - 1), issuedAt: start.getTime(), dueDays: 7, paid: { at: start.getTime() + (2 + k) * DAY, provider: 'mock', mode: null, reference: null } });
    }
  } else if (variant === 1) {
    // Navkar: previous period paid by bank transfer, the current one (issued 12 days ago) overdue for 5 days
    const curStart = new Date(now - 12 * DAY);
    const curEnd = addBillingCycle(curStart, 'monthly');
    const prevStart = addMonths(curStart, -1);
    invoices.push({ kind: 'subscription', lines: [periodLine(prevStart, curStart)], plan: planKey, cycle: 'monthly', periodStart: prevStart, periodEnd: new Date(curStart.getTime() - 1), issuedAt: prevStart.getTime(), dueDays: 7, paid: { at: prevStart.getTime() + 6 * DAY, provider: 'manual', mode: 'bank_transfer', reference: 'UTR HDFCN52026110412' } });
    invoices.push({ kind: 'subscription', lines: [periodLine(curStart, curEnd)], plan: planKey, cycle: 'monthly', periodStart: curStart, periodEnd: new Date(curEnd.getTime() - 1), issuedAt: curStart.getTime(), dueDays: 7, paid: null });
    status = 'past_due';
    pastDueSince = new Date(now - 5 * DAY);
    dunningStep = 2;
  } else {
    // Sunrise: free trial with 10 days left, an onboarding invoice and an upgrade request
    status = 'trialing';
    trialEndsAt = new Date(now + 10 * DAY);
    invoices.push({ kind: 'manual', lines: [{ name: 'Onboarding and data import', description: 'Lead import from spreadsheets and two training sessions', unitPricePaise: 499_900 }], plan: null, cycle: null, periodStart: null, periodEnd: null, issuedAt: now - 2 * DAY, dueDays: 7, paid: null });
  }

  const subData = {
    plan: planKey,
    status,
    cycle: 'monthly' as const,
    currentPeriodStart: status === 'trialing' ? new Date(ctx.createdAt) : variant === 1 ? new Date(now - 12 * DAY) : periodStart,
    currentPeriodEnd: status === 'trialing' ? trialEndsAt! : variant === 1 ? addBillingCycle(new Date(now - 12 * DAY), 'monthly') : periodEnd,
    trialEndsAt,
    pastDueSince,
    dunningStep,
    lastDunningAt: dunningStep ? new Date(now - 2 * DAY) : null,
    billingContact: contact as unknown as Prisma.InputJsonObject,
  };
  // upsert: a running API's billing cron may have created a default subscription for the new workspace already
  const sub = await prisma.subscription.upsert({ where: { workspaceId: wid }, create: { workspaceId: wid, ...subData }, update: subData });
  await prisma.workspace.update({ where: { id: wid }, data: { plan: planKey, trialEndsAt, ...(status === 'trialing' ? { status: 'trial' } : { status: 'active' }) } });

  let paidCount = 0;
  for (const inv of invoices) {
    const issueDate = istDate(inv.issuedAt);
    const dueDate = istDate(inv.issuedAt + inv.dueDays * DAY);
    const numbering = await allocate(prisma, issueDate);
    const lines = inv.lines.map((l) => ({ name: l.name, description: l.description, sacCode: VISTAR_PROFILE.sacCode, quantity: l.quantity ?? 1, unitPricePaise: l.unitPricePaise, gstRate: VISTAR_PROFILE.gstRate as GstRate, discountKind: 'percent' as const, discountValue: 0, hsnSac: VISTAR_PROFILE.sacCode }));
    const { lines: computed, totals } = computeDocument(lines, { sellerStateCode: VISTAR_PROFILE.address.stateCode, placeOfSupplyStateCode: stateCode });
    const stored = {
      lines: computed.map((l) => ({ name: l.name, description: l.description, sacCode: l.sacCode, quantity: l.quantity, unitPricePaise: l.unitPricePaise, gstRate: l.gstRate, taxablePaise: l.taxablePaise, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, totalPaise: l.totalPaise })),
      totals,
    };
    const id = randomUUID();
    await prisma.platformInvoice.create({
      data: {
        id,
        workspaceId: wid,
        number: numbering.number,
        financialYear: numbering.financialYear,
        sequence: numbering.sequence,
        kind: inv.kind,
        status: inv.paid ? 'paid' : 'issued',
        plan: inv.plan,
        cycle: inv.cycle,
        extraSeats: inv.plan ? 0 : null,
        periodStart: inv.periodStart ? dbDate(inv.periodStart.toISOString().slice(0, 10)) : null,
        periodEnd: inv.periodEnd ? dbDate(inv.periodEnd.toISOString().slice(0, 10)) : null,
        issueDate: dbDate(issueDate),
        dueDate: dbDate(dueDate),
        seller: { legalName: VISTAR_PROFILE.legalName, tradeName: VISTAR_PROFILE.tradeName, gstin: VISTAR_PROFILE.gstin, pan: VISTAR_PROFILE.pan, address: VISTAR_PROFILE.address, phone: VISTAR_PROFILE.phone, email: VISTAR_PROFILE.email, website: null, bank: VISTAR_PROFILE.bank, signatureLabel: VISTAR_PROFILE.signatureLabel } as unknown as Prisma.InputJsonObject,
        buyer: { name: contact.name, gstin: contact.gstin, pan: null, phone: contact.phone, email: contact.email, billingAddress: contact.address, shippingAddress: null, contactName: null } as unknown as Prisma.InputJsonObject,
        buyerName: contact.name,
        placeOfSupply: stateCode,
        taxMode: totals.taxMode,
        lines: stored as unknown as Prisma.InputJsonObject,
        subtotalPaise: BigInt(totals.subtotalPaise),
        discountPaise: BigInt(totals.discountPaise),
        taxablePaise: BigInt(totals.taxablePaise),
        cgstPaise: BigInt(totals.cgstPaise),
        sgstPaise: BigInt(totals.sgstPaise),
        igstPaise: BigInt(totals.igstPaise),
        roundOffPaise: BigInt(totals.roundOffPaise),
        totalPaise: BigInt(totals.totalPaise),
        paidPaise: inv.paid ? BigInt(totals.totalPaise) : 0n,
        issuedAt: new Date(inv.issuedAt),
        paidAt: inv.paid ? new Date(inv.paid.at) : null,
        createdAt: new Date(inv.issuedAt),
      },
    });
    if (inv.paid) {
      paidCount++;
      const tag = randomUUID().replace(/-/g, '').slice(0, 14);
      await prisma.platformPayment.create({
        data: {
          workspaceId: wid,
          invoiceId: id,
          amountPaise: BigInt(totals.totalPaise),
          status: 'captured',
          provider: inv.paid.provider,
          mode: inv.paid.mode,
          providerOrderId: inv.paid.provider === 'mock' ? `order_seed${tag}` : null,
          providerPaymentId: inv.paid.provider === 'mock' ? `pay_seed${tag}` : null,
          reference: inv.paid.reference,
          paidOn: dbDate(istDate(inv.paid.at)),
          createdAt: new Date(inv.paid.at),
        },
      });
    }
  }
  if (variant === 2) {
    await prisma.planChangeRequest.create({ data: { workspaceId: wid, fromPlan: planKey, toPlan: 'starter', cycle: 'monthly', status: 'pending', note: 'We are adding two more sales people next month', requestedById: ctx.admin.id, createdAt: new Date(now - DAY) } });
  }
  return { status: sub.status, plan: planKey, invoices: invoices.length, paid: paidCount };
}

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}
