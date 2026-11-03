'use client';

/**
 * Razorpay Standard Checkout, loaded on demand (only when the company starts a payment and the platform
 * has Razorpay configured): https://checkout.razorpay.com/v1/checkout.js. The browser gets the order id
 * and the public key id from the API; the payment is verified on the API (signature over
 * `${order_id}|${payment_id}` with the key secret) and by the signed webhook. No secret reaches the web.
 */
const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (resp: { error?: { description?: string; reason?: string } }) => void): void;
}
type RazorpayCtor = new (opts: RazorpayCheckoutOptions & { handler: (r: RazorpaySuccess) => void; modal?: { ondismiss?: () => void; escape?: boolean } }) => RazorpayInstance;

export class CheckoutCancelled extends Error {
  constructor() {
    super('Payment window closed before paying.');
  }
}
export class CheckoutFailed extends Error {}

let loading: Promise<RazorpayCtor> | null = null;

/** Load checkout.js once per tab (a failed load can be retried). */
export function loadRazorpay(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  if (loading) return loading;
  loading = new Promise<RazorpayCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => (w.Razorpay ? resolve(w.Razorpay) : reject(new CheckoutFailed('Razorpay checkout did not load.')));
    s.onerror = () => {
      s.remove();
      reject(new CheckoutFailed('Razorpay checkout could not be loaded. Check your connection or ad blocker and try again.'));
    };
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Open the checkout; resolves with the ids and signature to verify, rejects on close or failure. */
export async function openRazorpayCheckout(opts: RazorpayCheckoutOptions): Promise<RazorpaySuccess> {
  const Razorpay = await loadRazorpay();
  return new Promise<RazorpaySuccess>((resolve, reject) => {
    let settled = false;
    const rzp = new Razorpay({
      ...opts,
      handler: (r) => {
        settled = true;
        resolve(r);
      },
      modal: {
        escape: true,
        ondismiss: () => {
          if (!settled) reject(new CheckoutCancelled());
        },
      },
    });
    rzp.on('payment.failed', (resp) => {
      settled = true;
      reject(new CheckoutFailed(resp.error?.description || 'The payment failed. No money was taken; try again or use another method.'));
    });
    rzp.open();
  });
}
