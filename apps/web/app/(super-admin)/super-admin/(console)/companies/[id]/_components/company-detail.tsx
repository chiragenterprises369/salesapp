'use client';

import type { Company } from '@vistar/shared';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { CompanyBillingTab } from '@/components/billing/super/company-billing';
import { Tabs } from '@/components/reports/page-kit';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiRequestError } from '@/lib/api-error';
import { useSuperCompany } from '@/lib/config/company-detail';
import { usePermissions } from '@/lib/session/session';
import { CompanyAuditTab } from './audit-tab';
import { CompanyFloorTab } from './floor-tab';
import { CompanyOverviewTab, PLAN_LABEL, STATUS_CHIP } from './overview-tab';
import { CompanySwitchesTab } from './switches-tab';
import { CompanyUsersTab } from './users-tab';
import type { CompanyTab } from './tabs';

const TAB_DEFS: ReadonlyArray<{ value: CompanyTab; label: string; anyOf: readonly string[] }> = [
  { value: 'overview', label: 'Overview', anyOf: ['platform.companies.read'] },
  { value: 'users', label: 'Users', anyOf: ['platform.companies.read'] },
  { value: 'billing', label: 'Plan and billing', anyOf: ['platform.billing.manage'] },
  { value: 'switches', label: 'Switches', anyOf: ['platform.flags.manage'] },
  { value: 'floor', label: 'Floor requests', anyOf: ['platform.companies.read'] },
  { value: 'audit', label: 'Audit', anyOf: ['platform.audit.read'] },
];

const PANEL_ID = 'company-detail-panel';

/**
 * Super Admin > Companies > one company (change #20): overview, users, plan and billing (BILLING-WEB's
 * CompanyBillingTab, embedded), switches (feature flag overrides), floor requests and the company's
 * platform audit trail. The tab is kept in `?tab=` so links and reloads land on the same tab.
 */
export function CompanyDetail({ companyId, initialTab }: { companyId: string; initialTab: CompanyTab }) {
  return (
    <RequirePermission anyOf={['platform.companies.read']}>
      <CompanyDetailBody companyId={companyId} initialTab={initialTab} />
    </RequirePermission>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-max">
      <Link href="/super-admin/companies">
        <ArrowLeft aria-hidden />
        All companies
      </Link>
    </Button>
  );
}

function CompanyDetailBody({ companyId, initialTab }: { companyId: string; initialTab: CompanyTab }) {
  const q = useSuperCompany(companyId);
  const permissions = usePermissions();
  const tabs = useMemo(() => TAB_DEFS.filter((t) => t.anyOf.some((p) => permissions.includes(p))), [permissions]);
  const [tab, setTab] = useState<CompanyTab>(initialTab);
  const active = tabs.some((t) => t.value === tab) ? tab : 'overview';

  // Keep the tab in the URL without a navigation (Next keeps history.replaceState in sync with the router).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (active === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', active);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href);
  }, [active]);

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading the company">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-9 w-full" />
        <div className="grid gap-4 xl:grid-cols-3">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const missing = (isApiRequestError(q.error) && q.error.status === 404) || (q.error as { status?: number } | null)?.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <BackLink />
        <EmptyState
          title={missing ? 'This company does not exist' : 'The company did not load'}
          description={missing ? 'It may have been deleted. Go back to the list and pick another company.' : 'Check your connection, then try again.'}
          action={
            missing ? (
              <Button asChild variant="primary">
                <Link href="/super-admin/companies">All companies</Link>
              </Button>
            ) : (
              <Button onClick={() => void q.refetch()}>
                <RefreshCw aria-hidden />
                Try again
              </Button>
            )
          }
        />
      </div>
    );
  }

  const c: Company = q.data;
  const status = STATUS_CHIP[c.status];
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <BackLink />
        <PageHeader
          title={c.name}
          description={[c.slug, c.ownerEmail].filter(Boolean).join(' · ')}
          meta={
            <>
              <Chip tone={status.tone} dot>
                {status.text}
              </Chip>
              <Chip tone="indigo">{PLAN_LABEL[c.plan]}</Chip>
            </>
          }
          className="mb-0"
        />
      </div>
      <Tabs label={`${c.name} sections`} value={active} tabs={tabs} onChange={setTab} panelId={PANEL_ID} className="overflow-x-auto" />
      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`${PANEL_ID}-tab-${active}`} tabIndex={-1} className="min-w-0 focus:outline-none">
        {active === 'overview' && <CompanyOverviewTab company={c} onOpenTab={setTab} />}
        {active === 'users' && <CompanyUsersTab company={c} />}
        {active === 'billing' && <CompanyBillingTab companyId={c.id} embedded />}
        {active === 'switches' && <CompanySwitchesTab company={c} />}
        {active === 'floor' && <CompanyFloorTab company={c} />}
        {active === 'audit' && <CompanyAuditTab company={c} />}
      </div>
    </div>
  );
}
