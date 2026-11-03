'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { isApiRequestError, type ApiRequestError } from '@/lib/api-error';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/lib/session/session';

/**
 * Plan limits (402 PLAN_LIMIT_REACHED, SPEC 15.7): every workspace request that hits a limit (inviting
 * a user, creating a lead or an API key...) shows ONE toast with the upgrade link. lib/api/client calls
 * `showPlanLimitToast` for every such response, so pages do not need their own handling; their own error
 * message (form banner) stays as it is.
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

/** The upgrade toast (same id, so a burst of failing requests shows it once). */
export function showPlanLimitToast(err: ApiRequestError): void {
  const admin = canSeeBilling();
  toast.error(err.message || 'Your plan limit is reached.', {
    id: PLAN_LIMIT_TOAST_ID,
    duration: 12_000,
    description: admin ? 'Upgrade the plan, or free up usage, to continue.' : 'Ask your company admin to upgrade the plan.',
    action: admin ? (
      <Link href={UPGRADE_HREF} onClick={() => toast.dismiss(PLAN_LIMIT_TOAST_ID)} className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'ml-auto shrink-0')}>
        See plans
      </Link>
    ) : undefined,
  });
}
