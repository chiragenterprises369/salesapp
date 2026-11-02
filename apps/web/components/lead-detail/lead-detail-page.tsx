'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe, useSessionStatus } from '@/lib/session/session';
import { LeadsActions } from '@/components/leads/leads-actions';
import { EmptyState } from '@/components/leads/states';
import { useLeadWords } from '@/components/leads/use-lead-words';
import { LeadDetail, leadsBasePath, type LeadPanel } from './lead-detail';
import { useDrawerIntent } from './use-lead-drawer';

/** Full-page lead detail: /app/leads/[id] and /me/leads/[id]. */
export function LeadDetailPage({ leadId, panel }: { leadId: string; panel: LeadPanel }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadDetailPageInner leadId={leadId} panel={panel} />
    </Suspense>
  );
}

function LeadDetailPageInner({ leadId, panel }: { leadId: string; panel: LeadPanel }) {
  const status = useSessionStatus();
  const me = useMe();
  const router = useRouter();
  const w = useLeadWords();
  const base = leadsBasePath(panel);
  const open = useCallback(
    (id: string, opts: { focusNote?: boolean } = {}) => {
      if (id === leadId) {
        if (opts.focusNote) useDrawerIntent.getState().setFocusNote(id);
        return;
      }
      router.push(`${base}/${id}`);
    },
    [base, leadId, router],
  );

  if (status === 'loading' || (status === 'authenticated' && !me)) return <PageSkeleton />;
  if (!me)
    return (
      <EmptyState
        title={`Sign in to see this ${w.lead}`}
        description="Your session ended. Sign in again to continue."
      />
    );

  return (
    <LeadsActions open={open}>
      <div className="flex w-full min-w-0 flex-col gap-4">
        <nav aria-label="Breadcrumb">
          <Link
            href={base}
            className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-strong hover:text-fg"
          >
            <ArrowLeft aria-hidden className="size-4" />
            All {w.leads}
          </Link>
        </nav>
        <LeadDetail leadId={leadId} panel={panel} variant="page" />
      </div>
    </LeadsActions>
  );
}

function PageSkeleton() {
  return (
    <div
      className="flex w-full min-w-0 flex-col gap-4"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="h-4 w-20" />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr] 3xl:grid-cols-[460px_1fr]">
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
