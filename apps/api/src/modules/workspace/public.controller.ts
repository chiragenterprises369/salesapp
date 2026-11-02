import { Controller, Param, Query } from '@nestjs/common';
import { API_ROUTES, HostResolveQuerySchema, SlugParamSchema, type HostResolution, type PublicWorkspace } from '@vistar/shared';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { DomainsService } from './domains.service.js';

/** No-auth routes for the login page and the Next middleware (host -> workspace, public branding). */
@Controller()
export class PublicWorkspaceController {
  constructor(private readonly domains: DomainsService) {}

  @ApiRoute(API_ROUTES.publicWorkspaceBranding)
  bySlug(@Param(new ZodPipe(SlugParamSchema)) { slug }: { slug: string }): Promise<PublicWorkspace> {
    return this.domains.publicBySlug(slug);
  }

  @ApiRoute(API_ROUTES.publicResolveHost)
  resolve(@Query(new ZodPipe(HostResolveQuerySchema)) { host }: { host: string }): Promise<HostResolution> {
    return this.domains.resolveHost(host);
  }
}
