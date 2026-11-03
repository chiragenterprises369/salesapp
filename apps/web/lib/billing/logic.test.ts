import type { PlanDefinition, Subscription, UsageMeter } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import {
  formatMeterValue,
  invoiceChip,
  isPayable,
  meterPct,
  meterState,
  planAction,
  planLimitDescription,
  sortMeters,
  trialText,
  upgradeHref,
  upgradeParam,
  yearlySavingPct,
} from './logic';

const plan = (key: PlanDefinition['key'], monthly: number, yearly = monthly * 10, isActive = true) => ({ key, priceInrMonthly: monthly, priceInrYearly: yearly, isActive });
const FREE = plan('free', 0, 0);
const STARTER = plan('starter', 2999, 29_990);
const GROWTH = plan('growth', 7999, 79_990);
const sub = (over: Partial<Pick<Subscription, 'plan' | 'cycle' | 'status' | 'scheduledChange'>> = {}) => ({ plan: 'starter' as const, cycle: 'monthly' as const, status: 'active' as const, scheduledChange: null, ...over });

describe('planAction', () => {
  it('marks the current plan and cycle', () => {
    expect(planAction(sub(), STARTER, STARTER, 'monthly', true)).toEqual({ kind: 'current', label: 'Current plan' });
  });
  it('upgrades through checkout when it is available, otherwise as a request', () => {
    expect(planAction(sub(), STARTER, GROWTH, 'monthly', true)).toMatchObject({ kind: 'upgrade', via: 'checkout', label: 'Upgrade to Growth' });
    expect(planAction(sub(), STARTER, GROWTH, 'monthly', false)).toMatchObject({ kind: 'upgrade', via: 'request', label: 'Request Growth' });
  });
  it('schedules downgrades for the renewal date', () => {
    expect(planAction(sub(), STARTER, FREE, 'monthly', true)).toMatchObject({ kind: 'downgrade', via: 'schedule' });
  });
  it('monthly to yearly pays now, yearly to monthly waits for renewal', () => {
    expect(planAction(sub(), STARTER, STARTER, 'yearly', true)).toMatchObject({ kind: 'switch-cycle', via: 'checkout', label: 'Switch to yearly' });
    expect(planAction(sub({ cycle: 'yearly' }), STARTER, STARTER, 'monthly', true)).toMatchObject({ kind: 'switch-cycle', via: 'schedule' });
  });
  it('shows a scheduled change as the plan that starts at renewal', () => {
    const s = sub({ scheduledChange: { plan: 'free', cycle: 'monthly', effectiveAt: '2026-12-01T00:00:00.000Z' } });
    expect(planAction(s, STARTER, FREE, 'monthly', true)).toEqual({ kind: 'current', label: 'Starts at renewal' });
  });
  it('inactive plans cannot be picked', () => {
    expect(planAction(sub(), STARTER, plan('enterprise', 24_999, 249_990, false), 'monthly', true).kind).toBe('unavailable');
  });
  it('a cancelled subscription can pick its old plan again', () => {
    expect(planAction(sub({ status: 'cancelled' }), STARTER, STARTER, 'monthly', true).kind).not.toBe('current');
  });
});

describe('invoices', () => {
  it('overdue wins over due', () => {
    expect(invoiceChip({ status: 'issued', overdue: true }).label).toBe('Overdue');
    expect(invoiceChip({ status: 'issued', overdue: false }).label).toBe('Due');
    expect(invoiceChip({ status: 'paid', overdue: false }).label).toBe('Paid');
  });
  it('only issued invoices with a balance can be paid', () => {
    expect(isPayable({ status: 'issued', balancePaise: 1 })).toBe(true);
    expect(isPayable({ status: 'issued', balancePaise: 0 })).toBe(false);
    expect(isPayable({ status: 'draft', balancePaise: 100 })).toBe(false);
  });
});

describe('texts and helpers', () => {
  it('trial text', () => {
    expect(trialText(null)).toBeNull();
    expect(trialText(5)).toBe('Trial ends in 5 days');
    expect(trialText(1)).toBe('Trial ends in 1 day');
    expect(trialText(0)).toBe('Trial ends today');
    expect(trialText(-2)).toBe('Trial ended');
  });
  it('yearly saving', () => {
    expect(yearlySavingPct(STARTER)).toBe(17);
    expect(yearlySavingPct(FREE)).toBe(0);
  });
  it('storage in MB or GB, counts with Indian grouping', () => {
    expect(formatMeterValue(512, 'mb')).toBe('512 MB');
    expect(formatMeterValue(1536, 'mb')).toBe('1.5 GB');
    expect(formatMeterValue(123456, 'count')).toBe('1,23,456');
  });
  it('reached meters first, then warnings, then the rest in API order', () => {
    const m = (metric: UsageMeter['metric'], state: UsageMeter['state']) => ({ metric, state }) as UsageMeter;
    expect(sortMeters([m('seats', 'ok'), m('leads', 'warning'), m('api_calls', 'reached'), m('api_keys', 'ok')]).map((x) => x.metric)).toEqual(['api_calls', 'leads', 'seats', 'api_keys']);
  });
  it('?upgrade= only accepts plans', () => {
    expect(upgradeParam(new URLSearchParams('upgrade=growth'))).toBe('growth');
    expect(upgradeParam(new URLSearchParams('upgrade=javascript:alert(1)'))).toBeNull();
    expect(upgradeParam(null)).toBeNull();
  });
});

describe('402 PLAN_LIMIT_REACHED', () => {
  const limit = { metric: 'leads' as const, limit: 500, used: 500, plan: 'free' as const, upgradePlan: 'starter' as const, upgradeUrl: '/app/billing?upgrade=starter' };
  it('keeps the upgrade link on the billing page', () => {
    expect(upgradeHref(limit)).toBe('/app/billing?upgrade=starter#plans');
    expect(upgradeHref({ ...limit, upgradeUrl: 'https://evil.example/app/billing' })).toBe('/app/billing#plans');
    expect(upgradeHref({ ...limit, upgradeUrl: '/app/settings' })).toBe('/app/billing#plans');
    expect(upgradeHref(null)).toBe('/app/billing#plans');
  });
  it('describes the limit for admins and for everyone else', () => {
    expect(planLimitDescription(limit, true)).toBe('Leads: 500 of 500 on the Free plan. Starter allows more.');
    expect(planLimitDescription({ ...limit, upgradePlan: null }, false)).toMatch(/Contact Vistar for a higher limit\. Ask your company admin/);
    expect(planLimitDescription(null, false)).toBe('Ask your company admin to upgrade the plan.');
  });
});

describe('usage meter states (80 and 100 percent)', () => {
  it('matches the API rule', () => {
    expect(meterState(79, 100)).toBe('ok');
    expect(meterState(80, 100)).toBe('warn');
    expect(meterState(100, 100)).toBe('full');
    expect(meterState(5, null)).toBe('ok');
    expect(meterState(0, 0)).toBe('ok');
    expect(meterPct(1, 3)).toBe(33);
    expect(meterPct(5, null)).toBeNull();
  });
});
