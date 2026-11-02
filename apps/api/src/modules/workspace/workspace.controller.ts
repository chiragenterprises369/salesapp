import { Body, Controller, Req } from '@nestjs/common';
import {
  API_ROUTES,
  BrandingUpdateSchema,
  CustomDomainSetSchema,
  SupportAccessUpdateSchema,
  ThemeModeSchema,
  WorkspaceUpdateSchema,
  type BrandingUpdate,
  type CustomDomainSet,
  type CustomDomainState,
  type Workspace,
  type WorkspaceBranding,
  type WorkspaceUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { DomainsService } from './domains.service.js';
import { WorkspaceService } from './workspace.service.js';

@Controller()
export class WorkspaceController {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly domains: DomainsService,
  ) {}

  @ApiRoute(API_ROUTES.workspaceGet)
  get(@CurrentAuth() auth: AuthContext): Promise<Workspace> {
    return this.workspaces.get(auth.workspaceId);
  }

  @ApiRoute(API_ROUTES.workspaceUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(WorkspaceUpdateSchema)) body: WorkspaceUpdate): Promise<Workspace> {
    return this.workspaces.update(auth, req, body);
  }

  @ApiRoute(API_ROUTES.workspaceTheme)
  setTheme(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(z.object({ mode: ThemeModeSchema }))) body: { mode: z.infer<typeof ThemeModeSchema> }): Promise<Workspace> {
    return this.workspaces.setTheme(auth, req, body.mode);
  }

  @ApiRoute(API_ROUTES.supportAccessUpdate)
  supportAccess(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(SupportAccessUpdateSchema)) body: z.output<typeof SupportAccessUpdateSchema>): Promise<Workspace> {
    return this.workspaces.setSupportAccess(auth, req, body);
  }

  @ApiRoute(API_ROUTES.brandingGet)
  async branding(@CurrentAuth() auth: AuthContext): Promise<WorkspaceBranding> {
    return (await this.workspaces.get(auth.workspaceId)).branding;
  }

  @ApiRoute(API_ROUTES.brandingUpdate)
  updateBranding(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(BrandingUpdateSchema)) body: BrandingUpdate): Promise<Workspace> {
    return this.workspaces.updateBranding(auth, req, body);
  }

  @ApiRoute(API_ROUTES.domainGet)
  domain(@CurrentAuth() auth: AuthContext): Promise<CustomDomainState> {
    return this.domains.state(auth.workspaceId);
  }

  @ApiRoute(API_ROUTES.domainSet)
  setDomain(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CustomDomainSetSchema)) body: CustomDomainSet): Promise<CustomDomainState> {
    return this.domains.set(auth, req, body.hostname);
  }

  @ApiRoute(API_ROUTES.domainDelete)
  deleteDomain(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<CustomDomainState> {
    return this.domains.remove(auth, req);
  }

  @ApiRoute(API_ROUTES.domainVerify)
  verifyDomain(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<CustomDomainState> {
    return this.domains.verify(auth, req);
  }
}
