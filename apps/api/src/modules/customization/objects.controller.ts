import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import { API_ROUTES, CustomObjectCreateSchema, CustomObjectUpdateSchema, ObjectKeyParamSchema, type CustomObjectSpec } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ObjectsService, type CustomObjectUpdate } from './objects.service.js';

type KeyParam = { key: string };
const ObjectListQuery = API_ROUTES.objectList.query;

@Controller()
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @ApiRoute(API_ROUTES.objectList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(ObjectListQuery)) query: z.output<typeof ObjectListQuery>) {
    return this.objects.list(auth, query);
  }

  @ApiRoute(API_ROUTES.objectCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CustomObjectCreateSchema)) body: CustomObjectSpec) {
    return this.objects.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.objectGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam) {
    return this.objects.get(auth, key);
  }

  @ApiRoute(API_ROUTES.objectUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam, @Body(new ZodPipe(CustomObjectUpdateSchema)) body: CustomObjectUpdate) {
    return this.objects.update(auth, req, key, body);
  }

  @ApiRoute(API_ROUTES.objectArchive)
  archive(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam) {
    return this.objects.archive(auth, req, key);
  }

  @ApiRoute(API_ROUTES.objectRestore)
  restore(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam) {
    return this.objects.restore(auth, req, key);
  }
}
