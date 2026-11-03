import {
  isUpgrade,
  planPricePaise,
  type BillingCycle,
  type ChipTone,
  type Plan,
  type PlanDefinition,
  type PlatformInvoiceKind,
  type PlatformInvoiceListItem,
  type PlatformInvoiceStatus,
  type PlatformPaymentStatus,
  type PaymentProvider,
  type PlanChangeStatus,
  type Subscription,
  type SubscriptionStatus,
  type UsageMeter,
} from '@vistar/shared';

/**
 * Pure helpers of the billing pages (unit tested in logic.test.ts): labels and chip tones, what a plan
 * card's button does, prices per cycle, trial and renewal text. The money rules themselves (limits,
 * 80/100 percent, upgrade vs downgrade, cycle prices) come from @vistar/shared/billing, so the page shows
 * what the API enforces.
 */

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, { label: string; tone: ChipTone }> = {
  trialing: { label: 'Trial', tone: 'indigo' },
  active: { label: 'Active', tone: 'green' },
  past_due: { label: 'Payment overdue', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

export const PLATFORM_INVOICE_STATUS: Record<PlatformInvoiceStatus, { label: string; tone: ChipTone }> = {
  draft: { label: 'Draft', tone: 'grey' },
  issued: { label: 'Due', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

export const PLATFORM_INVOICE_KIND: Record<PlatformInvoiceKind, string> = {
  subscription: 'Subscription',
  plan_change: 'Plan change',
  manual: 'Manual',
};

export const PLATFORM_PAYMENT_STATUS: Record<PlatformPaymentStatus, { label: string; tone: ChipTone }> = {
  created: { label: 'Started', tone: 'grey' },
  captured: { label: 'Paid', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  refunded: { label: 'Refunded', tone: 'amber' },
};

export const PAYMENT_PROVIDER_LABEL: Record<PaymentProvider, string> = { razorpay: 'Razorpay', mock: 'Test payment', manual: 'Recorded by Vistar' };

export const PLAN_REQUEST_STATUS: Record<PlanChangeStatus, { label: string; tone: ChipTone }> = {
  pending: { label: 'Waiting for Vistar', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  cancelled: { label: 'Withdrawn', tone: 'grey' },
};

export const CYCLE_LABEL: Record<BillingCycle, string> = { monthly: 'Monthly', yearly: 'Yearly' };

/** Chip for a Vistar invoice: overdue wins over "Due". */
export function invoiceChip(i: Pick<PlatformInvoiceListItem, 'status' | 'overdue'>): { label: string; tone: ChipTone } {
  return i.overdue && i.status === 'issued' ? { label: 'Overdue', tone: 'red' } : PLATFORM_INVOICE_STATUS[i.status];
}

/** An invoice the company can pay online: issued with a balance. */
export const isPayable = (i: Pick<PlatformInvoiceListItem, 'status' | 'balancePaise'>) => i.status === 'issued' && i.balancePaise > 0;

/** Price of a plan for a cycle in whole rupees (PlanDefinition prices are rupees). */
export const cyclePriceInr = (p: Pick<PlanDefinition, 'priceInrMonthly' | 'priceInrYearly'>, cycle: BillingCycle) => (cycle === 'yearly' ? p.priceInrYearly : p.priceInrMonthly);

/** Yearly saving against 12 monthly payments, in percent (0 when none). */
export function yearlySavingPct(p: Pick<PlanDefinition, 'priceInrMonthly' | 'priceInrYearly'>): number {
  const twelve = p.priceInrMonthly * 12;
  if (twelve <= 0 || p.priceInrYearly >= twelve) return 0;
  return Math.round(((twelve - p.priceInrYearly) / twelve) * 100);
}

export type PlanAction =
  | { kind: 'current'; label: string }
  | { kind: 'upgrade' | 'downgrade' | 'switch-cycle'; label: string; via: 'checkout' | 'request' | 'schedule' }
  | { kind: 'unavailable'; label: string };

/**
 * What a plan card's button does for this subscription. Upgrades go through checkout when it is
 * available, otherwise they become a request for the Super Admin; downgrades are scheduled for the
 * period end (API: billingPlanChange outcome `scheduled`).
 */
export function planAction(
  sub: Pick<Subscription, 'plan' | 'cycle' | 'status' | 'scheduledChange'>,
  current: Pick<PlanDefinition, 'key' | 'priceInrMonthly'>,
  target: Pick<PlanDefinition, 'key' | 'priceInrMonthly' | 'isActive'>,
  cycle: BillingCycle,
  checkoutAvailable: boolean,
): PlanAction {
  if (!target.isActive) return { kind: 'unavailable', label: 'Not available' };
  const samePlan = target.key === sub.plan;
  if (samePlan && cycle === sub.cycle && sub.status !== 'cancelled') return { kind: 'current', label: 'Current plan' };
  if (sub.scheduledChange && sub.scheduledChange.plan === target.key && sub.scheduledChange.cycle === cycle) return { kind: 'current', label: 'Starts at renewal' };
  const via = checkoutAvailable ? 'checkout' : 'request';
  if (samePlan) return { kind: 'switch-cycle', label: cycle === 'yearly' ? 'Switch to yearly' : 'Switch to monthly', via: cycle === 'yearly' ? via : 'schedule' };
  if (isUpgrade(current, target)) return { kind: 'upgrade', label: checkoutAvailable ? `Upgrade to ${planName(target.key)}` : `Request ${planName(target.key)}`, via };
  return { kind: 'downgrade', label: `Move to ${planName(target.key)}`, via: 'schedule' };
}

const PLAN_NAME: Record<Plan, string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
export const planName = (p: Plan) => PLAN_NAME[p];

/** Price before GST of the subscription's cycle for a plan, in paise (extra seats included). */
export const subscriptionPricePaise = (plan: PlanDefinition, cycle: BillingCycle, extraSeats: number) => planPricePaise(plan, cycle, extraSeats);

/** "Trial ends in 5 days", "Trial ends today", "Trial ended". */
export function trialText(daysLeft: number | null): string | null {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return 'Trial ended';
  if (daysLeft === 0) return 'Trial ends today';
  return `Trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
}

/** The meters to show first: reached, then warning, then the rest in API order. */
export function sortMeters(meters: readonly UsageMeter[]): UsageMeter[] {
  const rank = { reached: 0, warning: 1, ok: 2 } as const;
  return meters
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rank[a.m.state] - rank[b.m.state] || a.i - b.i)
    .map((x) => x.m);
}

/** Meter state of the contract -> the UsageMeter component's state. */
export const meterUiState = (s: UsageMeter['state']) => (s === 'reached' ? 'full' : s === 'warning' ? 'warn' : 'ok');

/** "1.2 GB" style for storage meters (unit mb), plain Indian grouping otherwise. */
export function formatMeterValue(n: number, unit: UsageMeter['unit']): string {
  if (unit === 'mb') return n >= 1024 ? `${(n / 1024).toFixed(n >= 10_240 ? 0 : 1)} GB` : `${n} MB`;
  return new Intl.NumberFormat('en-IN').format(n);
}

/** `?upgrade=<plan>` from the 402 upgradeUrl (or the toast link): which plan card to highlight. */
export function upgradeParam(search: URLSearchParams | null): Plan | null {
  const v = search?.get('upgrade');
  return v === 'free' || v === 'starter' || v === 'growth' || v === 'enterprise' ? v : null;
}
