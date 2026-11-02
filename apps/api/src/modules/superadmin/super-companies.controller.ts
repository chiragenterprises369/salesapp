import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import { API_ROUTES, CompanyCreateSchema, CompanyFlagsUpdateSchema, CompanyListQuerySchema, IdParamSchema, type Company, type CompanyCreated, type Page } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { SuperCompaniesService } from './super-companies.service.js';

type IdParam = { id: string };

/** Super Admin companies (platform audience; permissions from API_ROUTES, enforced by the guard). */
@Controller()
export class SuperCompaniesController {
  constructor(private readonly companies: SuperCompaniesService) {}

  @ApiRoute(API_ROUTES.superCompanyList)
  list(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Query(new ZodPipe(CompanyListQuerySchema)) query: z.output<typeof CompanyListQuerySchema>): Promise<Page<Company>> {
    return this.companies.list(query);
  }

  @ApiRoute(API_ROUTES.superCompanyGet)
  get(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<Company> {
    return this.companies.get(id);
  }

  @ApiRoute(API_ROUTES.superCompanyCreate)
  create(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Body(new ZodPipe(CompanyCreateSchema)) body: z.output<typeof CompanyCreateSchema>): Promise<CompanyCreated> {
    return this.companies.create(admin, req, body);
  }

  @ApiRoute(API_ROUTES.superCompanyFlags)
  flags(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) { id }: IdParam,
    @Body(new ZodPipe(CompanyFlagsUpdateSchema)) body: z.output<typeof CompanyFlagsUpdateSchema>,
  ): Promise<Company> {
    return this.companies.setFlags(admin, req, id, body);
  }
}
