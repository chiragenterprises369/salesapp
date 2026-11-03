import { Body, Controller, Param, Query, Req, Res } from '@nestjs/common';
import {
  API_ROUTES,
  IntegrationConnectSchema,
  IntegrationProviderParamSchema,
  IntegrationTestRequestSchema,
  OAuthCallbackQuerySchema,
  type IntegrationConnect,
  type IntegrationProviderParam,
  type IntegrationTestRequest,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { IntegrationsService } from './integrations.service.js';

/** Integration hub routes. `catalog` is declared before `{provider}` so /integrations/catalog is not read as a provider. */
@Controller()
export class IntegrationsController {
  constructor(private readonly hub: IntegrationsService) {}

  @ApiRoute(API_ROUTES.integrationCatalog)
  catalog(@CurrentAuth() auth: AuthContext) {
    return this.hub.catalog(auth);
  }

  @ApiRoute(API_ROUTES.integrationList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.hub.list(auth);
  }

  @ApiRoute(API_ROUTES.integrationGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam) {
    return this.hub.get(auth, provider);
  }

  @ApiRoute(API_ROUTES.integrationConnect)
  connect(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam,
    @Body(new ZodPipe(IntegrationConnectSchema)) body: IntegrationConnect,
  ) {
    return this.hub.connect(auth, req, provider, body);
  }

  @ApiRoute(API_ROUTES.integrationTest)
  test(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam,
    @Body(new ZodPipe(IntegrationTestRequestSchema)) body: IntegrationTestRequest,
  ) {
    return this.hub.test(auth, provider, body);
  }

  @ApiRoute(API_ROUTES.integrationSync)
  sync(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam) {
    return this.hub.sync(auth, provider);
  }

  @ApiRoute(API_ROUTES.integrationRotateToken)
  rotateToken(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam) {
    return this.hub.rotateToken(auth, req, provider);
  }

  @ApiRoute(API_ROUTES.integrationOAuthStart)
  oauthStart(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam) {
    return this.hub.oauthStart(auth, provider);
  }

  @ApiRoute(API_ROUTES.integrationDisconnect)
  disconnect(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IntegrationProviderParamSchema)) { provider }: IntegrationProviderParam) {
    return this.hub.disconnect(auth, req, provider);
  }

  /** Google redirect target (public): always answers with a redirect to the web Integrations page. */
  @ApiRoute(API_ROUTES.integrationOAuthCallback)
  async oauthCallback(@Query(new ZodPipe(OAuthCallbackQuerySchema)) q: z.output<typeof OAuthCallbackQuerySchema>, @Res() res: Response) {
    res.redirect(302, await this.hub.oauthCallback(q));
  }
}
