import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  FieldDefinitionCreateSchema,
  FieldDefinitionUpdateSchema,
  FieldListQuerySchema,
  FieldReorderSchema,
  IdParamSchema,
  type FieldDefinitionUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { FieldsService } from './fields.service.js';

type IdParam = { id: string };

@Controller()
export class FieldsController {
  constructor(private readonly fields: FieldsService) {}

  @ApiRoute(API_ROUTES.fieldList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(FieldListQuerySchema)) query: z.output<typeof FieldListQuerySchema>) {
    return this.fields.list(auth, query);
  }

  @ApiRoute(API_ROUTES.fieldCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(FieldDefinitionCreateSchema)) body: z.output<typeof FieldDefinitionCreateSchema>) {
    return this.fields.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.fieldReorder)
  reorder(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(FieldReorderSchema)) body: z.output<typeof FieldReorderSchema>) {
    return this.fields.reorder(auth, req, body);
  }

  @ApiRoute(API_ROUTES.fieldUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(FieldDefinitionUpdateSchema)) body: FieldDefinitionUpdate) {
    return this.fields.update(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.fieldArchive)
  archive(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.fields.archive(auth, req, id);
  }

  @ApiRoute(API_ROUTES.fieldRestore)
  restore(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.fields.restore(auth, req, id);
  }
}
