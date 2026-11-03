'use client';

import { formatPaise, type PlanChangeRequest, type PlatformInvoiceListItem } from '@vistar/shared';
import { ArrowLeft, CalendarPlus, FilePlus2, Repeat, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { downloadSuperInvoicePdf, useCompanyBilling, useSuperBillingMutations } from '@/lib/billing/hooks';
import { CYCLE_LABEL, formatMeterValue, meterUiState, PLAN_REQUEST_STATUS, planName, sortMeters, SUBSCRIPTION_STATUS, trialText } from '@/lib/billing/logic';
import { formatDay } from '@/lib/crm/format';
import { PlatformInvoicesTable, PlatformPaymentsTable } from '../invoice-tables';
import { UsageMeter } from '../usage-meter';
import { CancelInvoiceDialog, DecideRequestDialog, ExtendTrialDialog, ManualInvoiceDialog, MarkPaidDialog, SuperPlanDialog } from './billing-dialogs';

/**
 * A company's billing for the Super Admin (the "Billing" tab of a company): subscription, usage,
 * Vistar invoices with issue, mark paid and cancel, payments and plan requests; actions to change the
 * plan, extend the trial and create a manual invoice. Every action is audited by the API.
 * `embedded` drops the page header (when a company detail page shows it as one of its tabs).
 */
export function CompanyBillingTab({ companyId, embedded = false }: { companyId: string; embedded?: boolean }) {
  return (
    <RequirePermission anyOf={['platform.billing.manage']}>
      <CompanyBillingBody companyId={companyId} embedded={embedded} />
    </RequirePermission>
  );
}

type Open = { kind: 'invoice' | 'trial' | 'plan' } | { kind: 'paid' | 'cancel'; invoice: PlatformInvoiceListItem } | { kind: 'decide'; request: PlanChangeRequest; decision: 'approve' | 'reject' } | null;

function CompanyBillingBody({ companyId, embedded }: { companyId: string; embedded: boolean }) {
  const q = useCompanyBilling(companyId);
  const m = useSuperBillingMutations(companyId);
  const [open, setOpen] = useState<Open>(null);
  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 w-max">
      <Link href="/super-admin/billing">
        <ArrowLeft aria-hidden />
        All subscriptions
      </Link>
    </Button>
  );

  if (q.isPending)
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label="Loading the company billing">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (q.isError || !q.data) {
    const missing = isApiRequestError(q.error) && q.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        {!embedded && back}
        <EmptyState
          title={missing ? 'This company has no billing record' : 'The company billing did not load'}
          description={missing ? 'It may have been deleted. Go back to the list.' : 'Check your connection, then try again.'}
          action={
            missing ? undefined : (
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

  const b = q.data;
  const sub = b.subscription;
  const st = SUBSCRIPTION_STATUS[sub.status];
  const trial = trialText(sub.trialDaysLeft);
  const meters = sortMeters(b.usage.meters);
  const issue = async (inv: PlatformInvoiceListItem) => {
    try {
      const r = await m.issueInvoice.mutateAsync({ id: inv.id, body: {} });
      toast.success(`Invoice ${r.number ?? ''} issued to ${b.company.name}`);
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : 'The invoice was not issued. Try again.');
    }
  };
  const actions = (
    <>
      <Button onClick={() => setOpen({ kind: 'plan' })}>
        <Repeat aria-hidden />
        Change plan
      </Button>
      <Button onClick={() => setOpen({ kind: 'trial' })}>
        <CalendarPlus aria-hidden />
        Extend trial
      </Button>
      <Button variant="primary" onClick={() => setOpen({ kind: 'invoice' })}>
        <FilePlus2 aria-hidden />
        New invoice
      </Button>
    </>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      {!embedded && (
        <div className="flex flex-col gap-1">
          {back}
          <PageHeader title={`${b.company.name}: billing`} description={`${b.company.slug} · ${b.company.status}`} meta={<Chip tone={st.tone}>{st.label}</Chip>} actions={actions} className="mb-0" />
        </div>
      )}
      {embedded && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="flex flex-col gap-3 p-4" aria-label="Subscription">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Subscription</p>
            <p className="text-xl font-semibold text-fg">{sub.planName}</p>
            <p className="text-sm text-muted-strong">
              {CYCLE_LABEL[sub.cycle]} · {sub.pricePaise ? `${formatPaise(sub.pricePaise)} + GST` : 'Free'}
            </p>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-1 3xl:grid-cols-2">
            <Fact label="Period" value={`${formatDay(sub.currentPeriodStart.slice(0, 10))} – ${formatDay(sub.currentPeriodEnd.slice(0, 10))}`} />
            <Fact label="Seats" value={sub.seats === null ? 'Unlimited' : `${sub.seats}${sub.extraSeats ? ` (${sub.extraSeats} extra)` : ''}`} />
            {trial && <Fact label="Trial" value={`${trial}${sub.trialEndsAt ? ` (${formatDay(sub.trialEndsAt.slice(0, 10))})` : ''}`} />}
            {sub.pastDueSince && <Fact label="Overdue since" value={formatDay(sub.pastDueSince.slice(0, 10))} />}
            {sub.scheduledChange && <Fact label="Scheduled" value={`${planName(sub.scheduledChange.plan)}, ${CYCLE_LABEL[sub.scheduledChange.cycle].toLowerCase()} on ${formatDay(sub.scheduledChange.effectiveAt.slice(0, 10))}`} />}
            <Fact label="Billing contact" value={sub.billingContact ? [sub.billingContact.name, sub.billingContact.gstin].filter(Boolean).join(' · ') : 'Not set'} />
          </dl>
        </Card>
        <section aria-label="Usage" className="min-w-0">
          <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {meters.map((mt) => (
              <li key={mt.metric} className="min-w-0">
                <UsageMeter label={mt.label} used={mt.used} limit={mt.limit} state={meterUiState(mt.state)} format={(n) => formatMeterValue(n, mt.unit)} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      {b.requests.length > 0 && (
        <section aria-labelledby="sb-requests" className="flex flex-col gap-2">
          <h2 id="sb-requests" className="text-base font-semibold text-fg">
            Plan requests
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {b.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-fg">
                    {planName(r.fromPlan)} → {planName(r.toPlan)}
                  </span>{' '}
                  <span className="text-muted-strong">
                    {CYCLE_LABEL[r.cycle].toLowerCase()} · {formatDay(r.createdAt.slice(0, 10))}
                    {r.requestedBy ? ` · ${r.requestedBy.name}` : ''}
                    {r.note ? ` · “${r.note}”` : ''}
                  </span>
                </span>
                <Chip tone={PLAN_REQUEST_STATUS[r.status].tone}>{PLAN_REQUEST_STATUS[r.status].label}</Chip>
                {r.status === 'pending' && (
                  <span className="flex gap-1.5">
                    <Button size="sm" onClick={() => setOpen({ kind: 'decide', request: r, decision: 'reject' })}>
                      Reject
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => setOpen({ kind: 'decide', request: r, decision: 'approve' })}>
                      Approve
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="sb-invoices" className="flex flex-col gap-2">
        <h2 id="sb-invoices" className="text-base font-semibold text-fg">
          Invoices
        </h2>
        <PlatformInvoicesTable
          rows={b.invoices}
          status={b.invoices.length ? 'ready' : 'empty'}
          pdf={downloadSuperInvoicePdf}
          emptyDescription="No invoices yet. Create a manual invoice, or wait for the first paid period."
          actions={(i) => (
            <>
              {i.status === 'draft' && (
                <Button size="sm" loading={m.issueInvoice.isPending && m.issueInvoice.variables?.id === i.id} onClick={() => void issue(i)}>
                  Issue
                </Button>
              )}
              {i.status === 'issued' && i.balancePaise > 0 && (
                <Button size="sm" variant="primary" onClick={() => setOpen({ kind: 'paid', invoice: i })}>
                  Mark paid
                </Button>
              )}
              {(i.status === 'issued' || i.status === 'draft') && i.paidPaise === 0 && (
                <Button size="sm" variant="ghost" onClick={() => setOpen({ kind: 'cancel', invoice: i })}>
                  Cancel
                </Button>
              )}
            </>
          )}
        />
      </section>

      <section aria-labelledby="sb-payments" className="flex flex-col gap-2">
        <h2 id="sb-payments" className="text-base font-semibold text-fg">
          Payments
        </h2>
        <PlatformPaymentsTable rows={b.payments} status={b.payments.length ? 'ready' : 'empty'} />
      </section>

      {open?.kind === 'invoice' && <ManualInvoiceDialog billing={b} open onOpenChange={(o) => !o && setOpen(null)} />}
      {open?.kind === 'trial' && <ExtendTrialDialog billing={b} open onOpenChange={(o) => !o && setOpen(null)} />}
      {open?.kind === 'plan' && <SuperPlanDialog billing={b} open onOpenChange={(o) => !o && setOpen(null)} />}
      {open?.kind === 'paid' && <MarkPaidDialog invoice={open.invoice} onClose={() => setOpen(null)} />}
      {open?.kind === 'cancel' && <CancelInvoiceDialog invoice={open.invoice} onClose={() => setOpen(null)} />}
      {open?.kind === 'decide' && <DecideRequestDialog request={open.request} decision={open.decision} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-strong">{label}</dt>
      <dd className="truncate text-fg tabular-nums">{value}</dd>
    </div>
  );
}
