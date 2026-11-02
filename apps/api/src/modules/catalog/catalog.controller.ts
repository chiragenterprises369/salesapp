import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  IdParamSchema,
  PriceListCreateSchema,
  PriceListUpdateSchema,
  ProductCreateSchema,
  ProductListQuerySchema,
  ProductUpdateSchema,
  type PriceListCreate,
  type PriceListUpdate,
  type ProductCreate,
  type ProductListQuery,
  type ProductUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { CatalogService } from './catalog.service.js';

type IdParam = { id: string };

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @ApiRoute(API_ROUTES.productList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(ProductListQuerySchema)) q: ProductListQuery) {
    return this.catalog.list(auth, q);
  }

  @ApiRoute(API_ROUTES.productCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ProductCreateSchema)) body: ProductCreate) {
    return this.catalog.create(auth, body);
  }

  @ApiRoute(API_ROUTES.productGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.catalog.get(auth, id);
  }

  @ApiRoute(API_ROUTES.productUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(ProductUpdateSchema)) body: ProductUpdate) {
    return this.catalog.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.productDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.catalog.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.priceListList)
  priceLists(@CurrentAuth() auth: AuthContext) {
    return this.catalog.priceLists(auth);
  }

  @ApiRoute(API_ROUTES.priceListCreate)
  createPriceList(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(PriceListCreateSchema)) body: PriceListCreate) {
    return this.catalog.createPriceList(auth, body);
  }

  @ApiRoute(API_ROUTES.priceListGet)
  priceList(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.catalog.priceList(auth, id);
  }

  @ApiRoute(API_ROUTES.priceListUpdate)
  updatePriceList(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PriceListUpdateSchema)) body: PriceListUpdate) {
    return this.catalog.updatePriceList(auth, id, body);
  }

  @ApiRoute(API_ROUTES.priceListDelete)
  removePriceList(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.catalog.removePriceList(auth, id);
  }
}
