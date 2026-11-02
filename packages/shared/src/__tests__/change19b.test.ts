import { describe, expect, it } from 'vitest';
import {
  amountInWordsInr,
  API_ROUTES,
  CaptureFormCreateSchema,
  computeDocument,
  computeLine,
  DEFAULT_ROLE_PERMISSIONS,
  expandOccurrences,
  financialYearOf,
  formatDocumentNumber,
  formatPaise,
  gstinCheckChar,
  isValidGstin,
  LineItemInputSchema,
  nextRoundRobin,
  numberToIndianWords,
  PERMISSIONS,
  routingConditionMisses,
  RoutingConditionsSchema,
  RoutingLeadFactsSchema,
  stateCodeFromGstin,
  taxModeFor,
  type RouteDef,
} from '../index.js';

const gstin = (state: string, pan = 'AABCV1234F') => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;

describe('GST maths (gst.ts)', () => {
  const line = { quantity: 2, unitPricePaise: 100_000, discountKind: 'percent' as const, discountValue: 0, gstRate: 18 };

  it('intra-state splits CGST and SGST equally; inter-state charges IGST', () => {
    expect(computeLine(line, 'intra')).toMatchObject({ taxablePaise: 200_000, cgstPaise: 18_000, sgstPaise: 18_000, igstPaise: 0, totalPaise: 236_000 });
    expect(computeLine(line, 'inter')).toMatchObject({ taxablePaise: 200_000, cgstPaise: 0, sgstPaise: 0, igstPaise: 36_000, totalPaise: 236_000 });
  });

  it('decides the tax mode from the state codes (unknown place of supply = intra)', () => {
    expect(taxModeFor('27', '27')).toBe('intra');
    expect(taxModeFor('27', '29')).toBe('inter');
    expect(taxModeFor('27', null)).toBe('intra');
  });

  it('percent and amount discounts never go below zero', () => {
    expect(computeLine({ ...line, discountKind: 'percent', discountValue: 10 }, 'intra').taxablePaise).toBe(180_000);
    expect(computeLine({ ...line, discountKind: 'amount', discountValue: 500_000 }, 'intra').taxablePaise).toBe(0);
  });

  it('5% intra-state rounds each half separately and the total to the rupee', () => {
    const { lines, totals } = computeDocument([{ ...line, quantity: 3, unitPricePaise: 33_333, gstRate: 5 }], { sellerStateCode: '27', placeOfSupplyStateCode: '27' });
    expect(lines[0]).toMatchObject({ taxablePaise: 99_999, cgstPaise: 2_500, sgstPaise: 2_500 });
    expect(totals).toMatchObject({ totalPaise: 105_000, roundOffPaise: 1, taxPaise: 5_000 });
  });

  it('round-off can be negative and stays within 50 paise', () => {
    const { totals } = computeDocument([{ ...line, quantity: 1, unitPricePaise: 10_020, gstRate: 0 }], { sellerStateCode: '27', placeOfSupplyStateCode: '29' });
    expect(totals.totalPaise).toBe(10_000);
    expect(totals.roundOffPaise).toBe(-20);
    for (let p = 0; p < 300; p += 7) {
      const t = computeDocument([{ ...line, quantity: 1, unitPricePaise: 10_000 + p, gstRate: 12 }], { sellerStateCode: '27', placeOfSupplyStateCode: '27' }).totals;
      expect(Math.abs(t.roundOffPaise)).toBeLessThanOrEqual(50);
      expect(t.totalPaise % 100).toBe(0);
    }
  });

  it('groups the HSN summary by code and rate', () => {
    const { totals } = computeDocument(
      [
        { ...line, hsnSac: '8471', gstRate: 18 },
        { ...line, hsnSac: '8471', gstRate: 18 },
        { ...line, hsnSac: '998713', gstRate: 18 },
        { ...line, hsnSac: '1006', gstRate: 5 },
      ],
      { sellerStateCode: '27', placeOfSupplyStateCode: '24' },
    );
    expect(totals.taxSummary).toHaveLength(3);
    expect(totals.taxSummary.find((r) => r.hsnSac === '8471')).toMatchObject({ taxablePaise: 400_000, igstPaise: 72_000 });
  });

  it('amount in words uses the Indian numbering system', () => {
    expect(numberToIndianWords(0)).toBe('Zero');
    expect(numberToIndianWords(1_05_000)).toBe('One Lakh Five Thousand');
    expect(numberToIndianWords(12_34_56_789)).toBe('Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine');
    expect(amountInWordsInr(12_345_650)).toBe('Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Fifty Paise Only');
    expect(amountInWordsInr(236_000)).toBe('Rupees Two Thousand Three Hundred Sixty Only');
  });

  it('formats paise and document numbers', () => {
    expect(formatPaise(12_345_650)).toBe('₹1,23,456.50');
    expect(financialYearOf('2026-04-01')).toBe('2026-27');
    expect(financialYearOf('2027-03-31')).toBe('2026-27');
    expect(financialYearOf('2026-03-31')).toBe('2025-26');
    expect(formatDocumentNumber('INV', '2026-27', 7)).toBe('INV/2026-27/0007');
    expect(formatDocumentNumber('INV', '2026-27', 7).length).toBeLessThanOrEqual(16);
  });
});

describe('GSTIN, lines, routing, capture, calendar', () => {
  it('validates the GSTIN check digit and state', () => {
    const g = gstin('27');
    expect(isValidGstin(g)).toBe(true);
    expect(isValidGstin(g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A'))).toBe(false);
    expect(isValidGstin(gstin('99'))).toBe(false);
    expect(stateCodeFromGstin(g)).toBe('27');
  });

  it('line inputs need name, rate and price unless a product is given', () => {
    expect(LineItemInputSchema.safeParse({ quantity: 1 }).success).toBe(false);
    expect(LineItemInputSchema.safeParse({ productId: '0190f5a0-0000-7000-8000-000000000001', quantity: 1 }).success).toBe(true);
    expect(LineItemInputSchema.safeParse({ name: 'x', quantity: 1, unitPricePaise: 100, gstRate: 7 }).success).toBe(false);
  });

  it('round robin picks the next eligible user and wraps around', () => {
    const pool = ['a', 'b', 'c'];
    expect(nextRoundRobin(pool, new Set(pool), null)).toBe('a');
    expect(nextRoundRobin(pool, new Set(pool), 'a')).toBe('b');
    expect(nextRoundRobin(pool, new Set(pool), 'c')).toBe('a');
    expect(nextRoundRobin(pool, new Set(['a', 'c']), 'a')).toBe('c');
    expect(nextRoundRobin(pool, new Set(), 'a')).toBeNull();
    // fairness: 30 picks over 3 users -> 10 each
    let last: string | null = null;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      last = nextRoundRobin(pool, new Set(pool), last);
      counts[last!] = (counts[last!] ?? 0) + 1;
    }
    expect(counts).toEqual({ a: 10, b: 10, c: 10 });
  });

  it('routing conditions: empty = any; text matches ignore case', () => {
    const facts = RoutingLeadFactsSchema.parse({ source: 'indiamart', city: 'pune', productInterest: 'Solar panel 540W', valueInr: 80_000 });
    expect(routingConditionMisses(RoutingConditionsSchema.parse({}), facts)).toEqual([]);
    expect(routingConditionMisses(RoutingConditionsSchema.parse({ sources: ['indiamart'], cities: ['Pune'], productKeywords: ['solar'] }), facts)).toEqual([]);
    expect(routingConditionMisses(RoutingConditionsSchema.parse({ minValueInr: 100_000, sources: ['website'] }), facts)).toEqual(['source', 'value']);
  });

  it('capture forms must map the name and a phone or email', () => {
    const base = { name: 'F', fields: [{ id: 'n', label: 'Name', type: 'text', mapTo: 'name' }] };
    expect(CaptureFormCreateSchema.safeParse(base).success).toBe(false);
    expect(CaptureFormCreateSchema.safeParse({ ...base, fields: [...base.fields, { id: 'p', label: 'Phone', type: 'phone', mapTo: 'phone' }] }).success).toBe(true);
  });

  it('expands weekly and monthly recurrences with counts and exceptions', () => {
    const start = Date.parse('2026-11-02T04:30:00Z'); // Monday 10:00 IST
    const hour = 3_600_000;
    const weekly = expandOccurrences({ startAt: start, durationMs: hour, recurrence: { freq: 'weekly', interval: 1, byWeekday: ['mon', 'thu'], count: 4 } }, start, start + 30 * 86_400_000);
    expect(weekly.map((t) => new Date(t).toISOString())).toEqual(['2026-11-02T04:30:00.000Z', '2026-11-05T04:30:00.000Z', '2026-11-09T04:30:00.000Z', '2026-11-12T04:30:00.000Z']);
    const skipped = expandOccurrences({ startAt: start, durationMs: hour, recurrence: { freq: 'daily', interval: 1, count: 3 }, exceptionDates: ['2026-11-03'] }, start, start + 10 * 86_400_000);
    expect(skipped).toHaveLength(2);
    const monthly = expandOccurrences({ startAt: Date.parse('2026-01-31T04:30:00Z'), durationMs: hour, recurrence: { freq: 'monthly', interval: 1, count: 3 } }, 0, Date.parse('2026-12-31T00:00:00Z'));
    expect(monthly.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
});

describe('route contract (change #19 wave B)', () => {
  const routes = Object.entries(API_ROUTES) as Array<[string, RouteDef]>;
  const ids = Object.keys(API_ROUTES);
  const wave = routes.slice(ids.indexOf('contactList'));

  it('98 routes owned by backend-core in phase 19, every permission exists', () => {
    expect(wave).toHaveLength(98);
    for (const [id, r] of wave) {
      expect(r.owner, id).toBe('backend-core');
      expect(r.phase, id).toBe(19);
      if (r.permission) expect(PERMISSIONS as readonly string[], id).toContain(r.permission);
      expect(r.response !== null || !!r.responseContentType, id).toBe(true);
    }
  });

  it('system roles: managers cannot delete invoices, viewers only read', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain('invoices.delete');
    expect(DEFAULT_ROLE_PERMISSIONS.viewer.every((p) => p.endsWith('.read'))).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.company_admin).toEqual(expect.arrayContaining(['routing.manage', 'capture_forms.manage', 'invoices.payments']));
  });
});
