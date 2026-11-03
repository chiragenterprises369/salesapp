'use client';

import { formatPaise, PLANS, SUBSCRIPTION_STATUSES, type BillingCycle, type Plan, type PlanChangeRequest, type SubscriptionStatus } from '@vistar/shared';
import { ReceiptIndianRupee } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { columnClass, DataTable, type DataColumn } from '@/components/common/data-table';
import { NativeSelect } from '@/components/common/native-select';
import { PageHeader } from '@/components/common/page-header';
import { Switch } from '@/components/common/switch';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import { usePlanRequests, useSubscriptions, type SubscriptionQuery } from '@/lib/billing/hooks';
import { CYCLE_LABEL, planName, SUBSCRIPTION_STATUS, trialText } from '@/lib/billing/logic';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/crm/format';
import { CrmSearch } from '@/lib/crm/ui/list-toolbar';
import { LoadMore } from '../invoice-tables';
import { DecideRequestDialog } from './billing-dialogs';

const COLUMNS: DataColumn[] = [
  { key: 'company', label: 'Company' },
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'seats', label: 'Seats', align: 'right', hideBelow: 'md' },
  { key: 'mrr', label: 'MRR', align: 'right', hideBelow: 'sm' },
  { key: 'outstanding', label: 'Outstanding', align: 'right', hideBelow: 'md' },
  { key: 'paid', label: 'Last payment', hideBelow: 'lg' },
  { key: 'renews', label: 'Period end', hideBelow: 'lg' },
];

/** Super Admin > Billing: subscriptions across companies with filters and totals, and plan requests. */
export function SubscriptionsPage() {
  return (
    <RequirePermission anyOf={['platform.billing.manage']}>
      <Subscriptions />
    </RequirePermission>
  );
}

function Subscriptions() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const [plan, setPlan] = useState<Plan | ''>('');
  const [cycle, setCycle] = useState<BillingCycle | ''>('');
  const [overdue, setOverdue] = useState(false);
  const query: SubscriptionQuery = { q: useDeferredValue(q).trim() || undefined, status: status || undefined, plan: plan || undefined, cycle: cycle || undefined, overdue: overdue ? 'true' : undefined } as SubscriptionQuery;
  const list = useSubscriptions(query);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const totals = list.data?.pages[0]?.totals;
  const filtered = !!(query.q || status || plan || cycle || overdue);
  const tableStatus = list.isPending ? 'loading' : list.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <PageHeader title="Billing" description="Subscriptions of every company, money owed and plan requests. Open a company to invoice, record payments or change its plan." className="mb-1" />
      <Totals totals={totals} loading={list.isPending} onStatus={(s) => setStatus((cur) => (cur === s ? '' : s))} active={status} />
      <PlanRequests />
      <DataTable
        label="Subscriptions"
        columns={COLUMNS}
        status={tableStatus}
        onRetry={() => void list.refetch()}
        toolbar={
          <>
            <CrmSearch className="w-full sm:w-64" value={q} onChange={setQ} placeholder="Search company" label="Search companies" />
            <NativeSelect aria-label="Status" wrapperClassName="w-40" size="sm" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus | '')}>
              <option value="">Any status</option>
              {SUBSCRIPTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBSCRIPTION_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Plan" wrapperClassName="w-36" size="sm" value={plan} onChange={(e) => setPlan(e.target.value as Plan | '')}>
              <option value="">Any plan</option>
              {PLANS.map((p) => (
                <option key={p} value={p}>
                  {planName(p)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect aria-label="Billing cycle" wrapperClassName="w-36" size="sm" value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle | '')}>
              <option value="">Any cycle</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm text-fg-secondary">
              <Switch checked={overdue} onCheckedChange={setOverdue} />
              Overdue only
            </label>
            {totals && (
              <span className="ml-auto text-xs text-muted tabular-nums" aria-live="polite">
                {rows.length} of {totals.companies}
              </span>
            )}
          </>
        }
        empty={
          filtered
            ? { icon: <ReceiptIndianRupee />, title: 'No company matches these filters', description: 'Clear a filter or search for another name.' }
            : { icon: <ReceiptIndianRupee />, title: 'No subscriptions yet', description: 'Every company gets one when it is created.' }
        }
      >
        {rows.map((r) => {
          const st = SUBSCRIPTION_STATUS[r.subscription.status];
          const trial = r.subscription.status === 'trialing' ? trialText(r.subscription.trialDaysLeft) : null;
          return (
            <TableRow key={r.company.id}>
              <TableCell className="max-w-xs py-2">
                <Link href={`/super-admin/billing/companies/${r.company.id}`} className="focus-ring rounded-xs font-medium text-fg hover:underline">
                  {r.company.name}
                </Link>
                <span className="block truncate text-xs text-muted-strong">{r.company.slug}</span>
              </TableCell>
              <TableCell className="py-2">
                {r.subscription.planName}
                <span className="block text-xs text-muted-strong">{CYCLE_LABEL[r.subscription.cycle]}</span>
              </TableCell>
              <TableCell className="py-2">
                <span className="flex flex-wrap items-center gap-1">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {r.pendingRequest && <Chip tone="amber">Request</Chip>}
                </span>
                {trial && <span className="block text-xs text-muted-strong">{trial}</span>}
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[3]!), 'py-2 tabular-nums')}>
                {r.seatsUsed}
                {r.subscription.seats !== null ? ` / ${r.subscription.seats}` : ''}
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[4]!), 'py-2 tabular-nums')}>{r.mrrPaise ? formatPaise(r.mrrPaise) : ''}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[5]!), 'py-2 tabular-nums')}>
                {r.outstandingPaise ? formatPaise(r.outstandingPaise) : ''}
                {r.overdueInvoices > 0 && <span className="block text-xs text-danger-text">{r.overdueInvoices} overdue</span>}
              </TableCell>
              <TableCell className={cn(columnClass(COLUMNS[6]!), 'py-2')}>{r.lastPaymentAt ? formatDay(r.lastPaymentAt.slice(0, 10)) : ''}</TableCell>
              <TableCell className={cn(columnClass(COLUMNS[7]!), 'py-2')}>{formatDay(r.subscription.currentPeriodEnd.slice(0, 10))}</TableCell>
            </TableRow>
          );
        })}
      </DataTable>
      <LoadMore hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => void list.fetchNextPage()} />
    </div>
  );
}

type Totals = NonNullable<ReturnType<typeof useSubscriptions>['data']>['pages'][number]['totals'];

function Totals({ totals, loading, onStatus, active }: { totals: Totals | undefined; loading: boolean; onStatus: (s: SubscriptionStatus) => void; active: SubscriptionStatus | '' }) {
  if (loading || !totals)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  const kpis = [
    { label: 'Companies', value: new Intl.NumberFormat('en-IN').format(totals.companies) },
    { label: 'Monthly recurring revenue', value: formatPaise(totals.mrrPaise) },
    { label: 'Outstanding', value: formatPaise(totals.outstandingPaise) },
    { label: 'Companies with overdue invoices', value: String(totals.overdueCompanies) },
  ];
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <dt className="text-xs text-muted-strong">{k.label}</dt>
            <dd className="text-2xl font-semibold text-fg tabular-nums">{k.value}</dd>
          </Card>
        ))}
      </dl>
      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
        {SUBSCRIPTION_STATUSES.map((s) => (
          <Button key={s} size="sm" variant={active === s ? 'primary' : 'secondary'} aria-pressed={active === s} onClick={() => onStatus(s)}>
            {SUBSCRIPTION_STATUS[s].label}
            <span className="tabular-nums">{totals.byStatus[s] ?? 0}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function PlanRequests() {
  const q = usePlanRequests('pending');
  const [open, setOpen] = useState<{ request: PlanChangeRequest; decision: 'approve' | 'reject' } | null>(null);
  const items = q.data?.items ?? [];
  if (q.isPending || q.isError || items.length === 0) return null;
  return (
    <section aria-labelledby="plan-requests-title" className="flex flex-col gap-2">
      <h2 id="plan-requests-title" className="text-base font-semibold text-fg">
        Plan requests waiting ({items.length})
      </h2>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
        {items.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="min-w-0 flex-1 text-sm">
              <Link href={`/super-admin/billing/companies/${r.workspaceId}`} className="focus-ring rounded-xs font-medium text-fg hover:underline">
                {r.companyName}
              </Link>{' '}
              <span className="text-muted-strong">
                {planName(r.fromPlan)} → {planName(r.toPlan)}, {CYCLE_LABEL[r.cycle].toLowerCase()} · {formatDay(r.createdAt.slice(0, 10))}
                {r.note ? ` · “${r.note}”` : ''}
              </span>
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" onClick={() => setOpen({ request: r, decision: 'reject' })}>
                Reject
              </Button>
              <Button size="sm" variant="primary" onClick={() => setOpen({ request: r, decision: 'approve' })}>
                Approve
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {open && <DecideRequestDialog request={open.request} decision={open.decision} onClose={() => setOpen(null)} />}
    </section>
  );
}
