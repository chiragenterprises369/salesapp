import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import { API_ROUTES, PackInstallRequestSchema, PackKeyParamSchema, PackPlanQuerySchema, type PackInstallRequest } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PacksService } from './packs.service.js';

type KeyParam = { key: string };

@Controller()
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @ApiRoute(API_ROUTES.packList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.packs.list(auth);
  }

  @ApiRoute(API_ROUTES.packRuntime)
  runtime(@CurrentAuth() auth: AuthContext) {
    return this.packs.runtime(auth);
  }

  @ApiRoute(API_ROUTES.packPlan)
  plan(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam, @Query(new ZodPipe(PackPlanQuerySchema)) query: z.output<typeof PackPlanQuerySchema>) {
    return this.packs.plan(auth, key, query);
  }

  @ApiRoute(API_ROUTES.packInstall)
  install(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam, @Body(new ZodPipe(PackInstallRequestSchema)) body: PackInstallRequest) {
    return this.packs.install(auth, req, key, body);
  }

  @ApiRoute(API_ROUTES.packUpgrade)
  upgrade(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam) {
    return this.packs.upgrade(auth, req, key);
  }

  @ApiRoute(API_ROUTES.packUninstall)
  uninstall(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam) {
    return this.packs.uninstall(auth, req, key);
  }

  @ApiRoute(API_ROUTES.packLog)
  log(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam) {
    return this.packs.log(auth, key);
  }
}
