import { computeDocument, roundQuantity, type GstLineAmounts, type GstRate, type GstTotals, type LineItemInput, type ProductUnit } from '@vistar/shared';
import { AppException } from '../../common/errors/app-exception.js';
import type { TenantDb } from '../leads/lib/context.js';
import { num } from '../crm/lib/values.js';

/** A line after product and price-list lookup: every field the GST maths and the line rows need. */
export interface ResolvedLine {
  position: number;
  productId: string | null;
  name: string;
  description: string | null;
  hsnSac: string | null;
  unit: ProductUnit;
  quantity: number;
  unitPricePaise: number;
  discountKind: 'percent' | 'amount';
  discountValue: number;
  gstRate: GstRate;
}

export type ComputedLine = ResolvedLine & GstLineAmounts;

/**
 * Fill product data into line inputs: explicit values win, then the price list item, then the product.
 * Unknown or other-tenant product ids answer 404 (the tenant client never sees them).
 */
export async function resolveLines(db: TenantDb, inputs: readonly LineItemInput[], priceListId?: string | null): Promise<ResolvedLine[]> {
  const ids = [...new Set(inputs.map((l) => l.productId).filter((id): id is string => !!id))];
  const products = ids.length ? await db.product.findMany({ where: { id: { in: ids } } }) : [];
  if (products.length !== ids.length) throw new AppException('NOT_FOUND', 'One of the products was not found', { details: [{ path: 'lines', message: 'Unknown product' }] });
  const byId = new Map(products.map((p) => [p.id, p]));
  const listPrices = new Map<string, number>();
  if (priceListId && ids.length) {
    const items = await db.priceListItem.findMany({ where: { priceListId, productId: { in: ids } } });
    for (const i of items) listPrices.set(i.productId, num(i.unitPricePaise));
  }
  return inputs.map((l, position) => {
    const p = l.productId ? byId.get(l.productId) : undefined;
    const name = l.name ?? p?.name;
    const gstRate = (l.gstRate ?? p?.gstRate) as GstRate | undefined;
    const unitPricePaise = l.unitPricePaise ?? (p ? (listPrices.get(p.id) ?? num(p.unitPricePaise)) : undefined);
    if (!name || gstRate === undefined || unitPricePaise === undefined) {
      throw new AppException('VALIDATION_FAILED', 'Each line needs a name, a GST rate and a price', { details: [{ path: `lines.${position}`, message: 'Incomplete line' }] });
    }
    return {
      position,
      productId: p?.id ?? null,
      name,
      description: l.description ?? p?.description ?? null,
      hsnSac: l.hsnSac ?? p?.hsnSac ?? null,
      unit: (l.unit ?? p?.unit ?? 'NOS') as ProductUnit,
      quantity: roundQuantity(l.quantity),
      unitPricePaise,
      discountKind: l.discountKind,
      discountValue: l.discountKind === 'amount' ? Math.round(l.discountValue) : Math.round(l.discountValue * 100) / 100,
      gstRate,
    };
  });
}

/** GST maths of resolved lines (gst.ts, the same code the web preview runs). */
export function computeLines(lines: readonly ResolvedLine[], sellerStateCode: string | null, placeOfSupplyStateCode: string | null): { lines: ComputedLine[]; totals: GstTotals } {
  return computeDocument(lines, { sellerStateCode, placeOfSupplyStateCode });
}

/** Rows for a *Line table (BigInt money, Decimal quantity/discount as strings). */
export function lineRow(workspaceId: string, l: ComputedLine) {
  return {
    workspaceId,
    position: l.position,
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit,
    quantity: String(l.quantity),
    unitPricePaise: BigInt(l.unitPricePaise),
    discountKind: l.discountKind,
    discountValue: String(l.discountValue),
    gstRate: l.gstRate,
    grossPaise: BigInt(l.grossPaise),
    discountPaise: BigInt(l.discountPaise),
    taxablePaise: BigInt(l.taxablePaise),
    cgstPaise: BigInt(l.cgstPaise),
    sgstPaise: BigInt(l.sgstPaise),
    igstPaise: BigInt(l.igstPaise),
    totalPaise: BigInt(l.totalPaise),
  };
}
