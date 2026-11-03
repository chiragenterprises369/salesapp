'use client';

import { USAGE_METRIC_LABELS, type PlanLimitError } from '@vistar/shared';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { planLimitOf } from '@/lib/api/client';
import { isApiRequestError, type ApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/lib/session/session';
import { planName } from './logic';

/**
 * Plan limits (402 PLAN_LIMIT_REACHED, SPEC 15.7): every workspace request that hits a limit (inviting
 * a user, creating a lead or an API key...) shows ONE toast with the upgrade link. lib/api/client calls
 * `showPlanLimitToast` for every such response, so pages do not need their own handling; their own error
 * message (form banner) stays as it is. `error.planLimit` (metric, limit, used, upgrade plan and URL)
 * comes through `planLimitOf`.
 */
export const PLAN_LIMIT_TOAST_ID = 'plan-limit';
export const UPGRADE_HREF = '/app/billing#plans';

export function isPlanLimitError(e: unknown): e is ApiRequestError {
  return isApiRequestError(e) && e.code === 'PLAN_LIMIT_REACHED';
}

function canSeeBilling(): boolean {
  const s = useSessionStore.getState().session;
  const perms: readonly string[] = s?.audience === 'workspace' ? s.me.permissions : [];
  return perms.includes('billing.read') || perms.includes('billing.manage');
}

/** Upgrade link from the API (`/app/billing?upgrade=growth`), only when it stays on the billing page. */
export function upgradeHref(limit: PlanLimitError | null): string {
  const url = limit?.upgradeUrl;
  if (url && /^\/app\/billing(?:[?#][\w=&#%-]*)?$/.test(url)) return url.includes('#') ? url : `${url}#plans`;
  return UPGRADE_HREF;
}

/** One-line description: "Leads: 500 of 500 on the Free plan. Growth allows more." */
export function planLimitDescription(limit: PlanLimitError | null, admin: boolean): string {
  const ask = admin ? 'Upgrade the plan, or free up usage, to continue.' : 'Ask your company admin to upgrade the plan.';
  if (!limit) return ask;
  const what = `${USAGE_METRIC_LABELS[limit.metric]}: ${limit.used.toLocaleString('en-IN')} of ${limit.limit.toLocaleString('en-IN')} on the ${planName(limit.plan)} plan.`;
  const next = limit.upgradePlan ? ` ${planName(limit.upgradePlan)} allows more.` : ' Contact Vistar for a higher limit.';
  return `${what}${next} ${admin ? '' : ask}`.trim();
}

/** The upgrade toast (same id, so a burst of failing requests shows it once). */
export function showPlanLimitToast(err: ApiRequestError): void {
  const admin = canSeeBilling();
  const limit = planLimitOf(err);
  toast.error(err.message || 'Your plan limit is reached.', {
    id: PLAN_LIMIT_TOAST_ID,
    duration: 12_000,
    description: planLimitDescription(limit, admin),
    action: admin ? (
      <Link href={upgradeHref(limit)} onClick={() => toast.dismiss(PLAN_LIMIT_TOAST_ID)} className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ml-auto shrink-0')}>
        {limit?.upgradePlan ? `See ${planName(limit.upgradePlan)}` : 'See plans'}
      </Link>
    ) : undefined,
  });
}
