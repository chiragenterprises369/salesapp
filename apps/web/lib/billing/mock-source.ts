import {
  BillingContactUpdateSchema,
  computeDocument,
  daysLeft,
  financialYearOf,
  formatDocumentNumber,
  isUpgrade,
  ManualInvoiceCreateSchema,
  MONTHLY_USAGE_METRICS,
  PartySchema,
  planLimitFor,
  planPricePaise,
  PlanChangeCreateSchema,
  PlatformInvoiceMarkPaidSchema,
  RazorpayConfigUpdateSchema,
  SellerSnapshotSchema,
  SuperPlanChangeSchema,
  TrialExtendSchema,
  USAGE_METRIC_LABELS,
  USAGE_METRICS,
  usagePeriodOf,
  usageState,
  addBillingCycle,
  type BillingCycle,
  type BillingUsage,
  type Checkout,
  type ErrorCode,
  type Plan,
  type PlanChangeRequest,
  type PlanDefinition,
  type PlatformInvoice,
  type PlatformInvoiceKind,
  type PlatformInvoiceListItem,
  type PlatformPayment,
  type RazorpayConfigStatus,
  type Subscription,
  type SubscriptionListItem,
  type SubscriptionStatus,
  type UsageMeter,
} from '@vistar/shared';
import { MOCK_WORKSPACE_ID } from '@vistar/shared/fixtures';
import type { ZodType, z } from 'zod';
import { ApiRequestError } from '../api-error';
import { noteMockUse } from '../api/data-source';
import { useSessionStore } from '../session/session';
import { world } from '../world/world';
import type { BillingFile, BillingSource, SuperBillingSource } from './source';

/**
 * In-memory billing backend for the test-only mock data mode. Seeded from the mock platform world
 * (the same companies, plans and usage as the Super Admin mock pages), parsed with the shared schemas,
 * GST from gst.ts, limits and states from billing.ts. The checkout provider is `mock` (no network): a
 * plan upgrade issues a plan_change invoice and returns a mock order; mock-pay + verify mark it paid.
 * Never used in API mode.
 */

const delay = (ms = 120 + Math.random() * 160) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function fail(code: ErrorCode, message: string, status: number, details: Array<{ path: string; message: string }> = []): never {
  throw new ApiRequestError(code, message, details.map((d) => ({ ...d, code: 'invalid' })) as never, { status });
}

function parse<S extends ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (r.success) return r.data as z.output<S>;
  fail(
    'VALIDATION_FAILED',
    'Some fields are invalid. Check them and try again.',
    400,
    r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
}

const VISTAR = SellerSnapshotSchema.parse({
  legalName: 'Vistar Software Private Limited',
  gstin: '29AAKCV1234F1ZB',
  address: { line1: '4th Floor, 80 Feet Road, Koramangala', city: 'Bengaluru', stateCode: '29', pincode: '560034', country: 'IN' },
  email: 'billing@vistar.example',
});
const SAC = '998314';

interface Order {
  orderId: string;
  invoiceId: string;
  workspaceId: string;
  paid: boolean;
}

interface Store {
  subs: Map<string, Subscription>;
  usage: Map<string, Record<string, number>>;
  names: Map<string, { name: string; slug: string; status: SubscriptionListItem['company']['status'] }>;
  invoices: PlatformInvoice[];
  payments: PlatformPayment[];
  requests: PlanChangeRequest[];
  orders: Map<string, Order>;
  /** plan_change invoice id -> the plan it pays for. */
  upgrades: Map<string, { plan: Plan; cycle: BillingCycle }>;
  razorpay: { mode: 'test' | 'live'; keyId: string; last4: string; webhook: boolean; enabled: boolean; updatedAt: string } | null;
  seq: number;
}

let store: Store | null = null;
const plans = (): readonly PlanDefinition[] => world.platform().plans;
const planDef = (k: Plan) => plans().find((p) => p.key === k) ?? plans()[0]!;

function statusOf(s: string): SubscriptionStatus {
  return s === 'trial' ? 'trialing' : s === 'active' ? 'active' : s === 'suspended' ? 'past_due' : 'cancelled';
}

function seed(): Store {
  const s: Store = { subs: new Map(), usage: new Map(), names: new Map(), invoices: [], payments: [], requests: [], orders: new Map(), upgrades: new Map(), razorpay: null, seq: 0 };
  const now = Date.now();
  for (const [i, f] of world.platform().companies.entries()) {
    const c = f.company;
    const plan = planDef(c.plan);
    const cycle: BillingCycle = i % 4 === 3 ? 'yearly' : 'monthly';
    const start = new Date(now - ((i * 5) % 27) * 86_400_000);
    const status = statusOf(c.status);
    s.names.set(c.id, { name: c.name, slug: c.slug, status: c.status });
    s.usage.set(c.id, {
      seats: f.users,
      leads: c.usage.leads,
      storage_mb: c.usage.storageMb,
      whatsapp_messages: c.usage.whatsappMessages,
      api_calls: (i * 137) % 900,
      workflow_runs: c.usage.workflowRuns,
      api_keys: i % 3,
    });
    const extraSeats = 0;
    s.subs.set(c.id, {
      id: uuid(),
      workspaceId: c.id,
      plan: c.plan,
      planName: plan.name,
      status,
      cycle,
      seatsIncluded: plan.limits.seats,
      extraSeats,
      seats: plan.limits.seats,
      pricePaise: planPricePaise(plan, cycle, extraSeats),
      currentPeriodStart: start.toISOString(),
      currentPeriodEnd: addBillingCycle(start, cycle).toISOString(),
      trialEndsAt: status === 'trialing' ? (c.trialEndsAt ?? new Date(now + 9 * 86_400_000).toISOString()) : null,
      trialDaysLeft: status === 'trialing' ? daysLeft(new Date(c.trialEndsAt ?? now + 9 * 86_400_000)) : null,
      pastDueSince: status === 'past_due' ? new Date(now - 5 * 86_400_000).toISOString() : null,
      cancelledAt: status === 'cancelled' ? new Date(now - 20 * 86_400_000).toISOString() : null,
      scheduledChange: null,
      billingContact:
        i === 0
          ? { name: 'Shakti Industries Private Limited', email: 'accounts@shakti.example', phone: '+919820012345', gstin: '27AAACS1234A1Z2', address: { line1: 'Plot 21, MIDC Bhosari', line2: null, city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411026', country: 'IN' } }
          : null,
      version: 1,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
    });
  }
  // Invoices for paid plans: last two periods (one paid, the latest due or paid), past due = overdue.
  for (const sub of s.subs.values()) {
    const plan = planDef(sub.plan);
    if (plan.priceInrMonthly === 0 || sub.status === 'trialing') continue;
    const issued = sub.currentPeriodStart.slice(0, 10);
    const prev = addDays(issued, sub.cycle === 'yearly' ? -365 : -30);
    const a = makeInvoice(s, sub.workspaceId, 'subscription', [{ name: `${plan.name} plan, ${sub.cycle}`, unitPricePaise: sub.pricePaise }], prev, true);
    pay(s, a, 'razorpay', null, prev);
    const b = makeInvoice(s, sub.workspaceId, 'subscription', [{ name: `${plan.name} plan, ${sub.cycle}`, unitPricePaise: sub.pricePaise }], sub.status === 'past_due' ? addDays(todayIst(), -12) : issued, true);
    if (sub.status === 'active' && s.seq % 3 !== 0) pay(s, b, 'razorpay', null, issued);
  }
  return s;
}

const db = () => (store ??= seed());

function buyerOf(s: Store, workspaceId: string) {
  const c = s.subs.get(workspaceId)?.billingContact;
  const name = s.names.get(workspaceId)?.name ?? 'Company';
  return PartySchema.parse({ name: c?.name ?? name, gstin: c?.gstin ?? null, email: c?.email ?? null, phone: c?.phone ?? null, billingAddress: c?.address ?? null });
}

function listItem(i: PlatformInvoice): PlatformInvoiceListItem {
  const { seller: _s, buyer: _b, placeOfSupplyStateCode: _p, lines: _l, totals: _t, notes: _n, payments: _pay, cancelledAt: _c, cancelReason: _r, ...item } = i;
  return item;
}

function refresh(i: PlatformInvoice): PlatformInvoice {
  const paid = i.payments.filter((p) => p.status === 'captured').reduce((n, p) => n + p.amountPaise, 0);
  const balance = Math.max(0, i.totalPaise - paid);
  i.paidPaise = paid;
  i.balancePaise = i.status === 'cancelled' || i.status === 'draft' ? 0 : balance;
  if (i.status === 'issued' && balance === 0 && paid > 0) {
    i.status = 'paid';
    i.paidAt = nowIso();
  }
  i.overdue = i.status === 'issued' && !!i.dueDate && i.dueDate < todayIst();
  return i;
}

function makeInvoice(
  s: Store,
  workspaceId: string,
  kind: PlatformInvoiceKind,
  lines: Array<{ name: string; description?: string | null; sacCode?: string | null; quantity?: number; unitPricePaise: number; gstRate?: number }>,
  issueDate: string,
  issue: boolean,
  extra: { dueDate?: string | null; placeOfSupply?: string | null; notes?: string | null } = {},
): PlatformInvoice {
  const sub = s.subs.get(workspaceId)!;
  const buyer = buyerOf(s, workspaceId);
  const pos = extra.placeOfSupply ?? buyer.billingAddress?.stateCode ?? VISTAR.address.stateCode;
  const doc = computeDocument(
    lines.map((l) => ({ quantity: l.quantity ?? 1, unitPricePaise: l.unitPricePaise, discountKind: 'percent' as const, discountValue: 0, gstRate: l.gstRate ?? 18, hsnSac: l.sacCode ?? SAC })),
    { sellerStateCode: VISTAR.address.stateCode, placeOfSupplyStateCode: pos },
  );
  const number = issue ? formatDocumentNumber('VST', financialYearOf(issueDate), ++s.seq) : null;
  const inv: PlatformInvoice = {
    id: uuid(),
    workspaceId,
    companyName: s.names.get(workspaceId)?.name ?? buyer.name,
    number,
    kind,
    status: issue ? 'issued' : 'draft',
    issueDate,
    dueDate: extra.dueDate === undefined ? addDays(issueDate, 7) : extra.dueDate,
    plan: kind === 'manual' ? null : sub.plan,
    cycle: kind === 'manual' ? null : sub.cycle,
    periodStart: kind === 'subscription' ? issueDate : null,
    periodEnd: kind === 'subscription' ? addDays(issueDate, sub.cycle === 'yearly' ? 365 : 30) : null,
    taxMode: doc.totals.taxMode,
    totalPaise: doc.totals.totalPaise,
    paidPaise: 0,
    balancePaise: issue ? doc.totals.totalPaise : 0,
    overdue: false,
    issuedAt: issue ? `${issueDate}T06:00:00.000Z` : null,
    paidAt: null,
    createdAt: `${issueDate}T06:00:00.000Z`,
    seller: VISTAR,
    buyer,
    placeOfSupplyStateCode: pos ?? null,
    lines: doc.lines.map((l, i) => ({
      name: lines[i]!.name,
      description: lines[i]!.description ?? null,
      sacCode: l.hsnSac ?? SAC,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      gstRate: l.gstRate as 18,
      taxablePaise: l.taxablePaise,
      cgstPaise: l.cgstPaise,
      sgstPaise: l.sgstPaise,
      igstPaise: l.igstPaise,
      totalPaise: l.totalPaise,
    })),
    totals: doc.totals,
    notes: extra.notes ?? null,
    payments: [],
    cancelledAt: null,
    cancelReason: null,
  };
  s.invoices.unshift(refresh(inv));
  return inv;
}

function pay(s: Store, inv: PlatformInvoice, provider: PlatformPayment['provider'], mode: PlatformPayment['mode'], paidOn: string, ids: { orderId?: string; paymentId?: string; reference?: string | null; note?: string | null } = {}): PlatformPayment {
  const p: PlatformPayment = {
    id: uuid(),
    workspaceId: inv.workspaceId,
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    amountPaise: inv.balancePaise || inv.totalPaise,
    status: 'captured',
    provider,
    mode,
    providerOrderId: ids.orderId ?? null,
    providerPaymentId: ids.paymentId ?? (provider === 'manual' ? null : `pay_mock${Math.random().toString(36).slice(2, 12)}`),
    reference: ids.reference ?? null,
    note: ids.note ?? null,
    paidOn,
    failureReason: null,
    createdAt: `${paidOn}T07:00:00.000Z`,
  };
  inv.payments.unshift(p);
  s.payments.unshift(p);
  refresh(inv);
  // A paid upgrade takes effect; a paid overdue invoice clears past due.
  const up = s.upgrades.get(inv.id);
  const sub = s.subs.get(inv.workspaceId);
  if (sub && inv.status === 'paid') {
    if (up) applyPlan(sub, up.plan, up.cycle, sub.extraSeats, true);
    if (sub.status === 'past_due' && !s.invoices.some((i) => i.workspaceId === sub.workspaceId && i.overdue)) {
      sub.status = 'active';
      sub.pastDueSince = null;
    }
  }
  return p;
}

function applyPlan(sub: Subscription, plan: Plan, cycle: BillingCycle, extraSeats: number, restart: boolean) {
  const def = planDef(plan);
  sub.plan = plan;
  sub.planName = def.name;
  sub.cycle = cycle;
  sub.extraSeats = extraSeats;
  sub.seatsIncluded = def.limits.seats;
  sub.seats = def.limits.seats === null ? null : def.limits.seats + extraSeats;
  sub.pricePaise = planPricePaise(def, cycle, extraSeats);
  sub.status = 'active';
  sub.trialEndsAt = null;
  sub.trialDaysLeft = null;
  sub.scheduledChange = null;
  if (restart) {
    const start = new Date();
    sub.currentPeriodStart = start.toISOString();
    sub.currentPeriodEnd = addBillingCycle(start, cycle).toISOString();
  }
  sub.version += 1;
  sub.updatedAt = nowIso();
}

function usageOf(s: Store, workspaceId: string): BillingUsage {
  const sub = s.subs.get(workspaceId)!;
  const limits = planDef(sub.plan).limits;
  const used = s.usage.get(workspaceId) ?? {};
  const meters: UsageMeter[] = USAGE_METRICS.map((metric) => {
    const limit = planLimitFor(limits, metric, sub.extraSeats);
    const u = used[metric] ?? 0;
    const st = usageState(u, limit);
    return {
      metric,
      label: USAGE_METRIC_LABELS[metric],
      unit: metric === 'storage_mb' ? ('mb' as const) : ('count' as const),
      window: MONTHLY_USAGE_METRICS.includes(metric) ? ('month' as const) : ('total' as const),
      used: u,
      limit,
      percent: st.percent,
      state: st.state,
    };
  });
  return { period: usagePeriodOf(), meters, generatedAt: nowIso() };
}

const myWorkspace = () => {
  const s = useSessionStore.getState().session;
  return s?.audience === 'workspace' ? s.me.workspace.id : MOCK_WORKSPACE_ID;
};
const subOf = (s: Store, id: string) => s.subs.get(id) ?? fail('NOT_FOUND', 'This company has no subscription.', 404);
const invoiceOf = (s: Store, id: string, workspaceId?: string) => {
  const i = s.invoices.find((x) => x.id === id && (!workspaceId || (x.workspaceId === workspaceId && x.status !== 'draft')));
  return i ?? fail('NOT_FOUND', 'This invoice was not found.', 404);
};
const page = <T>(items: T[], q: { cursor?: unknown; limit?: unknown }) => {
  const start = q.cursor ? Number(q.cursor) || 0 : 0;
  const size = Number(q.limit ?? 50) || 50;
  const slice = items.slice(start, start + size);
  return { items: slice, nextCursor: start + size < items.length ? String(start + size) : null, total: items.length };
};
const pdf = (title: string): BillingFile => ({ blob: new Blob([`%PDF-1.4\n% ${title} (mock data mode)\n%%EOF\n`], { type: 'application/pdf' }), filename: `${title.replace(/\//g, '-')}.pdf` });

function checkoutFor(s: Store, inv: PlatformInvoice): Checkout {
  const orderId = `order_mock${Math.random().toString(36).slice(2, 12)}`;
  s.orders.set(orderId, { orderId, invoiceId: inv.id, workspaceId: inv.workspaceId, paid: false });
  const c = s.subs.get(inv.workspaceId)?.billingContact;
  return {
    provider: 'mock',
    mode: null,
    keyId: null,
    scriptUrl: null,
    orderId,
    amountPaise: inv.balancePaise,
    currency: 'INR',
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    name: 'Vistar',
    description: inv.number ? `Invoice ${inv.number}` : 'Vistar subscription',
    prefill: { name: c?.name ?? null, email: c?.email ?? null, contact: c?.phone ?? null },
    notes: { workspaceId: inv.workspaceId },
  };
}

function overview(s: Store, workspaceId: string) {
  const sub = subOf(s, workspaceId);
  const open = s.invoices.filter((i) => i.workspaceId === workspaceId && i.status === 'issued');
  return {
    subscription: sub,
    plan: planDef(sub.plan),
    usage: usageOf(s, workspaceId),
    checkout: { available: true, provider: 'mock' as const, mode: null },
    pendingRequest: s.requests.find((r) => r.workspaceId === workspaceId && r.status === 'pending') ?? null,
    openInvoices: { count: open.length, balancePaise: open.reduce((n, i) => n + i.balancePaise, 0), overdue: open.filter((i) => i.overdue).length },
    nextInvoiceAt: planDef(sub.plan).priceInrMonthly > 0 ? (sub.trialEndsAt ?? sub.currentPeriodEnd) : null,
  };
}

function companyBilling(s: Store, id: string) {
  const sub = subOf(s, id);
  const n = s.names.get(id)!;
  return {
    company: { id, name: n.name, slug: n.slug, status: n.status },
    subscription: sub,
    plan: planDef(sub.plan),
    usage: usageOf(s, id),
    invoices: s.invoices.filter((i) => i.workspaceId === id).slice(0, 50).map(listItem),
    payments: s.payments.filter((p) => p.workspaceId === id).slice(0, 50),
    requests: s.requests.filter((r) => r.workspaceId === id).slice(0, 20),
  };
}

export const mockBillingSource: BillingSource = {
  async overview() {
    noteMockUse('billing');
    await delay();
    return overview(db(), myWorkspace());
  },
  async plans() {
    noteMockUse('billing');
    await delay();
    return { items: plans().filter((p) => p.isActive) as PlanDefinition[] };
  },
  async updateContact(body) {
    noteMockUse('billing');
    await delay();
    const contact = parse(BillingContactUpdateSchema, body);
    const sub = subOf(db(), myWorkspace());
    sub.billingContact = contact;
    sub.version += 1;
    return contact;
  },
  async changePlan(body) {
    noteMockUse('billing');
    await delay();
    const s = db();
    const input = parse(PlanChangeCreateSchema, body);
    const sub = subOf(s, myWorkspace());
    const cycle = input.cycle ?? sub.cycle;
    if (input.plan === sub.plan && cycle === sub.cycle) fail('PLAN_CHANGE_INVALID', `You are already on the ${sub.planName} plan.`, 422);
    const from = planDef(sub.plan);
    const to = planDef(input.plan);
    const result = { subscription: sub, checkout: null, invoice: null, request: null, warnings: [] as string[] };
    if (!isUpgrade(from, to) && !(input.plan === sub.plan && cycle === 'yearly')) {
      const used = s.usage.get(sub.workspaceId) ?? {};
      for (const m of USAGE_METRICS) {
        const limit = planLimitFor(to.limits, m, 0);
        if (limit !== null && (used[m] ?? 0) > limit) result.warnings.push(`${USAGE_METRIC_LABELS[m]}: ${used[m]} in use, the ${to.name} plan allows ${limit}.`);
      }
      sub.scheduledChange = { plan: input.plan, cycle, effectiveAt: sub.currentPeriodEnd };
      sub.version += 1;
      return { ...result, outcome: 'scheduled' as const };
    }
    const amount = planPricePaise(to, cycle, sub.extraSeats);
    if (amount === 0) {
      applyPlan(sub, input.plan, cycle, sub.extraSeats, true);
      return { ...result, outcome: 'applied' as const };
    }
    const inv = makeInvoice(s, sub.workspaceId, 'plan_change', [{ name: `Upgrade to ${to.name}, ${cycle}`, unitPricePaise: amount }], todayIst(), true, { dueDate: todayIst() });
    s.upgrades.set(inv.id, { plan: input.plan, cycle });
    return { ...result, outcome: 'checkout' as const, invoice: listItem(inv), checkout: checkoutFor(s, inv) };
  },
  async cancelChange() {
    noteMockUse('billing');
    await delay();
    const s = db();
    const sub = subOf(s, myWorkspace());
    sub.scheduledChange = null;
    for (const r of s.requests) if (r.workspaceId === sub.workspaceId && r.status === 'pending') r.status = 'cancelled';
    return overview(s, sub.workspaceId);
  },
  async invoices(q) {
    noteMockUse('billing');
    await delay();
    const id = myWorkspace();
    const rows = db()
      .invoices.filter((i) => i.workspaceId === id && i.status !== 'draft')
      .filter((i) => (!q.status || i.status === q.status) && (!q.kind || i.kind === q.kind) && (q.overdue === undefined || String(i.overdue) === String(q.overdue)))
      .map(listItem);
    return page(rows, q);
  },
  async invoice(id) {
    noteMockUse('billing');
    await delay();
    return invoiceOf(db(), id, myWorkspace());
  },
  async invoicePdf(id) {
    noteMockUse('billing');
    await delay();
    const i = invoiceOf(db(), id, myWorkspace());
    return pdf(i.number ?? 'Vistar invoice');
  },
  async payInvoice(id) {
    noteMockUse('billing');
    await delay();
    const s = db();
    const inv = invoiceOf(s, id, myWorkspace());
    if (inv.status !== 'issued' || inv.balancePaise <= 0) fail('CONFLICT', 'This invoice has nothing left to pay.', 409);
    return checkoutFor(s, inv);
  },
  async mockPay(body) {
    noteMockUse('billing');
    await delay(400);
    const s = db();
    const order = s.orders.get(body.orderId) ?? fail('NOT_FOUND', 'This payment order was not found.', 404);
    const paymentId = `pay_mock${Math.random().toString(36).slice(2, 12)}`;
    if (body.outcome === 'failure') {
      const inv = invoiceOf(s, order.invoiceId);
      const p: PlatformPayment = { id: uuid(), workspaceId: inv.workspaceId, invoiceId: inv.id, invoiceNumber: inv.number, amountPaise: inv.balancePaise, status: 'failed', provider: 'mock', mode: null, providerOrderId: order.orderId, providerPaymentId: paymentId, reference: null, note: null, paidOn: null, failureReason: 'Card declined (test)', createdAt: nowIso() };
      s.payments.unshift(p);
      inv.payments.unshift(p);
      return { orderId: order.orderId, paymentId, signature: null, error: 'The test payment was declined.' };
    }
    return { orderId: order.orderId, paymentId, signature: 'f'.repeat(64), error: null };
  },
  async verify(body) {
    noteMockUse('billing');
    await delay();
    const s = db();
    const order = s.orders.get(body.orderId) ?? fail('PAYMENT_VERIFICATION_FAILED', 'The payment could not be verified.', 400);
    const inv = invoiceOf(s, order.invoiceId);
    if (!order.paid) {
      order.paid = true;
      pay(s, inv, 'mock', null, todayIst(), { orderId: order.orderId, paymentId: body.paymentId });
    }
    return { invoice: inv, subscription: subOf(s, inv.workspaceId) };
  },
  async payments(q) {
    noteMockUse('billing');
    await delay();
    const id = myWorkspace();
    return page(db().payments.filter((p) => p.workspaceId === id && (!q.status || p.status === q.status)), q);
  },
};

// ---------------------------------------------------------------- Super Admin

function razorpayStatus(s: Store): RazorpayConfigStatus {
  const r = s.razorpay;
  return {
    configured: !!r,
    enabled: r?.enabled ?? false,
    mode: r?.mode ?? null,
    keyId: r?.keyId ?? null,
    keySecretLast4: r?.last4 ?? null,
    webhookSecretSet: r?.webhook ?? false,
    webhookUrl: 'http://localhost:4000/api/hooks/razorpay',
    activeProvider: r?.enabled ? 'razorpay' : 'mock',
    updatedAt: r?.updatedAt ?? null,
    lastWebhookAt: null,
  };
}

export const mockSuperBillingSource: SuperBillingSource = {
  async subscriptions(q) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const all: SubscriptionListItem[] = [...s.subs.values()].map((sub) => {
      const n = s.names.get(sub.workspaceId)!;
      const open = s.invoices.filter((i) => i.workspaceId === sub.workspaceId && i.status === 'issued');
      const mrr = sub.status === 'active' || sub.status === 'past_due' ? Math.round(sub.cycle === 'yearly' ? sub.pricePaise / 12 : sub.pricePaise) : 0;
      return {
        company: { id: sub.workspaceId, name: n.name, slug: n.slug, status: n.status },
        subscription: sub,
        mrrPaise: mrr,
        outstandingPaise: open.reduce((t, i) => t + i.balancePaise, 0),
        overdueInvoices: open.filter((i) => i.overdue).length,
        seatsUsed: s.usage.get(sub.workspaceId)?.seats ?? 0,
        lastPaymentAt: s.payments.find((p) => p.workspaceId === sub.workspaceId && p.status === 'captured')?.createdAt ?? null,
        pendingRequest: s.requests.some((r) => r.workspaceId === sub.workspaceId && r.status === 'pending'),
      };
    });
    const needle = typeof q.q === 'string' ? q.q.trim().toLowerCase() : '';
    const rows = all.filter(
      (r) =>
        (!needle || r.company.name.toLowerCase().includes(needle) || r.company.slug.includes(needle)) &&
        (!q.status || r.subscription.status === q.status) &&
        (!q.plan || r.subscription.plan === q.plan) &&
        (!q.cycle || r.subscription.cycle === q.cycle) &&
        (q.overdue === undefined || String(q.overdue) !== 'true' || r.overdueInvoices > 0) &&
        (!q.trialEndingDays || (r.subscription.status === 'trialing' && (r.subscription.trialDaysLeft ?? 999) <= Number(q.trialEndingDays))),
    );
    const byStatus = { trialing: 0, active: 0, past_due: 0, cancelled: 0 };
    const byPlan = { free: 0, starter: 0, growth: 0, enterprise: 0 };
    for (const r of rows) {
      byStatus[r.subscription.status] += 1;
      byPlan[r.subscription.plan] += 1;
    }
    const p = page(rows, q);
    return {
      items: p.items,
      nextCursor: p.nextCursor,
      totals: {
        companies: rows.length,
        mrrPaise: rows.reduce((t, r) => t + r.mrrPaise, 0),
        outstandingPaise: rows.reduce((t, r) => t + r.outstandingPaise, 0),
        overdueCompanies: rows.filter((r) => r.overdueInvoices > 0).length,
        byStatus,
        byPlan,
      },
    };
  },
  async company(id) {
    noteMockUse('super-billing');
    await delay();
    return companyBilling(db(), id);
  },
  async createInvoice(companyId, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    subOf(s, companyId);
    const input = parse(ManualInvoiceCreateSchema, body);
    const issueDate = input.issueDate ?? todayIst();
    return makeInvoice(s, companyId, 'manual', input.lines, issueDate, input.issue, { dueDate: input.dueDate === undefined ? addDays(issueDate, 7) : input.dueDate, placeOfSupply: input.placeOfSupplyStateCode ?? null, notes: input.notes ?? null });
  },
  async invoice(id) {
    noteMockUse('super-billing');
    await delay();
    return invoiceOf(db(), id);
  },
  async invoicePdf(id) {
    noteMockUse('super-billing');
    await delay();
    const i = invoiceOf(db(), id);
    return pdf(i.number ?? 'Vistar draft invoice');
  },
  async issueInvoice(id, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const i = invoiceOf(s, id);
    if (i.status !== 'draft') fail('CONFLICT', 'Only drafts can be issued.', 409);
    i.status = 'issued';
    i.number = formatDocumentNumber('VST', financialYearOf(i.issueDate), ++s.seq);
    i.issuedAt = nowIso();
    if (body.dueDate !== undefined) i.dueDate = body.dueDate;
    i.balancePaise = i.totalPaise;
    return refresh(i);
  },
  async markPaid(id, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const input = parse(PlatformInvoiceMarkPaidSchema, body);
    const i = invoiceOf(s, id);
    if (i.status !== 'issued') fail('CONFLICT', 'Only issued invoices can be marked paid.', 409);
    if (input.clientPaymentId && i.payments.some((p) => p.note === `client:${input.clientPaymentId}`)) return i;
    pay(s, i, 'manual', input.mode, input.paidOn ?? todayIst(), { reference: input.reference ?? null, note: input.clientPaymentId ? `client:${input.clientPaymentId}` : (input.note ?? null) });
    return i;
  },
  async cancelInvoice(id, body) {
    noteMockUse('super-billing');
    await delay();
    const i = invoiceOf(db(), id);
    if (i.status === 'paid') fail('CONFLICT', 'A paid invoice cannot be cancelled.', 409);
    i.status = 'cancelled';
    i.cancelledAt = nowIso();
    i.cancelReason = body.reason;
    return refresh(i);
  },
  async extendTrial(companyId, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const input = parse(TrialExtendSchema, body);
    const sub = subOf(s, companyId);
    const base = sub.trialEndsAt && Date.parse(sub.trialEndsAt) > Date.now() ? Date.parse(sub.trialEndsAt) : Date.now();
    // until = end of that day in India time (18:29:59.999 UTC).
    sub.trialEndsAt = input.until ? `${input.until}T18:29:59.999Z` : new Date(base + (input.days ?? 0) * 86_400_000).toISOString();
    sub.trialDaysLeft = daysLeft(new Date(sub.trialEndsAt));
    sub.status = 'trialing';
    sub.version += 1;
    return companyBilling(s, companyId);
  },
  async changePlan(companyId, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const input = parse(SuperPlanChangeSchema, body);
    const sub = subOf(s, companyId);
    const cycle = input.cycle ?? sub.cycle;
    if (input.effective === 'period_end') sub.scheduledChange = { plan: input.plan, cycle, effectiveAt: sub.currentPeriodEnd };
    else applyPlan(sub, input.plan, cycle, input.extraSeats ?? sub.extraSeats, false);
    return companyBilling(s, companyId);
  },
  async requests(q) {
    noteMockUse('super-billing');
    await delay();
    return { items: db().requests.filter((r) => !q.status || r.status === q.status) };
  },
  async decideRequest(id, body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const r = s.requests.find((x) => x.id === id) ?? fail('NOT_FOUND', 'This request was not found.', 404);
    if (r.status !== 'pending') fail('CONFLICT', 'This request was already decided.', 409);
    r.status = body.decision === 'approve' ? 'approved' : 'rejected';
    r.decidedAt = nowIso();
    r.decisionNote = body.note ?? null;
    if (body.decision === 'approve') {
      const sub = subOf(s, r.workspaceId);
      if (body.effective === 'period_end') sub.scheduledChange = { plan: r.toPlan, cycle: r.cycle, effectiveAt: sub.currentPeriodEnd };
      else applyPlan(sub, r.toPlan, r.cycle, sub.extraSeats, false);
    }
    return r;
  },
  async razorpay() {
    noteMockUse('super-billing');
    await delay();
    return razorpayStatus(db());
  },
  async saveRazorpay(body) {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    const input = parse(RazorpayConfigUpdateSchema, body);
    if (!s.razorpay && (!input.keySecret || !input.webhookSecret)) fail('VALIDATION_FAILED', 'Enter the key secret and the webhook secret.', 400, [...(!input.keySecret ? [{ path: 'keySecret', message: 'Enter the key secret' }] : []), ...(!input.webhookSecret ? [{ path: 'webhookSecret', message: 'Enter the webhook secret' }] : [])]);
    s.razorpay = { mode: input.mode, keyId: input.keyId, last4: input.keySecret ? input.keySecret.slice(-4) : (s.razorpay?.last4 ?? ''), webhook: !!input.webhookSecret || !!s.razorpay?.webhook, enabled: input.enabled, updatedAt: nowIso() };
    return razorpayStatus(s);
  },
  async removeRazorpay() {
    noteMockUse('super-billing');
    await delay();
    const s = db();
    s.razorpay = null;
    return razorpayStatus(s);
  },
};

