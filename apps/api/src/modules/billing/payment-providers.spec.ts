import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkoutSignature, MockProvider, parseRazorpayEvent, ProviderError, RazorpayProvider } from './payment-providers.js';

/** Pure checks of the payment providers (no database, no network: fetch is faked). */
const creds = { mode: 'test' as const, keyId: 'rzp_test_abcdef123', keySecret: 'key-secret-1234', webhookSecret: 'whsec-5678' };

describe('Razorpay signatures', () => {
  it('checkout signature is HMAC-SHA256 of order_id|payment_id with the key secret', () => {
    const expected = createHmac('sha256', creds.keySecret).update('order_ABC123|pay_XYZ789').digest('hex');
    expect(checkoutSignature('order_ABC123', 'pay_XYZ789', creds.keySecret)).toBe(expected);
    const p = new RazorpayProvider(creds);
    expect(p.verifyCheckout('order_ABC123', 'pay_XYZ789', expected)).toBe(true);
    expect(p.verifyCheckout('order_ABC123', 'pay_OTHER', expected)).toBe(false);
    expect(p.verifyCheckout('order_ABC123', 'pay_XYZ789', 'zz')).toBe(false);
  });

  it('webhook signature covers the raw body with the webhook secret', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const sig = createHmac('sha256', creds.webhookSecret).update(raw).digest('hex');
    const p = new RazorpayProvider(creds);
    expect(p.verifyWebhook(raw, sig)).toBe(true);
    expect(p.verifyWebhook(Buffer.from('{"event":"payment.failed"}'), sig)).toBe(false);
    // the key secret is not the webhook secret
    expect(p.verifyWebhook(raw, createHmac('sha256', creds.keySecret).update(raw).digest('hex'))).toBe(false);
  });

  it('the mock provider signs like Razorpay with its own secret', async () => {
    const mock = new MockProvider('mock-secret-for-tests');
    const { orderId } = await mock.createOrder();
    expect(orderId).toMatch(/^order_mock[A-Za-z0-9]+$/);
    const paymentId = mock.newPaymentId();
    expect(mock.verifyCheckout(orderId, paymentId, mock.sign(orderId, paymentId))).toBe(true);
    expect(new RazorpayProvider(creds).verifyCheckout(orderId, paymentId, mock.sign(orderId, paymentId))).toBe(false);
  });
});

describe('Razorpay orders (fetch faked)', () => {
  it('posts the amount in paise with basic auth and reads the order id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'order_Nx1234567890ab', amount: 235_900, currency: 'INR' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const p = new RazorpayProvider(creds, fake);
    const res = await p.createOrder({ amountPaise: 235_900, receipt: 'VST/2026-27/0001', notes: { invoiceId: 'x' } });
    expect(res.orderId).toBe('order_Nx1234567890ab');
    const seen = calls[0]!;
    expect(seen.url).toBe('https://api.razorpay.com/v1/orders');
    const headers = seen.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')}`);
    expect(JSON.parse(String(seen.init.body))).toEqual({ amount: 235_900, currency: 'INR', receipt: 'VST/2026-27/0001', notes: { invoiceId: 'x' } });
  });

  it('a refused order becomes a ProviderError without the response body', async () => {
    const fake = (async () => new Response('{"error":{"description":"Authentication failed"}}', { status: 401 })) as unknown as typeof fetch;
    await expect(new RazorpayProvider(creds, fake).createOrder({ amountPaise: 100, receipt: 'r', notes: {} })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('Razorpay webhook events', () => {
  it('reads payment.captured, payment.failed and order.paid', () => {
    expect(parseRazorpayEvent({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 118_000 } } } })).toEqual({ event: 'payment.captured', orderId: 'order_1', paymentId: 'pay_1', amountPaise: 118_000, error: null });
    expect(parseRazorpayEvent({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_2', order_id: 'order_2', amount: 500, error_description: 'Card declined' } } } })?.error).toBe('Card declined');
    expect(parseRazorpayEvent({ event: 'order.paid', payload: { order: { entity: { id: 'order_3', amount_paid: 900 } } } })).toMatchObject({ orderId: 'order_3', paymentId: null, amountPaise: 900 });
    expect(parseRazorpayEvent('nope')).toBeNull();
    expect(parseRazorpayEvent({ payload: {} })).toBeNull();
  });
});
