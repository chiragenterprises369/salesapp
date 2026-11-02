import { z } from 'zod';
import {
  DiscountKindSchema,
  GstRateSchema,
  ProductKindSchema,
  ProductUnitSchema,
  type ProductUnit,
} from '../enums.js';
import { CursorPaginationQuerySchema, CustomFieldValuesSchema, IdSchema, IsoDateSchema, IsoDateTimeSchema, PaiseSchema, queryArray, SortDirSchema } from './common.js';

/**
 * PRODUCTS AND PRICE LISTS (change #19 wave B, SPEC 29.9). Money in paise (D-067), prices exclude GST.
 * Goods carry an HSN code (4, 6 or 8 digits), services a SAC code (6 digits starting with 99).
 * A price list overrides the product price for the products it lists; documents resolve a line price as
 * explicit unitPricePaise > price list item > Product.unitPricePaise.
 */

export const PRODUCT_UNIT_LABELS: Record<ProductUnit, string> = {
  NOS: 'Numbers',
  PCS: 'Pieces',
  SET: 'Sets',
  PRS: 'Pairs',
  DOZ: 'Dozens',
  BOX: 'Boxes',
  PAC: 'Packs',
  CTN: 'Cartons',
  BAG: 'Bags',
  BTL: 'Bottles',
  CAN: 'Cans',
  ROL: 'Rolls',
  BDL: 'Bundles',
  KGS: 'Kilograms',
  GMS: 'Grams',
  QTL: 'Quintals',
  TON: 'Tonnes',
  LTR: 'Litres',
  MLT: 'Millilitres',
  KLR: 'Kilolitres',
  MTR: 'Metres',
  CMS: 'Centimetres',
  SQM: 'Square metres',
  SQF: 'Square feet',
  CBM: 'Cubic metres',
  UNT: 'Units',
  OTH: 'Others (hours, days, services)',
};

export const HSN_RE = /^\d{4}(\d{2}){0,2}$/;
export const SAC_RE = /^99\d{4}$/;
export const SKU_RE = /^[A-Za-z0-9._/-]{1,40}$/;

/** HSN for goods (4/6/8 digits, not starting with 99), SAC for services (99xxxx). */
export function hsnSacProblem(kind: 'goods' | 'service', code: string): string | null {
  if (kind === 'service') return SAC_RE.test(code) ? null : 'A SAC code has 6 digits and starts with 99';
  if (!HSN_RE.test(code)) return 'An HSN code has 4, 6 or 8 digits';
  return code.startsWith('99') ? 'Codes starting with 99 are SAC codes for services' : null;
}

export const ProductSummarySchema = z.object({
  id: IdSchema,
  sku: z.string(),
  name: z.string(),
  hsnSac: z.string(),
  unit: ProductUnitSchema,
  gstRate: GstRateSchema,
  unitPricePaise: PaiseSchema,
  active: z.boolean(),
});
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

export const ProductSchema = ProductSummarySchema.extend({
  description: z.string().nullable(),
  kind: ProductKindSchema,
  customFields: CustomFieldValuesSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Product = z.infer<typeof ProductSchema>;

const ProductInputFields = z.object({
  sku: z.string().trim().regex(SKU_RE, { error: 'Use 1-40 letters, digits, ".", "_", "/" or "-"' }),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable(),
  kind: ProductKindSchema,
  hsnSac: z.string().trim().regex(/^\d{4,8}$/),
  unit: ProductUnitSchema,
  gstRate: GstRateSchema,
  unitPricePaise: PaiseSchema,
  active: z.boolean(),
  customFields: CustomFieldValuesSchema,
});

export const ProductCreateSchema = ProductInputFields.extend({
  description: z.string().trim().max(2000).nullable().default(null),
  kind: ProductKindSchema.default('goods'),
  unit: ProductUnitSchema.default('NOS'),
  active: z.boolean().default(true),
  customFields: CustomFieldValuesSchema.default({}),
}).superRefine((p, ctx) => {
  const problem = hsnSacProblem(p.kind, p.hsnSac);
  if (problem) ctx.addIssue({ code: 'custom', path: ['hsnSac'], message: problem });
});
export type ProductCreate = z.infer<typeof ProductCreateSchema>;

/** kind + hsnSac are re-validated together by the server against the stored values. */
export const ProductUpdateSchema = ProductInputFields.partial().extend({ expectedUpdatedAt: IsoDateTimeSchema.optional() });
export type ProductUpdate = z.infer<typeof ProductUpdateSchema>;

export const PRODUCT_SORT_FIELDS = ['name', 'sku', 'unitPricePaise', 'createdAt', 'updatedAt'] as const;
export const ProductListQuerySchema = CursorPaginationQuerySchema.extend({
  q: z.string().trim().max(200).optional().describe('Name, SKU or HSN/SAC'),
  active: z.stringbool().optional(),
  kind: ProductKindSchema.optional(),
  gstRate: queryArray(z.coerce.number().pipe(GstRateSchema)),
  sort: z.enum(PRODUCT_SORT_FIELDS).default('name'),
  dir: SortDirSchema.default('asc'),
});
export type ProductListQuery = z.infer<typeof ProductListQuerySchema>;

// ---------------------------------------------------------------- price lists

export const PriceListItemSchema = z.object({
  productId: IdSchema,
  product: ProductSummarySchema,
  unitPricePaise: PaiseSchema,
});
export type PriceListItem = z.infer<typeof PriceListItemSchema>;

export const PriceListSchema = z.object({
  id: IdSchema,
  name: z.string(),
  description: z.string().nullable(),
  /** The default list is preselected in new quotations and invoices (at most one per workspace). */
  isDefault: z.boolean(),
  active: z.boolean(),
  validFrom: IsoDateSchema.nullable(),
  validTo: IsoDateSchema.nullable(),
  itemCount: z.number().int(),
  /** Present on GET /price-lists/{id} (and after create/update); omitted in lists. */
  items: z.array(PriceListItemSchema).optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PriceList = z.infer<typeof PriceListSchema>;

const PriceListInputFields = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable(),
  isDefault: z.boolean(),
  active: z.boolean(),
  validFrom: IsoDateSchema.nullable(),
  validTo: IsoDateSchema.nullable(),
  /** Replaces all items when present. */
  items: z.array(z.object({ productId: IdSchema, unitPricePaise: PaiseSchema })).max(2000),
});

export const PriceListCreateSchema = PriceListInputFields.extend({
  description: z.string().trim().max(500).nullable().default(null),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
  validFrom: IsoDateSchema.nullable().default(null),
  validTo: IsoDateSchema.nullable().default(null),
  items: z.array(z.object({ productId: IdSchema, unitPricePaise: PaiseSchema })).max(2000).default([]),
});
export type PriceListCreate = z.infer<typeof PriceListCreateSchema>;
export const PriceListUpdateSchema = PriceListInputFields.partial();
export type PriceListUpdate = z.infer<typeof PriceListUpdateSchema>;

/** Effective unit price of a product (explicit > price list item > product price). */
export function resolveUnitPrice(product: { id: string; unitPricePaise: number }, priceList?: { items?: ReadonlyArray<{ productId: string; unitPricePaise: number }> } | null): number {
  return priceList?.items?.find((i) => i.productId === product.id)?.unitPricePaise ?? product.unitPricePaise;
}

// ---------------------------------------------------------------- line items (deals, quotations, invoices)

/**
 * One line of a deal, quotation or invoice. With `productId` the server fills missing name, HSN/SAC,
 * unit, GST rate and price from the product (and the document's price list); without it, `name`,
 * `hsnSac` and `gstRate` are required. Quantity keeps 3 decimals.
 */
export const LineItemInputSchema = z
  .object({
    productId: IdSchema.nullable().optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    hsnSac: z.string().trim().regex(/^\d{4,8}$/).nullable().optional(),
    unit: ProductUnitSchema.optional(),
    quantity: z.number().positive().max(1_000_000),
    unitPricePaise: PaiseSchema.optional(),
    discountKind: DiscountKindSchema.default('percent'),
    discountValue: z.number().min(0).default(0),
    gstRate: GstRateSchema.optional(),
  })
  .superRefine((l, ctx) => {
    if (!l.productId) {
      if (!l.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter an item name or pick a product' });
      if (l.gstRate === undefined) ctx.addIssue({ code: 'custom', path: ['gstRate'], message: 'Pick a GST rate' });
      if (l.unitPricePaise === undefined) ctx.addIssue({ code: 'custom', path: ['unitPricePaise'], message: 'Enter a price' });
    }
    if (l.discountKind === 'percent' && l.discountValue > 100) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'A discount is at most 100%' });
    if (l.discountKind === 'amount' && !Number.isInteger(l.discountValue)) ctx.addIssue({ code: 'custom', path: ['discountValue'], message: 'Amount discounts are whole paise' });
  });
export type LineItemInput = z.infer<typeof LineItemInputSchema>;

/** A stored line with its computed amounts (computeLine() in gst.ts). */
export const LineItemSchema = z.object({
  id: IdSchema,
  position: z.number().int(),
  productId: IdSchema.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  hsnSac: z.string().nullable(),
  unit: ProductUnitSchema,
  quantity: z.number(),
  unitPricePaise: PaiseSchema,
  discountKind: DiscountKindSchema,
  discountValue: z.number(),
  gstRate: GstRateSchema,
  grossPaise: PaiseSchema,
  discountPaise: PaiseSchema,
  taxablePaise: PaiseSchema,
  cgstPaise: PaiseSchema,
  sgstPaise: PaiseSchema,
  igstPaise: PaiseSchema,
  totalPaise: PaiseSchema,
});
export type LineItem = z.infer<typeof LineItemSchema>;
