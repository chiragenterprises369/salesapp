import { Injectable } from '@nestjs/common';
import { planLimitFor, PLAN_ORDER, USAGE_METRIC_LABELS, wouldExceed, type PlanDefinition, type PlanLimitError, type UsageMetric } from '@vistar/shared';
import { AppException } from '../../common/errors/app-exception.js';
import { BillingCoreService } from './billing-core.service.js';
import { UsageService } from './usage.service.js';

const NOUN: Record<UsageMetric, string> = {
  seats: 'users',
  leads: 'leads',
  storage_mb: 'MB of storage',
  whatsapp_messages: 'WhatsApp messages a month',
  api_calls: 'API calls a month',
  workflow_runs: 'workflow runs a month',
  api_keys: 'API keys',
};

/**
 * Plan limits on create paths (D-072): invites and invite accept and user reactivation (seats, counting pending
 * invites), lead create and import (leads), API key create (api_keys; HUB-API calls this). Over the limit ->
 * 402 PLAN_LIMIT_REACHED with `error.planLimit` (limit, used, the cheapest plan with room, upgrade link) and a
 * `billing.usage_alert` event for the billing page. Global provider: inject it anywhere without importing a module.
 */
@Injectable()
export class PlanLimitsService {
  constructor(
    private readonly core: BillingCoreService,
    private readonly usage: UsageService,
  ) {}

  /** Throws PLAN_LIMIT_REACHED when adding `adding` more would go over the plan limit. Seats count pending invites unless `countInvites` is false. */
  async assertCanAdd(workspaceId: string, metric: UsageMetric, adding = 1, opts: { countInvites?: boolean } = {}): Promise<void> {
    if (adding <= 0) return;
    const sub = await this.core.ensure(workspaceId);
    const plan = await this.core.plan(sub.plan);
    const limit = planLimitFor(plan.limits, metric, sub.extraSeats);
    if (limit === null) return;
    const used = metric === 'seats' && opts.countInvites !== false ? await this.usage.seatsReserved(workspaceId) : await this.usage.used(workspaceId, metric);
    if (!wouldExceed(used, limit, adding)) return;
    const upgradePlan = await this.upgradeFor(plan, metric, used + adding);
    const planLimit: PlanLimitError = { metric, limit, used, plan: plan.key, upgradePlan: upgradePlan?.key ?? null, upgradeUrl: upgradePlan ? `/app/billing?upgrade=${upgradePlan.key}` : '/app/billing' };
    await this.core.publish('billing.usage_alert', workspaceId, { meter: this.usage.meter(metric, used, plan, sub.extraSeats), blocked: true });
    const what = metric === 'seats' ? `${limit} users (pending invites count)` : `${limit} ${NOUN[metric]}`;
    const next = upgradePlan ? ` Upgrade to ${upgradePlan.name} to add more.` : ' Contact Vistar to raise the limit.';
    throw new AppException('PLAN_LIMIT_REACHED', `Your ${plan.name} plan allows ${what}.${next}`, { planLimit, details: [{ path: `limit.${metric}`, message: USAGE_METRIC_LABELS[metric] }] });
  }

  /** Cheapest active plan, above the current one, whose limit fits `needed` (null limit = unlimited). */
  private async upgradeFor(current: PlanDefinition, metric: UsageMetric, needed: number): Promise<PlanDefinition | null> {
    const plans = (await this.core.plans())
      .filter((p) => p.isActive && p.key !== current.key && PLAN_ORDER.indexOf(p.key) > PLAN_ORDER.indexOf(current.key))
      .sort((a, b) => a.priceInrMonthly - b.priceInrMonthly);
    return plans.find((p) => {
      const limit = planLimitFor(p.limits, metric);
      return limit === null || limit >= needed;
    }) ?? null;
  }
}
