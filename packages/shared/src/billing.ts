import type { BillingCycle, Plan, UsageMetric } from './enums.js';
import type { PlanLimits } from './rbac.js';

/**
 * Vistar subscription billing (change #19 wave C, D-072): pure helpers shared by the API and the web so the
 * billing page shows exactly what the API enforces. Plan prices are whole rupees (PlanDefinition), invoice money
 * is paise (D-067).
 */

/** Meters turn amber at this percentage of the limit and red at 100 (creates are blocked with PLAN_LIMIT_REACHED). */
export const USAGE_WARNING_PERCENT = 80;
/** `billing_trial_ending` is sent this many days before the trial ends (once). */
export const BILLING_TRIAL_REMINDER_DAYS = 3;
/** Days after the due date when the overdue reminders go out (`billing_payment_failed`). */
export const BILLING_DUNNING_DAYS = [0, 3, 7] as const;
/** Days an invoice may stay overdue before the subscription is cancelled and the company drops to the free plan. */
export const BILLING_GRACE_DAYS = 14;
/** GST rate and SAC code of Vistar's SaaS service lines unless the Vistar billing profile says otherwise. */
export const PLATFORM_DEFAULT_SAC = '998314';
export const PLATFORM_DEFAULT_GST_RATE = 18;
export const PLATFORM_INVOICE_PREFIX = 'VST';
export const RAZORPAY_CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';
/** PlatformSetting keys (root client only). */
export const PLATFORM_SETTING_KEYS = {
  /** PlatformBillingProfile: Vistar's GST identity on its invoices. */
  billingProfile: 'billing.vistarProfile',
  /** Razorpay: value = public part (mode, keyId, enabled), secretEncrypted = { keySecret, webhookSecret }. */
  razorpay: 'billing.razorpay',
} as const;

export const USAGE_METRIC_LABELS: Record<UsageMetric, string> = {
  seats: 'Users',
  leads: 'Leads',
  storage_mb: 'Storage (MB)',
  whatsapp_messages: 'WhatsApp messages this month',
  api_calls: 'API calls this month',
  workflow_runs: 'Workflow runs this month',
  api_keys: 'API keys',
};

/** Metrics counted per calendar month (IST); the others are current totals. */
export const MONTHLY_USAGE_METRICS: readonly UsageMetric[] = ['whatsapp_messages', 'api_calls', 'workflow_runs'];

/** The plan limit of a metric (null = unlimited). Extra seats bought on the subscription raise the seat limit. */
export function planLimitFor(limits: PlanLimits, metric: UsageMetric, extraSeats = 0): number | null {
  switch (metric) {
    case 'seats':
      return limits.seats === null ? null : limits.seats + Math.max(0, extraSeats);
    case 'leads':
      return limits.leads;
    case 'storage_mb':
      return limits.storageMb;
    case 'whatsapp_messages':
      return limits.whatsappMessagesPerMonth;
    case 'api_calls':
      return limits.apiCallsPerMonth ?? null;
    case 'workflow_runs':
      return limits.workflowRunsPerMonth;
    case 'api_keys':
      return limits.apiKeys ?? null;
  }
}

export type UsageState = 'ok' | 'warning' | 'reached';

/** ok below 80 %, warning from 80 %, reached at or above the limit. A limit of 0 is reached at once. */
export function usageState(used: number, limit: number | null): { percent: number | null; state: UsageState } {
  if (limit === null) return { percent: null, state: 'ok' };
  if (limit <= 0) return { percent: 100, state: 'reached' };
  const percent = Math.round((used / limit) * 1000) / 10;
  return { percent, state: used >= limit ? 'reached' : percent >= USAGE_WARNING_PERCENT ? 'warning' : 'ok' };
}

/** True when adding `adding` more would go over the limit. */
export const wouldExceed = (used: number, limit: number | null, adding = 1): boolean => limit !== null && used + adding > limit;

/** Price of one billing cycle before GST, in paise: plan price plus extra seats (overage.perSeatInr per month; yearly = 12 x). */
export function planPricePaise(plan: { priceInrMonthly: number; priceInrYearly: number; overage: { perSeatInr: number | null } | null }, cycle: BillingCycle, extraSeats = 0): number {
  const base = cycle === 'yearly' ? plan.priceInrYearly : plan.priceInrMonthly;
  const seat = plan.overage?.perSeatInr ?? 0;
  const seats = Math.max(0, extraSeats) * seat * (cycle === 'yearly' ? 12 : 1);
  return (base + seats) * 100;
}

/** Order used to tell upgrades from downgrades when prices tie. */
export const PLAN_ORDER: readonly Plan[] = ['free', 'starter', 'growth', 'enterprise'];

/** An upgrade costs more per month (ties: the later plan in PLAN_ORDER). */
export function isUpgrade(from: { key: Plan; priceInrMonthly: number }, to: { key: Plan; priceInrMonthly: number }): boolean {
  if (to.priceInrMonthly !== from.priceInrMonthly) return to.priceInrMonthly > from.priceInrMonthly;
  return PLAN_ORDER.indexOf(to.key) > PLAN_ORDER.indexOf(from.key);
}

/** End of a billing period: the same day of the next month or year, clamped to the month's last day (UTC). */
export function addBillingCycle(start: Date, cycle: BillingCycle): Date {
  const months = cycle === 'yearly' ? 12 : 1;
  const d = new Date(start.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/**
 * Amount due now for a plan change taking effect immediately, before GST, in paise.
 * - restart (trial, free plan, or a cycle change): the new cycle price minus the unused part of the current paid price.
 * - same cycle: the price difference for the remaining part of the period.
 * Never negative (downgrades wait for the period end and are not refunded).
 */
export function planChangeAmountPaise(o: { fromPricePaise: number; toPricePaise: number; periodStart: Date; periodEnd: Date; now: Date; restart: boolean; fromPaid: boolean }): number {
  const total = o.periodEnd.getTime() - o.periodStart.getTime();
  const left = Math.min(Math.max(o.periodEnd.getTime() - o.now.getTime(), 0), total);
  const fraction = total > 0 ? left / total : 0;
  const credit = o.fromPaid ? Math.round(o.fromPricePaise * fraction) : 0;
  if (o.restart) return Math.max(0, o.toPricePaise - credit);
  return Math.max(0, Math.round(o.toPricePaise * fraction) - credit);
}

/** Usage period key YYYY-MM in India time (same as UsageCounter.period). */
export function usagePeriodOf(at: Date = new Date()): string {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Whole days left until `end` (0 on the last day, negative once past), counted from `now`. */
export const daysLeft = (end: Date, now: Date = new Date()): number => Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
