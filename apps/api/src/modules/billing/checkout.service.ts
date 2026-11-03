import { Injectable, Logger } from '@nestjs/common';
import { formatPaise, type Checkout, type CheckoutAvailability, type CheckoutResult, type CheckoutVerify, type MockCheckoutPayResult } from '@vistar/shared';
import { createHash } from 'node:crypto';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { PlatformPayment as PaymentRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { BillingCoreService } from './billing-core.service.js';
import { n, toSubscription } from './billing.mapper.js';
import { MockProvider, parseRazorpayEvent, ProviderError, RazorpayProvider, type PaymentProviderAdapter } from './payment-providers.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { RazorpayConfigService } from './razorpay-config.service.js';

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === 'P2002';

/**
 * Checkout for Vistar invoices (D-072): create a provider order for the balance (PlatformPayment `created`),
 * verify the checkout.js success fields, the dev mock "pay" step, and the Razorpay webhook (signature over the
 * raw body, idempotent by event id). Capturing a payment marks the invoice paid through PlatformInvoicesService.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BillingCoreService,
    private readonly invoices: PlatformInvoicesService,
    private readonly razorpay: RazorpayConfigService,
  ) {}

  private mock(): MockProvider {
    return new MockProvider(getEnv().BILLING_MOCK_SECRET);
  }

  async availability(): Promise<CheckoutAvailability> {
    const active = await this.razorpay.active();
    if (active.kind === 'razorpay') return { available: true, provider: 'razorpay', mode: active.creds.mode };
    if (active.kind === 'mock') return { available: true, provider: 'mock', mode: 'test' };
    return { available: false, provider: null, mode: null };
  }

  private async activeAdapter(): Promise<{ adapter: PaymentProviderAdapter; mode: 'test' | 'live'; keyId: string | null } | null> {
    const active = await this.razorpay.active();
    if (active.kind === 'razorpay') return { adapter: new RazorpayProvider(active.creds), mode: active.creds.mode, keyId: active.creds.keyId };
    if (active.kind === 'mock') return { adapter: this.mock(), mode: 'test', keyId: null };
    return null;
  }

  /** The adapter that created a payment (verification must use the same secret). */
  private async adapterFor(provider: string): Promise<PaymentProviderAdapter | null> {
    if (provider === 'razorpay') {
      const creds = await this.razorpay.credentials();
      return creds ? new RazorpayProvider(creds) : null;
    }
    if (provider === 'mock') return getEnv().NODE_ENV === 'production' ? null : this.mock();
    return null;
  }

  /** Start checkout for the balance of an issued invoice of this workspace. */
  async start(workspaceId: string, invoiceId: string, prefill: { name: string | null; email: string | null; contact: string | null }): Promise<Checkout> {
    const invoice = await this.invoices.row(invoiceId, workspaceId, true);
    if (invoice.status !== 'issued') throw new AppException('DOCUMENT_STATE_INVALID', invoice.status === 'paid' ? 'This invoice is already paid' : 'This invoice cannot be paid');
    const balance = n(invoice.totalPaise) - n(invoice.paidPaise);
    if (balance <= 0) throw new AppException('DOCUMENT_STATE_INVALID', 'Nothing is due on this invoice');
    const active = await this.activeAdapter();
    if (!active) throw new AppException('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Online payment is not set up yet. Use "Request change" or pay by bank transfer');
    let orderId: string;
    try {
      ({ orderId } = await active.adapter.createOrder({ amountPaise: balance, receipt: invoice.number ?? invoice.id.slice(0, 36), notes: { workspaceId, invoiceId, number: invoice.number ?? '' } }));
    } catch (err) {
      const message = err instanceof ProviderError ? err.message : 'The payment provider did not answer';
      this.logger.warn(`Checkout order failed: ${message}`);
      throw new AppException('INTEGRATION_PROVIDER_ERROR', 'Could not start the payment. Try again in a minute');
    }
    await this.prisma.platformPayment.create({ data: { workspaceId, invoiceId, amountPaise: BigInt(balance), status: 'created', provider: active.adapter.kind, providerOrderId: orderId } });
    const name = await this.core.companyName(workspaceId);
    return {
      provider: active.adapter.kind,
      mode: active.mode,
      keyId: active.keyId,
      scriptUrl: active.adapter.kind === 'razorpay' ? 'https://checkout.razorpay.com/v1/checkout.js' : null,
      orderId,
      amountPaise: balance,
      currency: 'INR',
      invoiceId,
      invoiceNumber: invoice.number,
      name: 'Vistar',
      description: `${invoice.number ?? 'Invoice'} for ${name}: ${formatPaise(balance)}`,
      prefill,
      notes: { workspaceId, invoiceId },
    };
  }

  /** checkout.js success handler -> verify the signature and capture (idempotent). */
  async verify(workspaceId: string, body: CheckoutVerify): Promise<CheckoutResult> {
    const payment = await this.prisma.platformPayment.findFirst({ where: { workspaceId, providerOrderId: body.orderId } });
    if (!payment) throw new AppException('PAYMENT_VERIFICATION_FAILED', 'This payment does not belong to an order of your company');
    const adapter = await this.adapterFor(payment.provider);
    if (!adapter || !adapter.verifyCheckout(body.orderId, body.paymentId, body.signature)) {
      throw new AppException('PAYMENT_VERIFICATION_FAILED', 'The payment could not be verified. If money was taken, it is refunded automatically or confirmed by the webhook');
    }
    await this.capture(payment, body.paymentId);
    const invoice = await this.invoices.get(payment.invoiceId, workspaceId, true);
    const sub = await this.core.ensure(workspaceId);
    return { invoice, subscription: toSubscription(sub, await this.core.plan(sub.plan)) };
  }

  /** Dev mock: answer like checkout.js would (success) or record a declined payment (failure). */
  async mockPay(workspaceId: string, body: { orderId: string; outcome: 'success' | 'failure' }): Promise<MockCheckoutPayResult> {
    const active = await this.razorpay.active();
    if (active.kind !== 'mock') throw notFound('Mock checkout');
    const payment = await this.prisma.platformPayment.findFirst({ where: { workspaceId, providerOrderId: body.orderId, provider: 'mock' } });
    if (!payment) throw notFound('Order');
    const mock = this.mock();
    const paymentId = mock.newPaymentId();
    if (body.outcome === 'failure') {
      await this.fail(payment, 'Payment declined (mock)');
      return { orderId: body.orderId, paymentId, signature: null, error: 'Payment declined (mock)' };
    }
    return { orderId: body.orderId, paymentId, signature: mock.sign(body.orderId, paymentId), error: null };
  }

  /** Capture once: payment `captured` with the provider payment id, invoice paid, subscription side effects. */
  private async capture(payment: PaymentRow, providerPaymentId: string): Promise<void> {
    let result: Awaited<ReturnType<PlatformInvoicesService['markPaid']>> | null = null;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.platformPayment.findUniqueOrThrow({ where: { id: payment.id } });
        if (fresh.status === 'captured') return null;
        await tx.platformPayment.update({ where: { id: payment.id }, data: { providerPaymentId: fresh.providerPaymentId ?? providerPaymentId } });
        const res = await this.invoices.markPaid(tx, payment.invoiceId, { provider: payment.provider as 'razorpay' | 'mock' }, { ...fresh, providerPaymentId });
        if (!res.changed) {
          // paid meanwhile (manually or by another order): keep the money visible for a refund
          await tx.platformPayment.update({ where: { id: payment.id }, data: { status: 'captured', note: 'The invoice was already paid: refund this payment in the Razorpay dashboard' } });
        }
        return res;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return; // the same provider payment id was captured by a concurrent call
      throw err;
    }
    if (result?.changed) await this.invoices.afterPaid(result.invoice, result.subscription);
  }

  private async fail(payment: PaymentRow, reason: string): Promise<void> {
    const { count } = await this.prisma.platformPayment.updateMany({ where: { id: payment.id, status: 'created' }, data: { status: 'failed', failureReason: reason.slice(0, 300) } });
    if (!count) return;
    const invoice = await this.prisma.platformInvoice.findUnique({ where: { id: payment.invoiceId }, select: { id: true, number: true, totalPaise: true } });
    const title = `Payment failed: invoice ${invoice?.number ?? ''}`.trim();
    const body = `${formatPaise(n(payment.amountPaise))}: ${reason}. Try again from Billing`;
    await this.core.notifyAdmins(
      payment.workspaceId,
      {
        type: 'billing_payment_failed',
        title,
        body,
        path: `/billing?invoice=${payment.invoiceId}`,
        data: { invoiceId: payment.invoiceId, paymentId: payment.id },
      },
      // ---- change #20: config (e-mail)
      { key: 'payment_failed', values: { title, message: `${body}.`, invoiceNumber: invoice?.number ?? '', amount: formatPaise(n(payment.amountPaise)) } },
    );
  }

  /**
   * Razorpay webhook. Valid signatures: the configured webhook secret, and outside production the mock secret.
   * payment.captured / order.paid capture the payment of our order; payment.failed records the failure. Unknown
   * orders and events are acknowledged (200) so Razorpay stops retrying.
   */
  async webhook(rawBody: Buffer, signature: string | undefined, eventIdHeader: string | undefined, body: unknown): Promise<{ ok: true; duplicate: boolean }> {
    if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'Missing or malformed X-Razorpay-Signature');
    const creds = await this.razorpay.credentials();
    const byRazorpay = !!creds && new RazorpayProvider(creds).verifyWebhook(rawBody, signature.toLowerCase());
    const byMock = !byRazorpay && getEnv().NODE_ENV !== 'production' && this.mock().verifyWebhook(rawBody, signature.toLowerCase());
    if (!byRazorpay && !byMock) throw new AppException('WEBHOOK_SIGNATURE_INVALID', 'The webhook signature does not match');
    const event = parseRazorpayEvent(body);
    const eventId = (eventIdHeader && eventIdHeader.length <= 100 ? eventIdHeader : null) ?? `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    try {
      await this.prisma.billingWebhookEvent.create({ data: { provider: 'razorpay', eventId, type: event?.event ?? 'unknown' } });
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: true, duplicate: true };
      throw err;
    }
    if (byRazorpay) await this.razorpay.touchWebhook(new Date());
    if (!event?.orderId) return { ok: true, duplicate: false };
    const payment = await this.prisma.platformPayment.findUnique({ where: { providerOrderId: event.orderId } });
    if (!payment) return { ok: true, duplicate: false };
    await this.prisma.billingWebhookEvent.updateMany({ where: { provider: 'razorpay', eventId }, data: { workspaceId: payment.workspaceId } });
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      if (event.amountPaise !== null && event.amountPaise !== n(payment.amountPaise)) {
        this.logger.warn(`Razorpay ${event.event} amount ${event.amountPaise} differs from the order amount; not captured`);
        return { ok: true, duplicate: false };
      }
      await this.capture(payment, event.paymentId ?? `pay_${event.orderId.slice(6)}`);
    } else if (event.event === 'payment.failed') {
      await this.fail(payment, event.error ?? 'The bank declined the payment');
    }
    return { ok: true, duplicate: false };
  }
}
