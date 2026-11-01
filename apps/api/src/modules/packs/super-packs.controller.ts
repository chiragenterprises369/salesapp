import { Body, Controller, Param, Req } from '@nestjs/common';
import {
  API_ROUTES,
  PackCompanyParamSchema,
  PackKeyParamSchema,
  PackVersionParamSchema,
  SuperPackCompanyUpdateSchema,
  SuperPackPlansUpdateSchema,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { SuperPacksService } from './super-packs.service.js';

type KeyParam = { key: string };

/** Super Admin pack registry. Platform audience (`auth: 'super'`) + `platform.packs.manage`, enforced by the guard. */
@Controller()
export class SuperPacksController {
  constructor(private readonly packs: SuperPacksService) {}

  @ApiRoute(API_ROUTES.superPackList)
  list(@CurrentPlatformAdmin() _admin: PlatformAuthContext) {
    return this.packs.list();
  }

  @ApiRoute(API_ROUTES.superPackVersion)
  version(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(PackVersionParamSchema)) p: z.output<typeof PackVersionParamSchema>) {
    return this.packs.version(p.key, p.version);
  }

  @ApiRoute(API_ROUTES.superPackPlans)
  plans(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam,
    @Body(new ZodPipe(SuperPackPlansUpdateSchema)) body: z.output<typeof SuperPackPlansUpdateSchema>,
  ) {
    return this.packs.updatePlans(admin, req, key, body);
  }

  @ApiRoute(API_ROUTES.superPackCompany)
  company(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(PackCompanyParamSchema)) p: z.output<typeof PackCompanyParamSchema>,
    @Body(new ZodPipe(SuperPackCompanyUpdateSchema)) body: z.output<typeof SuperPackCompanyUpdateSchema>,
  ) {
    return this.packs.updateCompany(admin, req, p.key, p.workspaceId, body);
  }

  @ApiRoute(API_ROUTES.superPackUsage)
  usage(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(PackKeyParamSchema)) { key }: KeyParam) {
    return this.packs.usage(key);
  }
}
