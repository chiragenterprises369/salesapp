'use client';

import { formatPaise, type BillingOverview } from '@vistar/shared';
import { CalendarClock, CreditCard, Hourglass, Send } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { RequirePermission } from '@/components/auth/require-permission';
import { PageHeader } from '@/components/common/page-header';
import { InlineAlert, LoadError } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { downloadBillingInvoicePdf, useBillingInvoices, useBillingMutations, useBillingOverview, useBillingPayments, useBillingPlans } from '@/lib/billing/hooks';
import { CYCLE_LABEL, formatMeterValue, isPayable, meterUiState, planName, sortMeters, SUBSCRIPTION_STATUS, trialText, upgradeParam } from '@/lib/billing/logic';
import { formatDay } from '@/lib/crm/format';
import { useCan, useMe } from '@/lib/session/session';
import { BillingContactCard } from './billing-contact-card';
import { useCheckoutFlow } from './checkout-flow';
import { LoadMore, PlatformInvoicesTable, PlatformPaymentsTable } from './invoice-tables';
import { PlanPicker } from './plan-picker';
import { UsageMeter } from './usage-meter';

/** Company Billing and usage (SPEC 15.7): plan, trial, usage against limits, plans, invoices, payments, billing details. */
export function BillingPage() {
  return (
    <RequirePermission anyOf={['billing.read', 'billing.manage']}>
      <Billing />
    </RequirePermission>
  );
}

function Billing() {
  const overview = useBillingOverview();
  const plans = useBillingPlans();
  const canManage = useCan('billing.manage');
  const me = useMe();
  const params = useSearchParams();
  const highlight = upgradeParam(params);
  const invoiceParam = params.get('invoice');

  // ?upgrade=<plan> (402 toast, upgradeUrl) or #plans: bring the plan cards into view once they render.
  const ready = !!overview.data && !!plans.data;
  useEffect(() => {
    if (!ready) return;
    const target = invoiceParam ? 'invoices' : highlight || window.location.hash === '#plans' ? 'plans' : null;
    if (!target) return;
    const id = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(id);
  }, [ready, highlight, invoiceParam]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 pb-6">
      <PageHeader
        title="Billing and usage"
        description="Your Vistar plan, usage against its limits, invoices and payments."
        meta={overview.data && <Chip tone={SUBSCRIPTION_STATUS[overview.data.subscription.status].tone}>{SUBSCRIPTION_STATUS[overview.data.subscription.status].label}</Chip>}
        className="mb-0"
      />
      {overview.isPending ? (
        <BillingSkeleton />
      ) : overview.isError || !overview.data ? (
        <LoadError title="Billing did not load" onRetry={() => void overview.refetch()} />
      ) : (
        <>
          <Alerts overview={overview.data} canManage={canManage} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <CurrentPlan overview={overview.data} />
            <Usage overview={overview.data} />
          </div>
          {plans.isError ? (
            <LoadError title="Plans did not load" onRetry={() => void plans.refetch()} />
          ) : plans.data ? (
            <PlanPicker overview={overview.data} plans={plans.data.items} canManage={canManage} highlight={highlight} />
          ) : (
            <Skeleton className="h-72 w-full" />
          )}
          <div className="grid gap-6 2xl:grid-cols-2">
            <Invoices canManage={canManage} highlightId={invoiceParam} />
            <Payments />
          </div>
          <BillingContactCard contact={overview.data.subscription.billingContact} companyName={me?.workspace.name ?? ''} canManage={canManage} />
        </>
      )}
    </div>
  );
}

function Alerts({ overview, canManage }: { overview: BillingOverview; canManage: boolean }) {
  const { subscription: sub, pendingRequest, openInvoices } = overview;
  const m = useBillingMutations();
  const cancel = async () => {
    try {
      await m.cancelChange.mutateAsync();
      toast.success(pendingRequest ? 'Request withdrawn' : 'Plan change cancelled');
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : 'Nothing changed. Try again.');
    }
  };
  const trial = trialText(sub.trialDaysLeft);
  return (
    <div className="flex flex-col gap-2 empty:hidden">
      {sub.status === 'past_due' && (
        <InlineAlert title="Payment overdue">
          {openInvoices.overdue > 0 ? `${openInvoices.overdue} invoice${openInvoices.overdue === 1 ? ' is' : 's are'} overdue (${formatPaise(openInvoices.balancePaise)} due). ` : ''}
          Pay from Invoices below to keep your plan; after the grace period the workspace moves to the Free plan.
        </InlineAlert>
      )}
      {sub.status === 'trialing' && trial && (
        <InlineAlert tone={sub.trialDaysLeft !== null && sub.trialDaysLeft <= 3 ? 'warning' : 'info'} title={trial}>
          {sub.trialEndsAt ? `Your ${sub.planName} trial runs until ${formatDay(sub.trialEndsAt.slice(0, 10))}. ` : ''}
          {overview.plan.priceInrMonthly > 0 ? 'The first invoice is issued when the trial ends.' : 'Choose a plan below to keep the paid features.'}
        </InlineAlert>
      )}
      {sub.scheduledChange && (
        <InlineAlert tone="info" title={`Moving to ${planName(sub.scheduledChange.plan)} on ${formatDay(sub.scheduledChange.effectiveAt.slice(0, 10))}`}>
          <span className="flex flex-wrap items-center gap-2">
            Your current plan stays until then.
            {canManage && (
              <Button size="sm" variant="link" className="h-auto p-0" loading={m.cancelChange.isPending} onClick={() => void cancel()}>
                Keep my current plan
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
      {pendingRequest && (
        <InlineAlert tone="info" title={`Request for the ${planName(pendingRequest.toPlan)} plan sent`}>
          <span className="flex flex-wrap items-center gap-2">
            Sent {formatDay(pendingRequest.createdAt.slice(0, 10))}. Vistar reviews it and you get a notification.
            {canManage && (
              <Button size="sm" variant="link" className="h-auto p-0" loading={m.cancelChange.isPending} onClick={() => void cancel()}>
                Withdraw request
              </Button>
            )}
          </span>
        </InlineAlert>
      )}
    </div>
  );
}

function CurrentPlan({ overview }: { overview: BillingOverview }) {
  const { subscription: sub, plan, nextInvoiceAt, checkout } = overview;
  const facts: Array<{ icon: typeof CreditCard; label: string; value: string }> = [
    { icon: CreditCard, label: 'Price', value: sub.pricePaise === 0 ? 'Free' : `${formatPaise(sub.pricePaise)} ${sub.cycle === 'yearly' ? 'a year' : 'a month'} + GST` },
    { icon: CalendarClock, label: 'Current period', value: `${formatDay(sub.currentPeriodStart.slice(0, 10))} – ${formatDay(sub.currentPeriodEnd.slice(0, 10))}` },
    ...(nextInvoiceAt ? [{ icon: Send, label: 'Next invoice', value: formatDay(nextInvoiceAt.slice(0, 10)) }] : []),
    ...(sub.status === 'trialing' && sub.trialEndsAt ? [{ icon: Hourglass, label: 'Trial ends', value: formatDay(sub.trialEndsAt.slice(0, 10)) }] : []),
  ];
  return (
    <Card className="flex flex-col gap-4 p-4" aria-labelledby="current-plan-title">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted uppercase">Current plan</p>
          <h2 id="current-plan-title" className="text-xl font-semibold text-fg">
            {sub.planName}
          </h2>
          <p className="text-sm text-muted-strong">
            {CYCLE_LABEL[sub.cycle]} billing
            {sub.seats !== null ? ` · ${sub.seats} user${sub.seats === 1 ? '' : 's'}${sub.extraSeats ? ` (${sub.extraSeats} extra)` : ''}` : ' · unlimited users'}
          </p>
        </div>
        <Button asChild size="sm">
          <a href="#plans">Change plan</a>
        </Button>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 3xl:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="flex items-start gap-2.5">
            <f.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
            <div className="min-w-0">
              <dt className="text-xs text-muted-strong">{f.label}</dt>
              <dd className="text-sm text-fg tabular-nums">{f.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-strong">
        {checkout.available ? (checkout.provider === 'mock' ? 'Payments use the test provider in this build.' : `Pay online by card, UPI or net banking (Razorpay${checkout.mode === 'test' ? ', test mode' : ''}).`) : 'Online payment is not set up yet: plan changes go to Vistar as a request.'}
        {plan.trialDays > 0 && sub.status === 'trialing' ? ` ${plan.trialDays}-day trial.` : ''}
      </p>
    </Card>
  );
}

function Usage({ overview }: { overview: BillingOverview }) {
  const meters = useMemo(() => sortMeters(overview.usage.meters), [overview.usage.meters]);
  return (
    <section aria-labelledby="usage-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-title" className="text-base font-semibold text-fg">
          Usage
        </h2>
        <p className="text-xs text-muted-strong">Monthly meters reset on the 1st (India time). Amber from 80%, red at the limit.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {meters.map((m) => (
          <li key={m.metric} className="min-w-0" data-metric={m.metric}>
            <UsageMeter
              label={m.label}
              used={m.used}
              limit={m.limit}
              state={meterUiState(m.state)}
              format={(n) => formatMeterValue(n, m.unit)}
              hint={m.state === 'reached' ? 'New records of this kind are blocked until you upgrade or free up usage.' : m.window === 'month' ? 'This month' : undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Invoices({ canManage, highlightId }: { canManage: boolean; highlightId: string | null }) {
  const q = useBillingInvoices();
  const m = useBillingMutations();
  const flow = useCheckoutFlow();
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  const pay = async (id: string) => {
    try {
      await flow.start(await m.payInvoice.mutateAsync(id));
    } catch (e) {
      toast.error(isApiRequestError(e) ? e.message : 'The payment could not start. Try again.');
    }
  };
  return (
    <section id="invoices" aria-labelledby="invoices-title" className="flex min-w-0 scroll-mt-20 flex-col gap-3">
      <h2 id="invoices-title" className="text-base font-semibold text-fg">
        Invoices
      </h2>
      <PlatformInvoicesTable
        rows={rows}
        status={status}
        onRetry={() => void q.refetch()}
        pdf={downloadBillingInvoicePdf}
        highlightId={highlightId}
        actions={(i) =>
          canManage && isPayable(i) ? (
            <Button size="sm" variant="primary" loading={(m.payInvoice.isPending && m.payInvoice.variables === i.id) || flow.busy} onClick={() => void pay(i.id)}>
              Pay {formatPaise(i.balancePaise)}
            </Button>
          ) : null
        }
        footer={<LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} />}
      />
      {flow.dialog}
    </section>
  );
}

function Payments() {
  const q = useBillingPayments();
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const status = q.isPending ? 'loading' : q.isError ? 'error' : rows.length === 0 ? 'empty' : 'ready';
  return (
    <section aria-labelledby="payments-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="payments-title" className="text-base font-semibold text-fg">
        Payment history
      </h2>
      <PlatformPaymentsTable rows={rows} status={status} onRetry={() => void q.refetch()} footer={<LoadMore hasMore={q.hasNextPage} loading={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} />} />
    </section>
  );
}

function BillingSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading billing" className="flex flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Skeleton className="h-56 w-full" />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-72 w-full" />
    </div>
  );
}
