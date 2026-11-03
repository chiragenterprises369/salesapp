'use client';

import { formatPaise, type Checkout } from '@vistar/shared';
import { FlaskConical } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { InlineAlert } from '@/components/settings/common/states';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { isApiRequestError } from '@/lib/api-error';
import { useBillingMutations } from '@/lib/billing/hooks';
import { CheckoutCancelled, openRazorpayCheckout } from '@/lib/billing/razorpay';

/**
 * Pays a Vistar invoice: Razorpay Standard Checkout (checkout.js loaded on demand) or, in development
 * without a Razorpay config, the `mock` provider's test payment dialog. Both end in
 * POST /billing/checkout/verify, which marks the invoice paid and applies a paid upgrade.
 */
export function useCheckoutFlow(): { start: (c: Checkout) => Promise<void>; busy: boolean; dialog: ReactNode } {
  const m = useBillingMutations();
  const [mock, setMock] = useState<Checkout | null>(null);
  const [busy, setBusy] = useState(false);

  const finish = useCallback(
    async (orderId: string, paymentId: string, signature: string) => {
      const r = await m.verify.mutateAsync({ orderId, paymentId, signature });
      toast.success(r.invoice.number ? `Payment received. Invoice ${r.invoice.number} is paid.` : 'Payment received.', {
        description: r.subscription.status === 'active' ? `You are on the ${r.subscription.planName} plan.` : undefined,
      });
    },
    [m.verify],
  );

  const start = useCallback(
    async (c: Checkout) => {
      if (c.provider === 'mock') {
        setMock(c);
        return;
      }
      if (!c.keyId) {
        toast.error('Online payment is not set up yet. Vistar can record a bank transfer instead.');
        return;
      }
      setBusy(true);
      try {
        const r = await openRazorpayCheckout({
          key: c.keyId,
          order_id: c.orderId,
          amount: c.amountPaise,
          currency: c.currency,
          name: c.name,
          description: c.description,
          prefill: { name: c.prefill.name ?? undefined, email: c.prefill.email ?? undefined, contact: c.prefill.contact ?? undefined },
          notes: c.notes,
        });
        await finish(r.razorpay_order_id, r.razorpay_payment_id, r.razorpay_signature);
      } catch (e) {
        if (e instanceof CheckoutCancelled) toast('Payment not completed', { description: 'The invoice stays due. Pay it any time from Invoices below.' });
        else toast.error(e instanceof Error ? e.message : 'The payment did not go through. Try again.');
      } finally {
        setBusy(false);
      }
    },
    [finish],
  );

  const dialog = <MockCheckoutDialog checkout={mock} onClose={() => setMock(null)} onPaid={finish} />;
  return { start, busy, dialog };
}

/** The dev mock provider: the API plays Razorpay (signed success fields, or a recorded failure). */
function MockCheckoutDialog({ checkout, onClose, onPaid }: { checkout: Checkout | null; onClose: () => void; onPaid: (orderId: string, paymentId: string, signature: string) => Promise<void> }) {
  const m = useBillingMutations();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<'success' | 'failure' | null>(null);
  const run = async (outcome: 'success' | 'failure') => {
    if (!checkout) return;
    setError(null);
    setRunning(outcome);
    try {
      const r = await m.mockPay.mutateAsync({ orderId: checkout.orderId, outcome });
      if (outcome === 'failure' || !r.signature) {
        setError(r.error ?? 'The test payment was declined.');
        return;
      }
      await onPaid(r.orderId, r.paymentId, r.signature);
      onClose();
    } catch (e) {
      setError(isApiRequestError(e) ? e.message : 'The test payment did not go through. Try again.');
    } finally {
      setRunning(null);
    }
  };
  return (
    <Dialog
      open={!!checkout}
      onOpenChange={(o) => {
        if (!o && !running) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Test payment</DialogTitle>
          <DialogDescription>Online payments are not set up, so this development build uses a test provider. No money moves.</DialogDescription>
        </DialogHeader>
        {checkout && (
          <DialogBody className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
              <FlaskConical aria-hidden className="size-5 shrink-0 text-muted" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{checkout.description}</p>
                <p className="text-2xl font-semibold tabular-nums text-fg">{formatPaise(checkout.amountPaise)}</p>
                <p className="text-xs text-muted-strong">Order {checkout.orderId}</p>
              </div>
            </div>
            {error && <InlineAlert>{error}</InlineAlert>}
          </DialogBody>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button disabled={!!running}>Cancel</Button>
          </DialogClose>
          <Button variant="secondary" loading={running === 'failure'} disabled={!!running} onClick={() => void run('failure')}>
            Decline payment
          </Button>
          <Button variant="primary" loading={running === 'success'} disabled={!!running} onClick={() => void run('success')}>
            Pay {checkout ? formatPaise(checkout.amountPaise) : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
