import { gstinCheckChar, InvoiceSchema, PublicDocumentSchema, QuotationSchema, SellerProfileResponseSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Quotations and invoices over HTTP (change #19 wave B): seller profile, GST maths (intra-state CGST+SGST,
 * inter-state IGST, discount, round-off), numbering per financial year, status flow, PDF, share links,
 * payments with idempotency, tenant isolation. Written for Kiro Crew; run with `pnpm --filter @vistar/api test documents.http`.
 */
const gstin = (state: string, pan = 'AABCV1234F') => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;
const addr = (stateCode: string, city: string) => ({ line1: '12 Test Road', city, stateCode, pincode: '411001', country: 'IN' });

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let intraAccount = '';
let interAccount = '';

beforeAll(async () => {
  h = await createHarness('docs');
  a = await h.workspace('a');
  b = await h.workspace('b');
  const profile = await h.api().put('/api/v1/billing/profile').set(bearer(a.token)).send({ legalName: 'Test Sales Pvt Ltd', gstin: gstin('27'), address: addr('27', 'Pune') });
  expect(profile.status, JSON.stringify(profile.body)).toBe(200);
  expect(SellerProfileResponseSchema.parse(profile.body)).toMatchObject({ stateCode: '27', complete: true });
  const intra = await h.api().post('/api/v1/accounts').set(bearer(a.token)).send({ name: 'Pune Buyer', gstin: gstin('27', 'AAACP1111K'), billingAddress: addr('27', 'Pune') });
  const inter = await h.api().post('/api/v1/accounts').set(bearer(a.token)).send({ name: 'Bengaluru Buyer', gstin: gstin('29', 'AAACB2222L'), billingAddress: { ...addr('29', 'Bengaluru'), pincode: '560001' } });
  expect(intra.status, JSON.stringify(intra.body)).toBe(201);
  expect(inter.status, JSON.stringify(inter.body)).toBe(201);
  intraAccount = intra.body.id;
  interAccount = inter.body.id;
}, 90_000);

afterAll(async () => {
  await h?.close();
});

const line = (o: Record<string, unknown> = {}) => ({ name: 'Widget', hsnSac: '8471', unit: 'NOS', quantity: 2, unitPricePaise: 100_000, gstRate: 18, ...o });

describe('seller profile', () => {
  it('rejects a GSTIN from another state than the address', async () => {
    const res = await h.api().put('/api/v1/billing/profile').set(bearer(b.token)).send({ legalName: 'X', gstin: gstin('29'), address: addr('27', 'Pune') });
    expect(res.status).toBe(422);
  });
  it('anyone signed in can read it; only settings.manage can write it', async () => {
    const emp = await h.member(a.workspaceId, 'employee', 'docs-emp');
    expect((await h.api().get('/api/v1/billing/profile').set(bearer(emp.token))).body.stateCode).toBe('27');
    expect((await h.api().put('/api/v1/billing/profile').set(bearer(emp.token)).send({ legalName: 'X', address: addr('27', 'Pune') })).status).toBe(403);
  });
});

describe('GST maths', () => {
  it('intra-state: CGST = SGST = 9% each of the taxable value', async () => {
    const res = await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: intraAccount, lines: [line()] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const q = QuotationSchema.parse(res.body);
    expect(q.totals).toMatchObject({ taxMode: 'intra', taxablePaise: 200_000, cgstPaise: 18_000, sgstPaise: 18_000, igstPaise: 0, totalPaise: 236_000, roundOffPaise: 0 });
    expect(q.totals.amountInWords).toBe('Rupees Two Thousand Three Hundred Sixty Only');
    expect(q.placeOfSupplyStateCode).toBe('27');
  });

  it('inter-state: IGST 18% when the buyer state differs', async () => {
    const res = await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: interAccount, lines: [line()] });
    const q = QuotationSchema.parse(res.body);
    expect(q.totals).toMatchObject({ taxMode: 'inter', cgstPaise: 0, sgstPaise: 0, igstPaise: 36_000, totalPaise: 236_000 });
    expect(q.placeOfSupplyStateCode).toBe('29');
  });

  it('explicit place of supply wins over the buyer address', async () => {
    const res = await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: interAccount, placeOfSupplyStateCode: '27', lines: [line()] });
    expect(QuotationSchema.parse(res.body).totals.taxMode).toBe('intra');
  });

  it('percent discount and round-off to the rupee', async () => {
    const res = await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({
      accountId: intraAccount,
      lines: [line({ quantity: 3, unitPricePaise: 33_333, gstRate: 5 }), line({ quantity: 1, unitPricePaise: 100_000, discountKind: 'percent', discountValue: 10, gstRate: 12 })],
    });
    const t = QuotationSchema.parse(res.body).totals;
    // line 1: 99 999 taxable, CGST = SGST = round(2 499.975) = 2 500; line 2: 90 000 taxable, 5 400 + 5 400
    expect(t.taxablePaise).toBe(189_999);
    expect(t.discountPaise).toBe(10_000);
    expect(t.cgstPaise).toBe(7_900);
    expect(t.sgstPaise).toBe(7_900);
    expect(t.totalPaise % 100).toBe(0);
    expect(t.roundOffPaise).toBe(t.totalPaise - (189_999 + 15_800));
    expect(t.taxSummary.map((r) => r.gstRate).sort()).toEqual([12, 5]);
  });

  it('a product line takes name, HSN, unit, rate and price from the product', async () => {
    const p = await h.api().post('/api/v1/products').set(bearer(a.token)).send({ sku: 'PRD-T1', name: 'Solar Panel', hsnSac: '8541', unit: 'NOS', gstRate: 12, unitPricePaise: 1_450_000 });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const res = await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: intraAccount, lines: [{ productId: p.body.id, quantity: 2 }] });
    const q = QuotationSchema.parse(res.body);
    expect(q.lines[0]).toMatchObject({ name: 'Solar Panel', hsnSac: '8541', gstRate: 12, unitPricePaise: 1_450_000, taxablePaise: 2_900_000 });
  });
});

describe('quotation flow', () => {
  it('numbers QT/<FY>/<seq>, sends with a share link, renders a PDF, converts to an invoice', async () => {
    const created = QuotationSchema.parse((await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: intraAccount, lines: [line()] })).body);
    expect(created.number).toMatch(/^QT\/\d{4}-\d{2}\/\d{4}$/);
    expect(created.status).toBe('draft');

    // accepted is not allowed from draft
    expect((await h.api().post(`/api/v1/quotations/${created.id}/status`).set(bearer(a.token)).send({ status: 'accepted' })).status).toBe(409);

    const sent = await h.api().post(`/api/v1/quotations/${created.id}/send`).set(bearer(a.token)).send({ expiresInDays: 7 });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.quotation.status).toBe('sent');
    expect(sent.body.share.url).toMatch(/\/d\/[A-Za-z0-9_-]{32,64}$/);
    const token = String(sent.body.share.url).split('/d/')[1]!;

    // edits are draft only
    expect((await h.api().patch(`/api/v1/quotations/${created.id}`).set(bearer(a.token)).send({ notes: 'x' })).status).toBe(409);

    const pdf = await h.api().get(`/api/v1/quotations/${created.id}/pdf?download=1`).set(bearer(a.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('attachment');
    const bytes = pdf.body as Buffer;
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect(bytes.subarray(-6).toString('latin1')).toContain('%%EOF');

    const pub = await h.api().get(`/api/v1/public/documents/${token}`);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    expect(PublicDocumentSchema.parse(pub.body)).toMatchObject({ kind: 'quotation', number: created.number });
    expect((await h.api().get(`/api/v1/public/documents/${token}/pdf`)).status).toBe(200);

    const inv = await h.api().post(`/api/v1/quotations/${created.id}/convert`).set(bearer(a.token));
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const again = await h.api().post(`/api/v1/quotations/${created.id}/convert`).set(bearer(a.token));
    expect(again.body.id).toBe(inv.body.id);
    expect(InvoiceSchema.parse(inv.body)).toMatchObject({ status: 'draft', number: null, quotationId: created.id });
    expect((await h.api().get(`/api/v1/quotations/${created.id}`).set(bearer(a.token))).body.status).toBe('accepted');

    expect((await h.api().delete(`/api/v1/quotations/${created.id}/share`).set(bearer(a.token))).status).toBe(200);
    expect((await h.api().get(`/api/v1/public/documents/${token}`)).status).toBe(410);
  });

  it('another workspace cannot read the quotation', async () => {
    const q = (await h.api().post('/api/v1/quotations').set(bearer(a.token)).send({ accountId: intraAccount, lines: [line()] })).body;
    expect((await h.api().get(`/api/v1/quotations/${q.id}`).set(bearer(b.token))).status).toBe(404);
    expect((await h.api().get(`/api/v1/quotations/${q.id}/pdf`).set(bearer(b.token))).status).toBe(404);
  });
});

describe('invoice flow and payments', () => {
  it('issues with a gap-free number, records payments idempotently, rejects overpayment', async () => {
    const draft = InvoiceSchema.parse((await h.api().post('/api/v1/invoices').set(bearer(a.token)).send({ accountId: interAccount, lines: [line()] })).body);
    expect(draft.number).toBeNull();
    expect((await h.api().post(`/api/v1/invoices/${draft.id}/payments`).set(bearer(a.token)).send({ amountPaise: 1000, mode: 'upi' })).status).toBe(409);

    const issued = await h.api().post(`/api/v1/invoices/${draft.id}/issue`).set(bearer(a.token)).send({});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body.number).toMatch(/^INV\/\d{4}-\d{2}\/\d{4}$/);
    expect(issued.body.totals.igstPaise).toBe(36_000);

    const half = { amountPaise: 118_000, mode: 'bank_transfer', reference: 'UTR123', clientPaymentId: 'pay-0001-test' };
    const p1 = await h.api().post(`/api/v1/invoices/${draft.id}/payments`).set(bearer(a.token)).send(half);
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    expect(p1.body).toMatchObject({ status: 'partially_paid', paidPaise: 118_000, balancePaise: 118_000 });
    const retry = await h.api().post(`/api/v1/invoices/${draft.id}/payments`).set(bearer(a.token)).send(half);
    expect(retry.body.payments).toHaveLength(1);

    expect((await h.api().post(`/api/v1/invoices/${draft.id}/payments`).set(bearer(a.token)).send({ amountPaise: 200_000, mode: 'cash' })).body.error.code).toBe('PAYMENT_EXCEEDS_BALANCE');
    const p2 = await h.api().post(`/api/v1/invoices/${draft.id}/payments`).set(bearer(a.token)).send({ amountPaise: 118_000, mode: 'cash' });
    expect(p2.body).toMatchObject({ status: 'paid', balancePaise: 0 });

    const voided = await h.api().delete(`/api/v1/invoices/${draft.id}/payments/${p2.body.payments[1].id}`).set(bearer(a.token));
    expect(voided.body).toMatchObject({ status: 'partially_paid', paidPaise: 118_000 });
    const log = await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'invoice.payment_void' } });
    expect(log).toBe(1);
  });

  it('issued invoices cannot be deleted or edited; cancel keeps the number', async () => {
    const inv = (await h.api().post('/api/v1/invoices').set(bearer(a.token)).send({ accountId: intraAccount, lines: [line()] })).body;
    const issued = (await h.api().post(`/api/v1/invoices/${inv.id}/issue`).set(bearer(a.token)).send({})).body;
    expect((await h.api().delete(`/api/v1/invoices/${inv.id}`).set(bearer(a.token))).status).toBe(409);
    expect((await h.api().patch(`/api/v1/invoices/${inv.id}`).set(bearer(a.token)).send({ notes: 'x' })).status).toBe(409);
    const cancelled = await h.api().post(`/api/v1/invoices/${inv.id}/cancel`).set(bearer(a.token)).send({ reason: 'Wrong GSTIN' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', number: issued.number, cancelReason: 'Wrong GSTIN' });
  });

  it('issuing needs a complete seller profile', async () => {
    const acc = (await h.api().post('/api/v1/accounts').set(bearer(b.token)).send({ name: 'B buyer' })).body;
    const inv = (await h.api().post('/api/v1/invoices').set(bearer(b.token)).send({ accountId: acc.id, lines: [line()] })).body;
    const res = await h.api().post(`/api/v1/invoices/${inv.id}/issue`).set(bearer(b.token)).send({});
    expect(res.body.error.code).toBe('SELLER_PROFILE_INCOMPLETE');
  });
});
