import { Controller, Param, Query } from '@nestjs/common';
import { API_ROUTES, IdParamSchema, type Page, type PlatformAuditLog, type SetupChecklist, type SuperCompanyUser } from '@vistar/shared';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { SuperCompanyDetailService } from './super-company-detail.service.js';

type IdParam = { id: string };
const AuditQuerySchema = API_ROUTES.superAuditList.query;

/** Super Admin company detail tabs (change #20): users, setup progress; and the platform audit log. */
@Controller()
export class SuperCompanyDetailController {
  constructor(private readonly detail: SuperCompanyDetailService) {}

  @ApiRoute(API_ROUTES.superCompanyUsers)
  users(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<{ items: SuperCompanyUser[] }> {
    return this.detail.users(id);
  }

  @ApiRoute(API_ROUTES.superCompanySetup)
  setup(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<SetupChecklist> {
    return this.detail.setupChecklist(id);
  }

  @ApiRoute(API_ROUTES.superAuditList)
  audit(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Query(new ZodPipe(AuditQuerySchema)) query: z.output<typeof AuditQuerySchema>): Promise<Page<PlatformAuditLog>> {
    return this.detail.auditList(query);
  }
}
