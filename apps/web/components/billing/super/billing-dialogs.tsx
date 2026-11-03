'use client';

import {
  computeDocument,
  formatPaise,
  GST_RATES,
  INDIAN_STATES,
  PLANS,
  type BillingCycle,
  type CompanyBilling,
  type PaymentMode,
  type Plan,
  type PlanChangeRequest,
  type PlatformInvoiceListItem,
} from '@vistar/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Segmented } from '@/components/dashboard/segmented';
import { Switch } from '@/components/common/switch';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useSuperBillingMutations } from '@/lib/billing/hooks';
import { CYCLE_LABEL, planName } from '@/lib/billing/logic';
import { formErrorMessage, focusFirstInvalid, serverFieldErrors } from '@/lib/crm/ui/errors';
import { parseRupees } from '@/lib/crm/ui/fields';
import { PAYMENT_MODE } from '@/lib/crm/format';

/** Super Admin billing dialogs: manual invoice, mark paid, cancel, extend trial, change plan, decide a request. */

const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const newKey = () => crypto.randomUUID();

function Shell({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  formId,
  submitLabel,
  submitting,
  danger,
  error,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  formId: string;
  submitLabel: string;
  submitting: boolean;
  danger?: boolean;
  error: string | null;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            {error && <InlineAlert>{error}</InlineAlert>}
            {children}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={submitting}>Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant={danger ? 'danger' : 'primary'} loading={submitting}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDialogForm() {
  const formId = `sb-${useId().replace(/:/g, '')}`;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const invalid = (e: Record<string, string>) => {
    setErrors(e);
    setError(Object.keys(e).length === 1 ? 'Fix the highlighted field.' : `Fix the ${Object.keys(e).length} highlighted fields.`);
    focusFirstInvalid(formId);
  };
  const server = (err: unknown, fallback: string) => {
    setErrors(serverFieldErrors(err));
    setError(formErrorMessage(err, fallback));
    focusFirstInvalid(formId);
  };
  const reset = () => {
    setErrors({});
    setError(null);
  };
  return { formId, errors, error, invalid, server, reset };
}

// ---------------------------------------------------------------- manual invoice

interface LineDraft {
  key: string;
  name: string;
  description: string;
  quantity: string;
  price: string;
  gstRate: string;
}
const emptyLine = (): LineDraft => ({ key: newKey(), name: '', description: '', quantity: '1', price: '', gstRate: '18' });

export function ManualInvoiceDialog({ billing, open, onOpenChange }: { billing: CompanyBilling; open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(billing.company.id);
  const contactState = billing.subscription.billingContact?.address?.stateCode ?? null;
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [issueDate, setIssueDate] = useState(todayIst);
  const [dueDate, setDueDate] = useState('');
  const [pos, setPos] = useState<string>(contactState ?? '');
  const [notes, setNotes] = useState('');
  const [issue, setIssue] = useState(true);
  const set = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Live GST preview with the shared math (Vistar's state comes from the API; the preview uses the place of supply only for the mode label).
  const parsed = lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPricePaise: parseRupees(l.price) ?? 0, discountKind: 'percent' as const, discountValue: 0, gstRate: Number(l.gstRate) || 0 }));
  const preview = computeDocument(parsed, { sellerStateCode: null, placeOfSupplyStateCode: null });

  const submit = async () => {
    const e: Record<string, string> = {};
    lines.forEach((l, i) => {
      if (!l.name.trim()) e[`lines.${i}.name`] = 'Enter what the line is for.';
      if (parseRupees(l.price) === null) e[`lines.${i}.unitPricePaise`] = 'Enter the price in rupees, e.g. 4999 or 4999.50.';
      if (!(Number(l.quantity) > 0)) e[`lines.${i}.quantity`] = 'Enter a quantity above 0.';
    });
    if (dueDate && dueDate < issueDate) e.dueDate = 'The due date cannot be before the issue date.';
    if (Object.keys(e).length) return f.invalid(e);
    try {
      const inv = await m.createInvoice.mutateAsync({
        lines: lines.map((l) => ({ name: l.name.trim(), description: l.description.trim() || null, quantity: Number(l.quantity), unitPricePaise: parseRupees(l.price)!, gstRate: Number(l.gstRate) as 18 })),
        issueDate,
        ...(dueDate ? { dueDate } : {}),
        placeOfSupplyStateCode: (pos || null) as never,
        notes: notes.trim() || null,
        issue,
      });
      toast.success(inv.number ? `Invoice ${inv.number} issued to ${billing.company.name}` : `Draft invoice saved for ${billing.company.name}`);
      onOpenChange(false);
    } catch (err) {
      f.server(err, 'The invoice was not created. Check your connection and try again.');
    }
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} size="xl" title={`New invoice for ${billing.company.name}`} description="GST is worked out from Vistar's state and the place of supply (CGST + SGST or IGST)." formId={f.formId} submitLabel={issue ? 'Issue invoice' : 'Save draft'} submitting={m.createInvoice.isPending} error={f.error}>
      <form
        id={f.formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-fg">Lines</legend>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[minmax(0,2fr)_6rem_8rem_6rem_auto]">
              <FormField label={`Line ${i + 1}`} required error={f.errors[`lines.${i}.name`]}>
                <Input value={l.name} maxLength={200} placeholder="e.g. Onboarding and data import" onChange={(e) => set(l.key, { name: e.target.value })} />
              </FormField>
              <FormField label="Qty" error={f.errors[`lines.${i}.quantity`]}>
                <Input inputMode="decimal" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
              </FormField>
              <FormField label="Price (₹)" required error={f.errors[`lines.${i}.unitPricePaise`]}>
                <Input inputMode="decimal" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} />
              </FormField>
              <FormField label="GST">
                <NativeSelect value={l.gstRate} onChange={(e) => set(l.key, { gstRate: e.target.value })}>
                  {GST_RATES.map((r) => (
                    <option key={r} value={String(r)}>
                      {r}%
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <div className="flex items-end">
                <Button size="icon" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <FormField label="Description" className="sm:col-span-5">
                <Input value={l.description} maxLength={500} onChange={(e) => set(l.key, { description: e.target.value })} />
              </FormField>
            </div>
          ))}
          <Button className="w-max" onClick={() => setLines((ls) => [...ls, emptyLine()])} disabled={lines.length >= 50}>
            <Plus aria-hidden />
            Add line
          </Button>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Issue date">
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </FormField>
          <FormField label="Due date" hint="Empty = the payment terms of the Vistar profile" error={f.errors.dueDate}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </FormField>
          <FormField label="Place of supply" hint={contactState ? 'From the billing details' : 'No billing state on file'} error={f.errors.placeOfSupplyStateCode}>
            <NativeSelect value={pos} onChange={(e) => setPos(e.target.value)}>
              <option value="">Billing state, else Vistar&apos;s state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </div>
        <FormField label="Notes" hint="Printed on the invoice">
          <Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-2 px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={issue} onCheckedChange={setIssue} />
            Issue now (gives the next VST number and notifies the company admins)
          </label>
          <span className="text-sm text-fg tabular-nums" aria-live="polite">
            Taxable {formatPaise(preview.totals.taxablePaise)} + GST {formatPaise(preview.totals.taxPaise)} ≈ <strong>{formatPaise(preview.totals.totalPaise)}</strong>
          </span>
        </div>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------- mark paid

const MODES: PaymentMode[] = ['bank_transfer', 'upi', 'cheque', 'cash', 'card', 'other'];

export function MarkPaidDialog({ invoice, onClose }: { invoice: PlatformInvoiceListItem; onClose: () => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(invoice.workspaceId);
  const [mode, setMode] = useState<PaymentMode>('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIst);
  const [note, setNote] = useState('');
  const [clientPaymentId] = useState(newKey);
  const submit = async () => {
    if (paidOn > todayIst()) return f.invalid({ paidOn: 'The payment date cannot be in the future.' });
    try {
      const inv = await m.markPaid.mutateAsync({ id: invoice.id, body: { mode, reference: reference.trim() || null, paidOn, note: note.trim() || null, clientPaymentId } });
      toast.success(`${inv.number ?? 'Invoice'} marked paid`);
      onClose();
    } catch (err) {
      f.server(err, 'The payment was not recorded. Try again; it will not be recorded twice.');
    }
  };
  return (
    <Shell open onOpenChange={(o) => !o && onClose()} title={`Mark ${invoice.number ?? 'invoice'} paid`} description={`${invoice.companyName} · balance ${formatPaise(invoice.balancePaise)}`} formId={f.formId} submitLabel={`Record ${formatPaise(invoice.balancePaise)}`} submitting={m.markPaid.isPending} error={f.error}>
      <form
        id={f.formId}
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Method">
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
            {MODES.map((x) => (
              <option key={x} value={x}>
                {PAYMENT_MODE[x]}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Paid on" error={f.errors.paidOn}>
          <Input type="date" value={paidOn} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} />
        </FormField>
        <FormField label="Reference" hint="UTR, cheque number or UPI reference" error={f.errors.reference} className="sm:col-span-2">
          <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
        </FormField>
        <FormField label="Note" className="sm:col-span-2">
          <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------- cancel invoice

export function CancelInvoiceDialog({ invoice, onClose }: { invoice: PlatformInvoiceListItem; onClose: () => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(invoice.workspaceId);
  const [reason, setReason] = useState('');
  const submit = async () => {
    if (reason.trim().length < 5) return f.invalid({ reason: 'Explain why (at least 5 characters).' });
    try {
      await m.cancelInvoice.mutateAsync({ id: invoice.id, body: { reason: reason.trim() } });
      toast.success(`${invoice.number ?? 'Draft invoice'} cancelled`);
      onClose();
    } catch (err) {
      f.server(err, 'The invoice was not cancelled. Try again.');
    }
  };
  return (
    <Shell open onOpenChange={(o) => !o && onClose()} title={`Cancel ${invoice.number ?? 'draft invoice'}?`} description="The number stays used (GST numbering has no gaps). The company no longer sees it as due." formId={f.formId} submitLabel="Cancel invoice" danger submitting={m.cancelInvoice.isPending} error={f.error}>
      <form
        id={f.formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Reason" required error={f.errors.reason}>
          <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------- extend trial

export function ExtendTrialDialog({ billing, open, onOpenChange }: { billing: CompanyBilling; open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(billing.company.id);
  const [by, setBy] = useState<'days' | 'until'>('days');
  const [days, setDays] = useState('7');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const submit = async () => {
    const e: Record<string, string> = {};
    const n = Number(days);
    if (by === 'days' && (!Number.isInteger(n) || n < 1 || n > 90)) e.days = 'Enter 1 to 90 days.';
    if (by === 'until' && (!until || until <= todayIst())) e.until = 'Pick a date after today.';
    if (reason.trim().length < 5) e.reason = 'Explain why (at least 5 characters).';
    if (Object.keys(e).length) return f.invalid(e);
    try {
      const r = await m.extendTrial.mutateAsync({ ...(by === 'days' ? { days: n } : { until }), reason: reason.trim() });
      toast.success(`Trial of ${billing.company.name} extended`, { description: r.subscription.trialEndsAt ? `Ends ${new Date(r.subscription.trialEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}` : undefined });
      onOpenChange(false);
    } catch (err) {
      f.server(err, 'The trial was not extended. Try again.');
    }
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={`Extend the trial of ${billing.company.name}`} description="Days are added to the current trial end (or to today when the trial has ended). The change is in the platform audit log." formId={f.formId} submitLabel="Extend trial" submitting={m.extendTrial.isPending} error={f.error}>
      <form
        id={f.formId}
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Segmented
          label="Extend by"
          value={by}
          onChange={setBy}
          options={[
            { value: 'days', label: 'Add days' },
            { value: 'until', label: 'Until a date' },
          ]}
        />
        {by === 'days' ? (
          <FormField label="Extra days" required error={f.errors.days}>
            <Input inputMode="numeric" value={days} maxLength={2} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          </FormField>
        ) : (
          <FormField label="Trial ends on" required hint="End of that day, India time" error={f.errors.until}>
            <Input type="date" value={until} min={todayIst()} onChange={(e) => setUntil(e.target.value)} />
          </FormField>
        )}
        <FormField label="Reason" required error={f.errors.reason}>
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </form>
    </Shell>
  );
}
// ---------------------------------------------------------------- change plan

export function SuperPlanDialog({ billing, open, onOpenChange }: { billing: CompanyBilling; open: boolean; onOpenChange: (o: boolean) => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(billing.company.id);
  const sub = billing.subscription;
  const [plan, setPlan] = useState<Plan>(sub.plan);
  const [cycle, setCycle] = useState<BillingCycle>(sub.cycle);
  const [extraSeats, setExtraSeats] = useState(String(sub.extraSeats));
  const [effective, setEffective] = useState<'now' | 'period_end'>('now');
  const [invoice, setInvoice] = useState(false);
  const [reason, setReason] = useState('');
  const submit = async () => {
    const e: Record<string, string> = {};
    const seats = Number(extraSeats || 0);
    if (!Number.isInteger(seats) || seats < 0 || seats > 10_000) e.extraSeats = 'Enter 0 to 10,000.';
    if (reason.trim().length < 5) e.reason = 'Explain why (at least 5 characters).';
    if (plan === sub.plan && cycle === sub.cycle && seats === sub.extraSeats) e.plan = 'Pick a different plan, cycle or number of extra seats.';
    if (Object.keys(e).length) return f.invalid(e);
    try {
      await m.changePlan.mutateAsync({ plan, cycle, extraSeats: seats, effective, invoice: effective === 'now' && invoice, reason: reason.trim() });
      toast.success(effective === 'now' ? `${billing.company.name} is on the ${planName(plan)} plan` : `${billing.company.name} moves to ${planName(plan)} at renewal`);
      onOpenChange(false);
    } catch (err) {
      f.server(err, 'The plan was not changed. Try again.');
    }
  };
  return (
    <Shell open={open} onOpenChange={onOpenChange} title={`Change the plan of ${billing.company.name}`} description={`Now: ${sub.planName}, ${CYCLE_LABEL[sub.cycle].toLowerCase()}${sub.extraSeats ? `, ${sub.extraSeats} extra seats` : ''}.`} formId={f.formId} submitLabel="Change plan" submitting={m.changePlan.isPending} error={f.error}>
      <form
        id={f.formId}
        noValidate
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Plan" error={f.errors.plan}>
          <NativeSelect value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {planName(p)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField label="Billing cycle">
          <NativeSelect value={cycle} onChange={(e) => setCycle(e.target.value as BillingCycle)}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </NativeSelect>
        </FormField>
        <FormField label="Extra seats" hint="On top of the plan's users" error={f.errors.extraSeats}>
          <Input inputMode="numeric" value={extraSeats} onChange={(e) => setExtraSeats(e.target.value.replace(/\D/g, ''))} />
        </FormField>
        <FormField label="When">
          <NativeSelect value={effective} onChange={(e) => setEffective(e.target.value as 'now' | 'period_end')}>
            <option value="now">Now</option>
            <option value="period_end">At the period end</option>
          </NativeSelect>
        </FormField>
        {effective === 'now' && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Switch checked={invoice} onCheckedChange={setInvoice} />
            Issue a prorated invoice when the change costs more now
          </label>
        )}
        <FormField label="Reason" required error={f.errors.reason} className="sm:col-span-2">
          <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------- decide a plan request

export function DecideRequestDialog({ request, decision, onClose }: { request: PlanChangeRequest; decision: 'approve' | 'reject'; onClose: () => void }) {
  const f = useDialogForm();
  const m = useSuperBillingMutations(request.workspaceId);
  const [note, setNote] = useState('');
  const [effective, setEffective] = useState<'now' | 'period_end'>('now');
  const [invoice, setInvoice] = useState(true);
  const approve = decision === 'approve';
  const submit = async () => {
    if (!approve && note.trim().length < 5) return f.invalid({ note: 'Tell the company why (at least 5 characters).' });
    try {
      await m.decideRequest.mutateAsync({ id: request.id, body: { decision, ...(note.trim() ? { note: note.trim() } : {}), effective, invoice: approve && invoice } });
      toast.success(approve ? `${request.companyName} moves to ${planName(request.toPlan)}` : `Request of ${request.companyName} rejected`);
      onClose();
    } catch (err) {
      f.server(err, 'The request was not updated. Try again.');
    }
  };
  return (
    <Shell
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${approve ? 'Approve' : 'Reject'} ${planName(request.fromPlan)} → ${planName(request.toPlan)} for ${request.companyName}`}
      description={request.note ? `Their note: “${request.note}”` : `${CYCLE_LABEL[request.cycle]} billing.`}
      formId={f.formId}
      submitLabel={approve ? 'Approve' : 'Reject request'}
      danger={!approve}
      submitting={m.decideRequest.isPending}
      error={f.error}
    >
      <form
        id={f.formId}
        noValidate
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {approve && (
          <>
            <FormField label="When">
              <NativeSelect value={effective} onChange={(e) => setEffective(e.target.value as 'now' | 'period_end')}>
                <option value="now">Now</option>
                <option value="period_end">At the period end</option>
              </NativeSelect>
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={invoice} onCheckedChange={setInvoice} />
              Issue the prorated invoice (the company pays it online or by bank transfer)
            </label>
          </>
        )}
        <FormField label={approve ? 'Note to the company' : 'Reason'} required={!approve} error={f.errors.note}>
          <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormField>
      </form>
    </Shell>
  );
}
