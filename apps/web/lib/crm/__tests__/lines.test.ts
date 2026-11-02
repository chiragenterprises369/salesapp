import { describe, expect, it } from 'vitest';
import { emptyLine, linesProblems, mapLineErrors, previewTotals, toLineInputs, type LineDraft } from '../lines';

const line = (patch: Partial<LineDraft>): LineDraft => ({ ...emptyLine(), name: 'Steel rack', hsnSac: '940320', quantity: '2', unitPrice: '1000', ...patch });

describe('document line drafts', () => {
  it('splits GST into CGST and SGST inside the seller state', () => {
    const { totals } = previewTotals([line({ gstRate: 18 })], '27', '27');
    expect(totals.taxMode).toBe('intra');
    expect(totals.taxablePaise).toBe(200_000);
    expect(totals.cgstPaise).toBe(18_000);
    expect(totals.sgstPaise).toBe(18_000);
    expect(totals.igstPaise).toBe(0);
    expect(totals.totalPaise).toBe(236_000);
  });

  it('charges IGST for another state (inter-state supply)', () => {
    const { totals } = previewTotals([line({ gstRate: 18 }), line({ name: 'Bolts', hsnSac: '7318', quantity: '3', unitPrice: '33.33', gstRate: 12, discount: '10' })], '27', '29');
    expect(totals.taxMode).toBe('inter');
    expect(totals.cgstPaise + totals.sgstPaise).toBe(0);
    // 2 x 1000 = 2000.00; 3 x 33.33 = 99.99 - 10% (10.00) = 89.99
    expect(totals.taxablePaise).toBe(200_000 + 8_999);
    expect(totals.igstPaise).toBe(36_000 + Math.round(8_999 * 0.12));
    expect(Math.abs(totals.roundOffPaise)).toBeLessThanOrEqual(50);
    expect(totals.totalPaise % 100).toBe(0);
    expect(totals.amountInWords.startsWith('Rupees')).toBe(true);
  });

  it('charges no GST when the seller is not GST registered (no GSTIN), like the API', () => {
    const { totals } = previewTotals([line({ gstRate: 18 })], '27', '29', { gstRegistered: false });
    expect(totals.taxPaise).toBe(0);
    expect(totals.totalPaise).toBe(200_000);
  });

  it('ignores blank rows and validates the rest', () => {
    const lines = [line({}), emptyLine(), line({ quantity: '0', unitPrice: 'abc', discount: '120', hsnSac: '12' })];
    expect(toLineInputs(lines)).toHaveLength(2);
    const errors = linesProblems(lines);
    expect(Object.keys(errors).sort()).toEqual(['lines.2.discountValue', 'lines.2.hsnSac', 'lines.2.quantity', 'lines.2.unitPricePaise']);
  });

  it('converts rupees to paise and amount discounts to paise', () => {
    const [input] = toLineInputs([line({ unitPrice: '1,250.50', discountKind: 'amount', discount: '50' })]);
    expect(input).toMatchObject({ unitPricePaise: 125_050, discountKind: 'amount', discountValue: 5_000, quantity: 2 });
  });

  it('re-keys server line errors to the draft rows', () => {
    const lines = [emptyLine(), line({}), line({ name: 'Second' })];
    expect(mapLineErrors({ 'lines.1.gstRate': 'Pick a GST rate', buyer: 'x' }, lines)).toEqual({ 'lines.2.gstRate': 'Pick a GST rate', buyer: 'x' });
  });
});
