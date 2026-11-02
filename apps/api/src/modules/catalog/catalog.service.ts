import { Injectable, Logger } from '@nestjs/common';
import {
  hsnSacProblem,
  type Page,
  type PriceList,
  type PriceListCreate,
  type PriceListUpdate,
  type Product,
  type ProductCreate,
  type ProductListQuery,
  type ProductSummary,
  type ProductUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { Prisma, Product as ProductRow } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { changedKeys } from '../customization/custom-values.js';
import { isUniqueViolation, sortBy } from '../crm/lib/db.js';
import { and, pageArgs, pageOut } from '../crm/lib/paging.js';
import { dateOnly, num, parseCustom, toDateCol } from '../crm/lib/values.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';

export function toProductSummary(p: ProductRow): ProductSummary {
  return { id: p.id, sku: p.sku, name: p.name, hsnSac: p.hsnSac, unit: p.unit as ProductSummary['unit'], gstRate: p.gstRate as ProductSummary['gstRate'], unitPricePaise: num(p.unitPricePaise), active: p.active };
}

export function toProduct(p: ProductRow): Product {
  return {
    ...toProductSummary(p),
    description: p.description,
    kind: p.kind === 'service' ? 'service' : 'goods',
    customFields: parseCustom(p.customFields),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const PRICE_LIST_INCLUDE = { _count: { select: { items: true } } } as const satisfies Prisma.PriceListInclude;
type PriceListRow = Prisma.PriceListGetPayload<{ include: typeof PRICE_LIST_INCLUDE }>;

const skuTaken = () => new AppException('PRODUCT_SKU_TAKEN', 'Another product already uses this SKU', { details: [{ path: 'sku', message: 'Already used' }] });

/**
 * Products and price lists (SPEC 29.9). Money in paise, prices exclude GST. Products are company-wide
 * (no data scope); `products.read` reads, `products.manage` writes. Custom field target `product` is not
 * part of the flexible data layer yet, so `customFields` is stored as given after a plain shape check.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  private async changed(auth: AuthContext, scope: 'products' | 'price_lists', ids: string[]): Promise<void> {
    const actor = await requestActor(this.prisma.forTenant(auth.workspaceId), auth);
    await publishSafe(this.events, this.logger, 'catalog.changed', auth.workspaceId, { scope, ids }, { actor: actor.event });
  }

  // ---------------------------------------------------------------- products

  async list(auth: AuthContext, q: ProductListQuery): Promise<Page<Product> & { total: number }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const text = q.q?.trim();
    const where = and<Prisma.ProductWhereInput>(
      q.active !== undefined ? { active: q.active } : null,
      q.kind ? { kind: q.kind } : null,
      q.gstRate?.length ? { gstRate: { in: q.gstRate } } : null,
      text ? { OR: [{ name: { contains: text, mode: 'insensitive' } }, { sku: { contains: text, mode: 'insensitive' } }, { hsnSac: { startsWith: text } }] } : null,
    );
    const { skip, take } = pageArgs(q.cursor, q.limit);
    const [rows, total] = await Promise.all([db.product.findMany({ where, orderBy: sortBy<Prisma.ProductOrderByWithRelationInput[]>(q.sort, q.dir), skip, take }), db.product.count({ where })]);
    const page = pageOut(rows, skip, q.limit);
    return { items: page.rows.map(toProduct), nextCursor: page.nextCursor, total };
  }

  async get(auth: AuthContext, id: string): Promise<Product> {
    const p = await this.prisma.forTenant(auth.workspaceId).product.findFirst({ where: { id } });
    if (!p) throw notFound('Product');
    return toProduct(p);
  }

  async create(auth: AuthContext, body: ProductCreate): Promise<Product> {
    const db = this.prisma.forTenant(auth.workspaceId);
    if (await db.product.count({ where: { sku: { equals: body.sku, mode: 'insensitive' } } })) throw skuTaken();
    try {
      const p = await db.product.create({
        data: {
          workspaceId: auth.workspaceId,
          sku: body.sku,
          name: body.name,
          description: body.description,
          kind: body.kind,
          hsnSac: body.hsnSac,
          unit: body.unit,
          gstRate: body.gstRate,
          unitPricePaise: BigInt(body.unitPricePaise),
          active: body.active,
          customFields: body.customFields as Prisma.InputJsonObject,
        },
      });
      await this.changed(auth, 'products', [p.id]);
      return toProduct(p);
    } catch (err) {
      if (isUniqueViolation(err)) throw skuTaken();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, body: ProductUpdate): Promise<Product> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const current = await db.product.findFirst({ where: { id } });
    if (!current) throw notFound('Product');
    if (body.expectedUpdatedAt && Date.parse(body.expectedUpdatedAt) !== current.updatedAt.getTime()) {
      throw new AppException('VERSION_CONFLICT', 'Someone else changed this product. Reload to see the latest version.');
    }
    const kind = body.kind ?? (current.kind === 'service' ? 'service' : 'goods');
    const code = body.hsnSac ?? current.hsnSac;
    const problem = hsnSacProblem(kind, code);
    if (problem && (body.kind !== undefined || body.hsnSac !== undefined)) throw new AppException('VALIDATION_FAILED', problem, { details: [{ path: 'hsnSac', message: problem }], status: 422 });
    if (body.sku && body.sku.toLowerCase() !== current.sku.toLowerCase() && (await db.product.count({ where: { sku: { equals: body.sku, mode: 'insensitive' }, id: { not: id } } }))) throw skuTaken();
    let customFields: Prisma.InputJsonObject | undefined;
    if (body.customFields !== undefined) {
      const prev = parseCustom(current.customFields);
      const next = { ...prev, ...body.customFields };
      if (changedKeys(prev, next).length) customFields = next as Prisma.InputJsonObject;
    }
    try {
      const p = await db.product.update({
        where: { id },
        data: {
          ...(body.sku !== undefined ? { sku: body.sku } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.hsnSac !== undefined ? { hsnSac: body.hsnSac } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.gstRate !== undefined ? { gstRate: body.gstRate } : {}),
          ...(body.unitPricePaise !== undefined ? { unitPricePaise: BigInt(body.unitPricePaise) } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(customFields ? { customFields } : {}),
        },
      });
      await this.changed(auth, 'products', [id]);
      return toProduct(p);
    } catch (err) {
      if (isUniqueViolation(err)) throw skuTaken();
      throw err;
    }
  }

  /** Hard delete: document and deal lines keep their snapshot (productId set null), price list items go. */
  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const p = await db.product.findFirst({ where: { id } });
    if (!p) throw notFound('Product');
    await db.product.deleteMany({ where: { id } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'product.delete', entityType: 'product', entityId: id, diff: { sku: p.sku, name: p.name } }, actor.summary?.name);
    await this.changed(auth, 'products', [id]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- price lists

  private toPriceList(row: PriceListRow, items?: Array<{ productId: string; unitPricePaise: bigint; product: ProductRow }>): PriceList {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isDefault: row.isDefault,
      active: row.active,
      validFrom: dateOnly(row.validFrom),
      validTo: dateOnly(row.validTo),
      itemCount: row._count.items,
      ...(items ? { items: items.map((i) => ({ productId: i.productId, product: toProductSummary(i.product), unitPricePaise: num(i.unitPricePaise) })) } : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadPriceList(db: TenantDb, id: string): Promise<PriceList> {
    const row = await db.priceList.findFirst({ where: { id }, include: PRICE_LIST_INCLUDE });
    if (!row) throw notFound('Price list');
    const items = await db.priceListItem.findMany({ where: { priceListId: id }, include: { product: true }, orderBy: { product: { name: 'asc' } } });
    return this.toPriceList(row, items);
  }

  async priceLists(auth: AuthContext): Promise<{ items: PriceList[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).priceList.findMany({ include: PRICE_LIST_INCLUDE, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    return { items: rows.map((r) => this.toPriceList(r)) };
  }

  async priceList(auth: AuthContext, id: string): Promise<PriceList> {
    return this.loadPriceList(this.prisma.forTenant(auth.workspaceId), id);
  }

  private async checkItems(db: TenantDb, items: ReadonlyArray<{ productId: string }>): Promise<void> {
    const ids = [...new Set(items.map((i) => i.productId))];
    if (ids.length !== items.length) throw new AppException('VALIDATION_FAILED', 'A product is listed twice', { details: [{ path: 'items', message: 'Duplicate product' }] });
    if (ids.length && (await db.product.count({ where: { id: { in: ids } } })) !== ids.length) throw notFound('Product');
  }

  async createPriceList(auth: AuthContext, body: PriceListCreate): Promise<PriceList> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await this.checkItems(db, body.items);
    if (body.validFrom && body.validTo && body.validTo < body.validFrom) throw new AppException('VALIDATION_FAILED', 'The end date is before the start date', { details: [{ path: 'validTo', message: 'Before validFrom' }] });
    try {
      const id = await db.$transaction(async (tx) => {
        if (body.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        const row = await tx.priceList.create({
          data: { workspaceId: wid, name: body.name, description: body.description, isDefault: body.isDefault, active: body.active, validFrom: body.validFrom ? toDateCol(body.validFrom) : null, validTo: body.validTo ? toDateCol(body.validTo) : null },
          select: { id: true },
        });
        if (body.items.length) await tx.priceListItem.createMany({ data: body.items.map((i) => ({ workspaceId: wid, priceListId: row.id, productId: i.productId, unitPricePaise: BigInt(i.unitPricePaise) })) });
        return row.id;
      });
      await this.changed(auth, 'price_lists', [id]);
      return this.loadPriceList(db, id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppException('CONFLICT', 'A price list with this name already exists');
      throw err;
    }
  }

  async updatePriceList(auth: AuthContext, id: string, body: PriceListUpdate): Promise<PriceList> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await db.priceList.findFirst({ where: { id } });
    if (!current) throw notFound('Price list');
    if (body.items) await this.checkItems(db, body.items);
    try {
      await db.$transaction(async (tx) => {
        if (body.isDefault) await tx.priceList.updateMany({ where: { isDefault: true, id: { not: id } }, data: { isDefault: false } });
        await tx.priceList.update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.validFrom !== undefined ? { validFrom: body.validFrom ? toDateCol(body.validFrom) : null } : {}),
            ...(body.validTo !== undefined ? { validTo: body.validTo ? toDateCol(body.validTo) : null } : {}),
          },
        });
        if (body.items) {
          await tx.priceListItem.deleteMany({ where: { priceListId: id } });
          if (body.items.length) await tx.priceListItem.createMany({ data: body.items.map((i) => ({ workspaceId: wid, priceListId: id, productId: i.productId, unitPricePaise: BigInt(i.unitPricePaise) })) });
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppException('CONFLICT', 'A price list with this name already exists');
      throw err;
    }
    await this.changed(auth, 'price_lists', [id]);
    return this.loadPriceList(db, id);
  }

  async removePriceList(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const res = await db.priceList.deleteMany({ where: { id } });
    if (res.count !== 1) throw notFound('Price list');
    await this.changed(auth, 'price_lists', [id]);
    return { ok: true };
  }
}
