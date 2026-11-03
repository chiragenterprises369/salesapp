import { vi } from 'vitest';

// Force the dev mock checkout for this file (a Razorpay config in the dev database must not be called).
vi.hoisted(() => {
  process.env.BILLING_PROVIDER = 'mock';
});

import {
  ApiErrorSchema,
  BillingOverviewSchema,
  BillingUsageSchema,
  CheckoutSchema,
  CompanyBillingSchema,
  gstinCheckChar,
  PLATFORM_SETTING_KEYS,
  PlanChangeResultSchema,
  PlatformInvoiceSchema,
  RazorpayConfigStatusSchema,
  SubscriptionListSchema,
} from '@vistar/shared';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEnv } from '../../config/env.js';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Billing over HTTP (change #19 wave C): usage and plan limits (402 body), GST on Vistar invoices (intra and
 * inter-state), mock checkout and verify, Razorpay webhook signature and idempotency, Super Admin billing.
 * The Vistar billing profile and the Razorpay config rows are restored afterwards.
 */
const gstin = (state: string, pan = 'AAHCV4821K') => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;
const addr = (stateCode: string, city: string) => ({ line1: '12 Test Road', city, stateCode, pincode: '411001', country: 'IN' });

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let superToken: string;
let savedSettings: Array<{ key: string; value: unknown; secretEncrypted: string | null }> = [];
const secret = () => getEnv().BILLING_MOCK_SECRET;

beforeAll(async () => {
  h = await createHarness('bill');
  const keys = [PLATFORM_SETTING_KEYS.billingProfile, PLATFORM_SETTING_KEYS.razorpay];
  savedSettings = (await h.prisma.platformSetting.findMany({ where: { key: { in: keys } } })).map((r) => ({ key: r.key, value: r.value, secretEncrypted: r.secretEncrypted }));
  await h.prisma.platformSetting.deleteMany({ where: { key: PLATFORM_SETTING_KEYS.razorpay } });
  a = await h.workspace('a');
  b = await h.workspace('b');
  superToken = (await h.superAdmin(['platform.billing.manage', 'platform.system.manage', 'platform.plans.manage'])).token;
  const profile = await h.api().put('/api/super/billing/profile').set(bearer(superToken)).send({ legalName: 'Vistar Test Pvt Ltd', gstin: gstin('27'), address: addr('27', 'Pune'), invoicePrefix: 'VST' });
  expect(profile.status, JSON.stringify(profile.body)).toBe(200);
  expect(profile.body.complete).toBe(true);
}, 90_000);

afterAll(async () => {
  if (h) {
    const keys = [PLATFORM_SETTING_KEYS.billingProfile, PLATFORM_SETTING_KEYS.razorpay];
    await h.prisma.platformSetting.deleteMany({ where: { key: { in: keys } } });
    for (const s of savedSettings) await h.prisma.platformSetting.create({ data: { key: s.key, value: s.value as object, secretEncrypted: s.secretEncrypted } });
    await h.close();
  }
});

describe('company billing page', () => {
  it('overview: trialing free plan, seven meters, mock checkout available', async () => {
    const res = await h.api().get('/api/v1/billing').set(bearer(a.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const o = BillingOverviewSchema.parse(res.body);
    expect(o.subscription.plan).toBe('free');
    expect(o.subscription.status).toBe('trialing');
    expect(o.usage.meters.map((m) => m.metric)).toEqual(['seats', 'leads', 'storage_mb', 'whatsapp_messages', 'api_calls', 'workflow_runs', 'api_keys']);
    expect(o.checkout).toEqual({ available: true, provider: 'mock', mode: 'test' });
  });

  it('usage numbers equal the database counts', async () => {
    const res = await h.api().get('/api/v1/billing/usage').set(bearer(a.token));
    const usage = BillingUsageSchema.parse(res.body);
    const seats = await h.prisma.user.count({ where: { workspaceId: a.workspaceId, isActive: true, deletedAt: null } });
    const leads = await h.prisma.lead.count({ where: { workspaceId: a.workspaceId, deletedAt: null } });
    expect(usage.meters.find((m) => m.metric === 'seats')!.used).toBe(seats);
    expect(usage.meters.find((m) => m.metric === 'leads')!.used).toBe(leads);
  });

  it('employees cannot see billing; plans list only active plans', async () => {
    const emp = await h.member(b.workspaceId, 'employee', 'bill-emp');
    expect((await h.api().get('/api/v1/billing').set(bearer(emp.token))).status).toBe(403);
    const plans = await h.api().get('/api/v1/billing/plans').set(bearer(a.token));
    expect(plans.status).toBe(200);
    expect(plans.body.items.every((p: { isActive: boolean }) => p.isActive)).toBe(true);
  });
});

describe('plan limits (402 PLAN_LIMIT_REACHED)', () => {
  it('seats: the free plan allows 3 users (pending invites count)', async () => {
    await h.member(a.workspaceId, 'employee', 'seat1');
    await h.member(a.workspaceId, 'employee', 'seat2');
    const res = await h.api().post('/api/v1/invites').set(bearer(a.token)).send({ email: `test-bill-seat3-${h.sfx}@example.test`, roleId: (await h.prisma.role.findFirstOrThrow({ where: { workspaceId: a.workspaceId, key: 'employee' } })).id, expiresInDays: 7 });
    expect(res.status, JSON.stringify(res.body)).toBe(402);
    const err = ApiErrorSchema.parse(res.body).error;
    expect(err.code).toBe('PLAN_LIMIT_REACHED');
    expect(err.planLimit).toMatchObject({ metric: 'seats', limit: 3, used: 3, plan: 'free', upgradePlan: 'starter', upgradeUrl: '/app/billing?upgrade=starter' });
  });

  it('leads: the 501st lead on the free plan is refused', async () => {
    const pipeline = await h.prisma.pipeline.findFirstOrThrow({ where: { workspaceId: b.workspaceId, isDefault: true } });
    const stage = await h.prisma.stage.findFirstOrThrow({ where: { workspaceId: b.workspaceId, pipelineId: pipeline.id } });
    await h.prisma.lead.createMany({ data: Array.from({ length: 500 }, (_, i) => ({ workspaceId: b.workspaceId, name: `Bulk ${i}`, pipelineId: pipeline.id, stageId: stage.id, position: `a${String(i).padStart(4, '0')}` })) });
    const res = await h.api().post('/api/v1/leads').set(bearer(b.token)).send({ name: 'One too many' });
    expect(res.status, JSON.stringify(res.body)).toBe(402);
    expect(res.body.error.planLimit).toMatchObject({ metric: 'leads', limit: 500, used: 500 });
    await h.prisma.lead.deleteMany({ where: { workspaceId: b.workspaceId, name: { startsWith: 'Bulk ' } } });
  });
});

describe('upgrade with the mock checkout (GST inter-state)', () => {
  let orderId = '';
  let invoiceId = '';

  it('billing contact in Karnataka (29): the upgrade invoice charges IGST', async () => {
    const contact = await h.api().put('/api/v1/billing/contact').set(bearer(a.token)).send({ name: 'Test A Traders', gstin: gstin('29', 'AABCT1234F'), address: addr('29', 'Bengaluru') });
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const res = await h.api().post('/api/v1/billing/plan-change').set(bearer(a.token)).send({ plan: 'starter' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = PlanChangeResultSchema.parse(res.body);
    expect(r.outcome).toBe('checkout');
    expect(r.checkout?.provider).toBe('mock');
    expect(r.invoice?.number).toMatch(/^VST\/\d{4}-\d{2}\/\d{4}$/);
    orderId = r.checkout!.orderId;
    invoiceId = r.invoice!.id;
    const inv = PlatformInvoiceSchema.parse((await h.api().get(`/api/v1/billing/invoices/${invoiceId}`).set(bearer(a.token))).body);
    // Starter 1,999 a month from a trial: full price, 18 % IGST (Vistar 27 -> place of supply 29)
    expect(inv.totals).toMatchObject({ taxMode: 'inter', taxablePaise: 199_900, cgstPaise: 0, sgstPaise: 0, igstPaise: 35_982, roundOffPaise: 18, totalPaise: 235_900 });
    expect(inv.placeOfSupplyStateCode).toBe('29');
    expect(inv.seller.gstin).toBe(gstin('27'));
  });

  it('a wrong signature is rejected', async () => {
    const res = await h.api().post('/api/v1/billing/checkout/verify').set(bearer(a.token)).send({ orderId, paymentId: 'pay_fake123', signature: 'a'.repeat(64) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');
  });

  it('mock-pay + verify marks the invoice paid and applies the plan (idempotent)', async () => {
    const pay = await h.api().post('/api/v1/billing/checkout/mock-pay').set(bearer(a.token)).send({ orderId, outcome: 'success' });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.signature).toBe(createHmac('sha256', secret()).update(`${orderId}|${pay.body.paymentId}`).digest('hex'));
    const verify = await h.api().post('/api/v1/billing/checkout/verify').set(bearer(a.token)).send({ orderId, paymentId: pay.body.paymentId, signature: pay.body.signature });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    expect(verify.body.invoice.status).toBe('paid');
    expect(verify.body.subscription).toMatchObject({ plan: 'starter', status: 'active', trialEndsAt: null });
    const again = await h.api().post('/api/v1/billing/checkout/verify').set(bearer(a.token)).send({ orderId, paymentId: pay.body.paymentId, signature: pay.body.signature });
    expect(again.status).toBe(200);
    expect(await h.prisma.platformPayment.count({ where: { invoiceId, status: 'captured' } })).toBe(1);
    expect((await h.prisma.workspace.findUniqueOrThrow({ where: { id: a.workspaceId } })).plan).toBe('starter');
  });

  it('another company cannot read the invoice', async () => {
    expect((await h.api().get(`/api/v1/billing/invoices/${invoiceId}`).set(bearer(b.token))).status).toBe(404);
  });

  it('a downgrade waits for the period end', async () => {
    const res = await h.api().post('/api/v1/billing/plan-change').set(bearer(a.token)).send({ plan: 'free' });
    const r = PlanChangeResultSchema.parse(res.body);
    expect(r.outcome).toBe('scheduled');
    expect(r.subscription.scheduledChange?.plan).toBe('free');
    const cancel = await h.api().delete('/api/v1/billing/plan-change').set(bearer(a.token));
    expect(cancel.body.subscription.scheduledChange).toBeNull();
  });
});

describe('Razorpay webhook (mock secret in development)', () => {
  let invoiceId = '';
  let orderId = '';
  const payload = () => ({ event: 'payment.captured', payload: { payment: { entity: { id: `pay_wh${h.sfx.replace(/[^A-Za-z0-9]/g, '')}`, order_id: orderId, amount: 0, status: 'captured' } } } });

  it('Super Admin manual invoice (intra-state, no contact: Vistar state) and checkout start', async () => {
    const res = await h.api().post(`/api/super/billing/companies/${b.workspaceId}/invoices`).set(bearer(superToken)).send({ lines: [{ name: 'Onboarding', unitPricePaise: 100_000 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = PlatformInvoiceSchema.parse(res.body);
    expect(inv.totals).toMatchObject({ taxMode: 'intra', taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, totalPaise: 118_000 });
    invoiceId = inv.id;
    const start = await h.api().post(`/api/v1/billing/invoices/${invoiceId}/pay`).set(bearer(b.token));
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    const checkout = CheckoutSchema.parse(start.body);
    expect(checkout.amountPaise).toBe(118_000);
    orderId = checkout.orderId;
  });

  it('bad signature: 401', async () => {
    const body = JSON.stringify(payload());
    const res = await h.api().post('/api/hooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'b'.repeat(64)).send(body);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('signed payment.captured marks the invoice paid; the same event id is a duplicate', async () => {
    const p = payload();
    p.payload.payment.entity.amount = 118_000;
    const body = JSON.stringify(p);
    const sig = createHmac('sha256', secret()).update(body).digest('hex');
    const eventId = `evt_${h.sfx}`;
    const res = await h.api().post('/api/hooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', eventId).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ ok: true, duplicate: false });
    const inv = await h.api().get(`/api/super/billing/invoices/${invoiceId}`).set(bearer(superToken));
    expect(inv.body.status).toBe('paid');
    const replay = await h.api().post('/api/hooks/razorpay').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).set('X-Razorpay-Event-Id', eventId).send(body);
    expect(replay.body).toEqual({ ok: true, duplicate: true });
    await h.prisma.billingWebhookEvent.deleteMany({ where: { eventId } });
  });
});

describe('Super Admin billing', () => {
  it('subscriptions list with totals', async () => {
    const res = await h.api().get('/api/super/billing/subscriptions').query({ q: `test-bill-a-${h.sfx}` }).set(bearer(superToken));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const list = SubscriptionListSchema.parse(res.body);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.subscription.plan).toBe('starter');
    expect(list.totals.companies).toBe(1);
    expect(list.totals.mrrPaise).toBe(199_900);
  });

  it('manual invoice, mark paid (idempotent with clientPaymentId), cancel rules', async () => {
    const created = await h.api().post(`/api/super/billing/companies/${a.workspaceId}/invoices`).set(bearer(superToken)).send({ lines: [{ name: 'Training', unitPricePaise: 50_000 }], issue: false });
    expect(created.body.status).toBe('draft');
    expect(created.body.number).toBeNull();
    // drafts are not visible to the company
    expect((await h.api().get(`/api/v1/billing/invoices/${created.body.id}`).set(bearer(a.token))).status).toBe(404);
    const issued = await h.api().post(`/api/super/billing/invoices/${created.body.id}/issue`).set(bearer(superToken)).send({});
    expect(issued.body.status).toBe('issued');
    const body = { mode: 'bank_transfer', reference: 'UTR123', clientPaymentId: `cp-${h.sfx}` };
    const paid = await h.api().post(`/api/super/billing/invoices/${created.body.id}/mark-paid`).set(bearer(superToken)).send(body);
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.status).toBe('paid');
    await h.api().post(`/api/super/billing/invoices/${created.body.id}/mark-paid`).set(bearer(superToken)).send(body);
    expect(await h.prisma.platformPayment.count({ where: { invoiceId: created.body.id } })).toBe(1);
    const cancel = await h.api().post(`/api/super/billing/invoices/${created.body.id}/cancel`).set(bearer(superToken)).send({ reason: 'Wrong amount' });
    expect(cancel.status).toBe(409);
    const pdf = await h.api().get(`/api/super/billing/invoices/${created.body.id}/pdf`).set(bearer(superToken));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });

  it('extend trial and change plan (audited)', async () => {
    const ext = await h.api().post(`/api/super/billing/companies/${b.workspaceId}/extend-trial`).set(bearer(superToken)).send({ days: 7, reason: 'Pilot extended' });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    expect(CompanyBillingSchema.parse(ext.body).subscription.status).toBe('trialing');
    const change = await h.api().post(`/api/super/billing/companies/${b.workspaceId}/plan`).set(bearer(superToken)).send({ plan: 'growth', effective: 'now', reason: 'Enterprise pilot on growth' });
    expect(change.status, JSON.stringify(change.body)).toBe(200);
    expect(change.body.subscription.plan).toBe('growth');
    expect(await h.prisma.platformAuditLog.count({ where: { workspaceId: b.workspaceId, action: { in: ['billing.trial_extend', 'billing.plan_change'] } } })).toBe(2);
  });

  it('Razorpay config: secrets are write-only and the key id must match the mode', async () => {
    const wrong = await h.api().put('/api/super/config/razorpay').set(bearer(superToken)).send({ mode: 'live', keyId: 'rzp_test_abcdef123', keySecret: 'secret-1234', webhookSecret: 'whsec-5678' });
    expect(wrong.status).toBe(400);
    const res = await h.api().put('/api/super/config/razorpay').set(bearer(superToken)).send({ mode: 'test', keyId: 'rzp_test_abcdef123', keySecret: 'secret-1234', webhookSecret: 'whsec-5678', enabled: false });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const status = RazorpayConfigStatusSchema.parse(res.body);
    expect(status).toMatchObject({ configured: true, enabled: false, mode: 'test', keyId: 'rzp_test_abcdef123', keySecretLast4: '1234', webhookSecretSet: true, activeProvider: 'mock' });
    expect(JSON.stringify(res.body)).not.toContain('whsec-5678');
    const removed = await h.api().delete('/api/super/config/razorpay').set(bearer(superToken));
    expect(removed.body.configured).toBe(false);
  });
});
