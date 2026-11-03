import { describe, expect, it } from 'vitest';
import {
  addBillingCycle,
  API_ROUTES,
  ApiErrorSchema,
  isUpgrade,
  PERMISSIONS,
  PLATFORM_PERMISSIONS,
  planChangeAmountPaise,
  planLimitFor,
  PlanLimitsSchema,
  planPricePaise,
  RazorpayConfigUpdateSchema,
  TrialExtendSchema,
  usagePeriodOf,
  usageState,
  wouldExceed,
  type RouteDef,
} from '../index.js';

/** Change #19 wave C: billing helpers and contracts (pure). */

const starter = { key: 'starter' as const, priceInrMonthly: 1999, priceInrYearly: 19_990, overage: { perSeatInr: 299 } };
const growth = { key: 'growth' as const, priceInrMonthly: 5999, priceInrYearly: 59_990, overage: null };

describe('usage meters', () => {
  it('ok below 80 %, warning from 80 %, reached at the limit; null = unlimited', () => {
    expect(usageState(7, 10)).toEqual({ percent: 70, state: 'ok' });
    expect(usageState(8, 10)).toEqual({ percent: 80, state: 'warning' });
    expect(usageState(10, 10)).toEqual({ percent: 100, state: 'reached' });
    expect(usageState(12, 10).state).toBe('reached');
    expect(usageState(5, null)).toEqual({ percent: null, state: 'ok' });
    expect(usageState(0, 0).state).toBe('reached');
    expect(wouldExceed(9, 10)).toBe(false);
    expect(wouldExceed(10, 10)).toBe(true);
    expect(wouldExceed(10, null)).toBe(false);
    expect(wouldExceed(5, 10, 6)).toBe(true);
  });

  it('plan limits per metric; extra seats raise the seat limit; old rows without the new limits are unlimited', () => {
    const limits = PlanLimitsSchema.parse({ seats: 10, leads: 1000, whatsappMessagesPerMonth: 50, workflowRunsPerMonth: 20, storageMb: 500 });
    expect(planLimitFor(limits, 'seats', 3)).toBe(13);
    expect(planLimitFor(limits, 'leads')).toBe(1000);
    expect(planLimitFor(limits, 'storage_mb')).toBe(500);
    expect(planLimitFor(limits, 'api_keys')).toBeNull();
    expect(planLimitFor(limits, 'api_calls')).toBeNull();
    expect(planLimitFor({ ...limits, seats: null }, 'seats', 5)).toBeNull();
  });

  it('usage period is the IST calendar month', () => {
    expect(usagePeriodOf(new Date('2026-10-31T18:29:00Z'))).toBe('2026-10');
    expect(usagePeriodOf(new Date('2026-10-31T18:31:00Z'))).toBe('2026-11');
  });
});

describe('prices and plan changes', () => {
  it('cycle price in paise with extra seats (yearly = 12 x the seat price)', () => {
    expect(planPricePaise(starter, 'monthly')).toBe(199_900);
    expect(planPricePaise(starter, 'yearly')).toBe(1_999_000);
    expect(planPricePaise(starter, 'monthly', 2)).toBe(199_900 + 2 * 29_900);
    expect(planPricePaise(starter, 'yearly', 1)).toBe(1_999_000 + 12 * 29_900);
    expect(planPricePaise(growth, 'monthly', 4)).toBe(599_900);
  });

  it('upgrade = higher monthly price', () => {
    expect(isUpgrade(starter, growth)).toBe(true);
    expect(isUpgrade(growth, starter)).toBe(false);
    expect(isUpgrade({ key: 'free', priceInrMonthly: 0 }, { key: 'starter', priceInrMonthly: 0 })).toBe(true);
  });

  it('billing periods end on the same day next month, clamped to the month end', () => {
    expect(addBillingCycle(new Date('2026-01-31T10:00:00Z'), 'monthly').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addBillingCycle(new Date('2026-11-03T00:00:00Z'), 'monthly').toISOString()).toBe('2026-12-03T00:00:00.000Z');
    expect(addBillingCycle(new Date('2028-02-29T00:00:00Z'), 'yearly').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });

  it('prorated upgrade: price difference for the rest of the period; restart: new price minus unused credit', () => {
    const periodStart = new Date('2026-11-01T00:00:00Z');
    const periodEnd = new Date('2026-12-01T00:00:00Z');
    const half = new Date('2026-11-16T00:00:00Z');
    // 15 of 30 days left: (5999 - 1999) x 0.5 = 2000 rupees
    expect(planChangeAmountPaise({ fromPricePaise: 199_900, toPricePaise: 599_900, periodStart, periodEnd, now: half, restart: false, fromPaid: true })).toBe(200_000);
    // from a trial (nothing paid): the full new price
    expect(planChangeAmountPaise({ fromPricePaise: 0, toPricePaise: 599_900, periodStart, periodEnd, now: half, restart: true, fromPaid: false })).toBe(599_900);
    // monthly -> yearly restart: yearly price minus half the monthly price
    expect(planChangeAmountPaise({ fromPricePaise: 199_900, toPricePaise: 1_999_000, periodStart, periodEnd, now: half, restart: true, fromPaid: true })).toBe(1_999_000 - 99_950);
    // never negative
    expect(planChangeAmountPaise({ fromPricePaise: 599_900, toPricePaise: 199_900, periodStart, periodEnd, now: half, restart: false, fromPaid: true })).toBe(0);
  });
});

describe('billing contracts', () => {
  it('the 402 error body carries planLimit', () => {
    const body = { error: { code: 'PLAN_LIMIT_REACHED', message: 'Your Free plan allows 3 users.', planLimit: { metric: 'seats', limit: 3, used: 3, plan: 'free', upgradePlan: 'starter', upgradeUrl: '/app/billing?upgrade=starter' } } };
    expect(ApiErrorSchema.parse(body).error.planLimit?.upgradePlan).toBe('starter');
  });

  it('Razorpay config: key id must match the mode; secrets optional on update', () => {
    expect(RazorpayConfigUpdateSchema.safeParse({ mode: 'test', keyId: 'rzp_test_abcdef123' }).success).toBe(true);
    expect(RazorpayConfigUpdateSchema.safeParse({ mode: 'live', keyId: 'rzp_test_abcdef123' }).success).toBe(false);
    expect(RazorpayConfigUpdateSchema.safeParse({ mode: 'live', keyId: 'not-a-key' }).success).toBe(false);
  });

  it('trial extension takes days or a date, not both', () => {
    expect(TrialExtendSchema.safeParse({ days: 7, reason: 'Pilot extended' }).success).toBe(true);
    expect(TrialExtendSchema.safeParse({ until: '2026-12-31', reason: 'Pilot extended' }).success).toBe(true);
    expect(TrialExtendSchema.safeParse({ days: 7, until: '2026-12-31', reason: 'Pilot extended' }).success).toBe(false);
    expect(TrialExtendSchema.safeParse({ reason: 'Pilot extended' }).success).toBe(false);
  });

  it('32 billing routes owned by backend-core in phase 19 with existing permissions', () => {
    const routes = Object.entries(API_ROUTES) as Array<[string, RouteDef]>;
    const ids = Object.keys(API_ROUTES);
    const wave = routes.slice(ids.indexOf('billingOverview'), ids.indexOf('superRazorpayDelete') + 1);
    expect(wave).toHaveLength(32);
    const all = [...PERMISSIONS, ...PLATFORM_PERMISSIONS] as readonly string[];
    for (const [id, r] of wave) {
      expect(r.owner, id).toBe('backend-core');
      expect(r.phase, id).toBe(19);
      if (r.permission) expect(all, id).toContain(r.permission);
      if (r.path.startsWith('/api/super/')) expect(r.auth, id).toBe('super');
      expect(r.response !== null || !!r.responseContentType, id).toBe(true);
    }
    expect(API_ROUTES.razorpayWebhook).toMatchObject({ auth: 'webhook', absolute: true, path: '/api/hooks/razorpay' });
  });
});
