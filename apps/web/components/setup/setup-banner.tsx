'use client';

import { ArrowRight, ListChecks, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useReadOnly } from '@/lib/auth/use-auth';
import { useSetupChecklist, useSetupMutations } from '@/lib/config/company';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { useCan } from '@/lib/session/session';
import { SetupProgress } from './setup-checklist';

/**
 * Dashboard banner until the company setup is complete (change #20): progress, the next steps and a link
 * to Settings > Setup. Admins only (settings.manage); dismissing is per user (PUT /setup/banner) and can be
 * undone on the Setup page. Renders nothing while loading, on errors, when complete or dismissed.
 */
export function SetupBanner() {
  const canManage = useCan('settings.manage');
  const q = useSetupChecklist(canManage);
  const m = useSetupMutations();
  const { readOnly } = useReadOnly();
  const c = q.data;
  if (!canManage || !c || c.complete || c.bannerDismissed || c.items.length === 0) return null;
  const next = c.items.filter((i) => !i.optional && (i.status === 'todo' || i.status === 'in_progress')).slice(0, 3);

  return (
    <section aria-labelledby="setup-banner-title" className="card relative flex flex-col gap-4 rounded-[var(--r-card,18px)] border border-hair bg-[linear-gradient(180deg,var(--card-top),var(--card)_40%)] p-4 sm:p-5 shadow-card sm:flex-row sm:items-center">
      <span aria-hidden className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent sm:inline-flex">
        <ListChecks className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="setup-banner-title" className="text-sm font-bold text-ink">
            Finish setting up your workspace
          </h2>
          <span className="text-xs font-semibold text-faint tabular">{`${c.done} of ${c.total} steps done`}</span>
        </div>
        <SetupProgress percent={c.percent} done={c.done} total={c.total} className="max-w-md" />
        {next.length > 0 && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Next steps">
            {next.map((i) => (
              <li key={i.key}>
                <Link href={i.href} className="focus-ring rounded-xs font-medium text-accent hover:underline">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button asChild size="md" variant="primary" className="font-bold">
          <Link href="/app/settings/setup">
            Continue setup
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Hide the setup banner"
          title="Hide the setup banner (Settings, Setup brings it back)"
          disabled={readOnly || m.banner.isPending}
          onClick={() => m.banner.mutate(true, { onError: (e) => toast.error(formErrorMessage(e, 'The banner was not hidden. Try again.')) })}
        >
          <X aria-hidden />
        </Button>
      </div>
    </section>
  );
}
