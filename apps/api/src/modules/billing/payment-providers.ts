import { randomBytes } from 'node:crypto';
import { hmacSha256Hex, safeEqualHex } from '../../infra/crypto/secrets.js';
import type { RazorpayCredentials } from './razorpay-config.service.js';

/**
 * Payment providers behind one interface (D-072): Razorpay (Orders API + checkout.js + webhooks) and a local
 * mock for development and tests (no network; same signature scheme with BILLING_MOCK_SECRET). Razorpay calls go
 * to the fixed host api.razorpay.com (no user-supplied URL, so no SSRF surface) with a timeout and a size cap.
 */
export interface OrderInput {
  amountPaise: number;
  /** Our reference (invoice number or id), max 40 characters. */
  receipt: string;
  notes: Record<string, string>;
}

export interface PaymentProviderAdapter {
  readonly kind: 'razorpay' | 'mock';
  createOrder(input: OrderInput): Promise<{ orderId: string }>;
  /** checkout.js success: signature = HMAC-SHA256(`${orderId}|${paymentId}`, key secret). */
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  /** Webhook: X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret). */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

export const checkoutSignature = (orderId: string, paymentId: string, secret: string): string => hmacSha256Hex(secret, `${orderId}|${paymentId}`);

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RazorpayProvider implements PaymentProviderAdapter {
  readonly kind = 'razorpay' as const;

  constructor(
    private readonly creds: RazorpayCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createOrder(input: OrderInput): Promise<{ orderId: string }> {
    const auth = Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(`${RAZORPAY_API}/orders`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: input.amountPaise, currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (err) {
      throw new ProviderError(`Razorpay is not reachable (${(err as Error).name})`);
    }
    const text = await readLimited(res, MAX_RESPONSE_BYTES);
    if (!res.ok) throw new ProviderError(`Razorpay refused the order (HTTP ${res.status})`, res.status);
    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = null;
    }
    if (typeof id !== 'string' || !/^order_[A-Za-z0-9]{6,40}$/.test(id)) throw new ProviderError('Razorpay returned an unexpected order');
    return { orderId: id };
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(checkoutSignature(orderId, paymentId, this.creds.keySecret), signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return safeEqualHex(hmacSha256Hex(this.creds.webhookSecret, rawBody), signature);
  }
}

export class MockProvider implements PaymentProviderAdapter {
  readonly kind = 'mock' as const;

  constructor(private readonly secret: string) {}

  async createOrder(): Promise<{ orderId: string }> {
    return { orderId: `order_mock${randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}` };
  }

  newPaymentId(): string {
    return `pay_mock${randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')}`;
  }

  sign(orderId: string, paymentId: string): string {
    return checkoutSignature(orderId, paymentId, this.secret);
  }

  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqualHex(this.sign(orderId, paymentId), signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string): boolean {
    return safeEqualHex(hmacSha256Hex(this.secret, rawBody), signature);
  }
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new ProviderError('Razorpay response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The parts of a Razorpay webhook event we use (payment.captured, payment.failed, order.paid). */
export interface RazorpayEvent {
  event: string;
  orderId: string | null;
  paymentId: string | null;
  amountPaise: number | null;
  error: string | null;
}

export function parseRazorpayEvent(body: unknown): RazorpayEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { event?: unknown; payload?: { payment?: { entity?: Record<string, unknown> }; order?: { entity?: Record<string, unknown> } } };
  if (typeof b.event !== 'string') return null;
  const payment = b.payload?.payment?.entity ?? null;
  const order = b.payload?.order?.entity ?? null;
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null);
  const orderId = str(payment?.order_id) ?? str(order?.id);
  const amount = payment?.amount ?? order?.amount_paid;
  return {
    event: b.event,
    orderId,
    paymentId: str(payment?.id),
    amountPaise: typeof amount === 'number' && Number.isInteger(amount) ? amount : null,
    error: typeof payment?.error_description === 'string' ? payment.error_description.slice(0, 300) : null,
  };
}
