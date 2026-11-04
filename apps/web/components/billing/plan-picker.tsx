'use client';

import { formatInr, formatPaise, planPricePaise, type BillingCycle, type BillingOverview, type Plan, type PlanDefinition } from '@vistar/shared';
import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { Segmented } from '@/components/dashboard/segmented';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { useBillingMutations } from '@/lib/billing/hooks';
import { CYCLE_LABEL, cyclePriceInr, planAction, yearlySavingPct, type PlanAction } from '@/lib/billing/logic';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/crm/format';
import { useCheckoutFlow } from './checkout-flow';

const nf = new Intl.NumberFormat('en-IN');
const limitText = (n: number | null | undefined, unit: string) => (n === null || n === undefined ? `Unlimited ${unit}` : `${nf.format(n)} ${unit}`);
const storageText = (mb: number | null) => (mb === null ? 'Unlimited storage' : mb >= 1024 ? `${nf.format(Math.round(mb / 1024))} GB storage` : `${nf.format(mb)} MB storage`);

const FEATURE_LABEL: Partial<Record<keyof PlanDefinition['features'], string>> = {
  whatsapp: 'WhatsApp inbox',
  telephony: 'Calling and recordings',
  team_floor_3d: '3D Team Floor',
  api_access: 'API and webhooks',
  employee_rank: 'Leaderboards',
  custom_domain: 'Your own domain',
  ai_node: 'AI workflow steps',
};

/**
 * Plan comparison with the monthly / yearly switch. A card's button upgrades (checkout when it is
 * available, otherwise a request to Tootodo), schedules a downgrade for the renewal date, or switches
 * the cycle. `highlight` comes from ?upgrade=<plan> (the 402 toast and upgradeUrl).
 */
export function PlanPicker({ overview, plans, canManage, highlight }: { overview: BillingOverview; plans: readonly PlanDefinition[]; canManage: boolean; highlight: Plan | null }) {
  const sub = overview.subscription;
  const [cycle, setCycle] = useState<BillingCycle>(sub.cycle);
  const [target, setTarget] = useState<{ plan: PlanDefinition; action: Extract<PlanAction, { via: string }> } | null>(null);
  const flow = useCheckoutFlow();
  const current = plans.find((p) => p.key === sub.plan) ?? overview.plan;
  const anyYearlySaving = Math.max(0, ...plans.map(yearlySavingPct));

  return (
    <section id="plans" aria-labelledby="plans-title" className="flex scroll-mt-20 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="plans-title" className="text-base font-semibold text-fg">
            Plans
          </h2>
          <p className="text-sm text-muted-strong">Prices before 18% GST. Upgrades start now; moving to a smaller plan happens at renewal.</p>
        </div>
        <div className="flex items-center gap-2">
          {anyYearlySaving > 0 && <span className="text-xs text-muted-strong">Yearly saves up to {anyYearlySaving}%</span>}
          <Segmented
            label="Billing cycle"
            value={cycle}
            onChange={setCycle}
            options={[
              { value: 'monthly', label: CYCLE_LABEL.monthly },
              { value: 'yearly', label: CYCLE_LABEL.yearly },
            ]}
          />
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const action = planAction(sub, current, p, cycle, overview.checkout.available);
          const isCurrent = action.kind === 'current';
          const price = cyclePriceInr(p, cycle);
          return (
            <li key={p.key} className="min-w-0">
              <Card
                data-plan={p.key}
                className={cn('flex h-full flex-col gap-3 p-4', isCurrent && 'border-accent', highlight === p.key && !isCurrent && 'ring-2 ring-ring ring-offset-2 ring-offset-bg')}
                aria-label={`${p.name} plan`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-fg">{p.name}</h3>
                  {isCurrent && <Chip tone="indigo">{action.label}</Chip>}
                  {!isCurrent && highlight === p.key && <Chip tone="amber">Suggested</Chip>}
                </div>
                <p className="flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tabular-nums text-fg">{price === 0 ? 'Free' : formatInr(price)}</span>
                  {price > 0 && <span className="text-sm text-muted-strong">/ {cycle === 'yearly' ? 'year' : 'month'}</span>}
                </p>
                {cycle === 'yearly' && yearlySavingPct(p) > 0 && <p className="-mt-2 text-xs text-muted-strong">Saves {yearlySavingPct(p)}% against monthly</p>}
                <ul className="flex flex-col gap-1.5 text-sm text-fg-secondary">
                  <li>{limitText(p.limits.seats, 'users')}</li>
                  <li>{limitText(p.limits.leads, 'leads')}</li>
                  <li>{limitText(p.limits.whatsappMessagesPerMonth, 'WhatsApp messages a month')}</li>
                  <li>{limitText(p.limits.workflowRunsPerMonth, 'workflow runs a month')}</li>
                  <li>{storageText(p.limits.storageMb)}</li>
                </ul>
                <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm" aria-label={`${p.name} features`}>
                  {Object.entries(FEATURE_LABEL).map(([k, label]) => {
                    const on = !!p.features[k as keyof PlanDefinition['features']];
                    return (
                      <li key={k} className={cn('flex items-center gap-2', on ? 'text-fg' : 'text-muted')}>
                        {on ? <Check aria-hidden className="size-4 text-success" /> : <Minus aria-hidden className="size-4" />}
                        <span>
                          {label}
                          <span className="sr-only">{on ? ': included' : ': not included'}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-auto pt-1">
                  {action.kind === 'current' || action.kind === 'unavailable' ? (
                    <Button className="w-full" disabled>
                      {action.label}
                    </Button>
                  ) : canManage ? (
                    <Button className="w-full" variant={action.kind === 'upgrade' ? 'primary' : 'secondary'} onClick={() => setTarget({ plan: p, action })}>
                      {action.label}
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-strong">Ask your company admin to change the plan.</p>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
      {target && <PlanChangeDialog overview={overview} plan={target.plan} cycle={cycle} action={target.action} onClose={() => setTarget(null)} onCheckout={flow.start} />}
      {flow.dialog}
    </section>
  );
}

function PlanChangeDialog({
  overview,
  plan,
  cycle,
  action,
  onClose,
  onCheckout,
}: {
  overview: BillingOverview;
  plan: PlanDefinition;
  cycle: BillingCycle;
  action: Extract<PlanAction, { via: string }>;
  onClose: () => void;
  onCheckout: ReturnType<typeof useCheckoutFlow>['start'];
}) {
  const sub = overview.subscription;
  const m = useBillingMutations();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renewal = formatDay(sub.currentPeriodEnd.slice(0, 10));
  const price = planPricePaise(plan, cycle, sub.extraSeats);
  const what =
    action.via === 'checkout'
      ? `You pay for the ${plan.name} plan now (the unused part of your current plan is credited). The new limits apply as soon as the payment goes through.`
      : action.via === 'request'
        ? 'Online payment is not set up yet, so this sends a request to Tootodo. You get a notification when it is approved, with an invoice to pay.'
        : `Your plan stays as it is until ${renewal}; the ${plan.name} plan starts then. Usage above the smaller limits blocks new records from that day.`;

  const confirm = async () => {
    setError(null);
    try {
      const r = await m.changePlan.mutateAsync({ plan: plan.key, cycle, ...(note.trim() ? { note: note.trim() } : {}) });
      onClose();
      if (r.outcome === 'checkout' && r.checkout) await onCheckout(r.checkout);
      else if (r.outcome === 'scheduled') toast.success(`Your plan changes to ${plan.name} on ${renewal}`, { description: r.warnings.join(' ') || undefined });
      else if (r.outcome === 'requested') toast.success('Request sent to Tootodo', { description: 'You get a notification when it is decided.' });
      else toast.success(`You are on the ${plan.name} plan now`);
    } catch (e) {
      setError(isApiRequestError(e) ? e.message : 'The plan was not changed. Check your connection and try again.');
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !m.changePlan.isPending && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>
            {plan.name} plan, {CYCLE_LABEL[cycle].toLowerCase()}: {price === 0 ? 'free' : `${formatPaise(price)} before GST`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <p className="text-sm text-fg-secondary">{what}</p>
          {action.via === 'request' && (
            <FormField label="Note for Tootodo" hint="Optional, for example the number of users you need.">
              <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          )}
          {error && <InlineAlert>{error}</InlineAlert>}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={m.changePlan.isPending}>Cancel</Button>
          </DialogClose>
          <Button variant="primary" loading={m.changePlan.isPending} onClick={() => void confirm()}>
            {action.via === 'checkout' ? 'Continue to payment' : action.via === 'request' ? 'Send request' : `Move to ${plan.name} at renewal`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
