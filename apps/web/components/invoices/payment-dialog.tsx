'use client';

import { formatPaise, PAYMENT_MODES, type Invoice, type PaymentMode } from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { NativeSelect } from '@/components/common/native-select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { newRequestId } from '@/lib/api/client';
import { useInvoiceMutations } from '@/lib/crm/documents';
import { PAYMENT_MODE } from '@/lib/crm/format';
import { rupeesText } from '@/lib/crm/lines';
import { formErrorMessage } from '@/lib/crm/ui/errors';
import { parseRupees } from '@/lib/crm/ui/fields';

/** Record a payment received outside Vistar (UPI, bank transfer, cash, cheque). Retries are idempotent. */
export function PaymentDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const m = useInvoiceMutations();
  const [clientPaymentId] = useState(() => newRequestId());
  const [amount, setAmount] = useState(rupeesText(invoice.balancePaise));
  const [paidOn, setPaidOn] = useState('');
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const paise = parseRupees(amount);
    const errs: Record<string, string> = {};
    if (!paise) errs.amount = 'Enter the amount received.';
    else if (paise > invoice.balancePaise) errs.amount = `The balance is ${formatPaise(invoice.balancePaise)}. Enter at most that.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    try {
      await m.recordPayment.mutateAsync({ id: invoice.id, body: { amountPaise: paise!, paidOn: paidOn || undefined, mode, reference: reference.trim() || null, note: note.trim() || null, clientPaymentId } });
      toast.success(`Payment of ${formatPaise(paise!)} recorded`);
      onClose();
    } catch (err) {
      setFormError(formErrorMessage(err, 'The payment was not saved. Try again; it will not be recorded twice.'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <form onSubmit={(e) => void submit(e)} noValidate className="contents">
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              Invoice {invoice.number} · balance {formatPaise(invoice.balancePaise)} of {formatPaise(invoice.totalPaise)}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4 sm:grid-cols-2">
              {formError && (
                <p role="alert" className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-sm text-status-red-fg sm:col-span-2">
                  {formError}
                </p>
              )}
              <FormField label="Amount (₹)" required error={errors.amount}>
                <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </FormField>
              <FormField label="Received on" hint="Empty = today">
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </FormField>
              <FormField label="Mode">
                <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
                  {PAYMENT_MODES.map((p) => (
                    <option key={p} value={p}>
                      {PAYMENT_MODE[p]}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField label="Reference" hint="UTR, cheque number or receipt">
                <Input value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />
              </FormField>
              <FormField label="Note" className="sm:col-span-2">
                <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={m.recordPayment.isPending}>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" loading={m.recordPayment.isPending}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
