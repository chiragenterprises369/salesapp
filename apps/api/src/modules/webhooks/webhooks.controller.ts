import { Body, Controller, Header, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  ApiKeyCreateSchema,
  ApiKeyRotateSchema,
  ApiKeyUpdateSchema,
  IdParamSchema,
  InboundEndpointCreateSchema,
  MappingPreviewRequestSchema,
  OutboundEndpointCreateSchema,
  WebhookCaptureSchema,
  WebhookDeliveryQuerySchema,
  WebhookEndpointListQuerySchema,
  WebhookEndpointUpdateSchema,
  WebhookRotateSecretSchema,
  WebhookTestSendSchema,
  type ApiKeyCreate,
  type ApiKeyUpdate,
  type InboundEndpointCreate,
  type OutboundEndpointCreate,
  type WebhookCapture,
  type WebhookDeliveryQuery,
  type WebhookEndpointUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { getEnv } from '../../config/env.js';
import { ApiKeysService } from './api-keys.service.js';
import { WebhooksService } from './webhooks.service.js';

type IdParam = { id: string };

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @ApiRoute(API_ROUTES.webhookEndpointList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(WebhookEndpointListQuerySchema)) q: z.output<typeof WebhookEndpointListQuerySchema>) {
    return this.webhooks.list(auth, q);
  }

  @ApiRoute(API_ROUTES.webhookInboundCreate)
  createInbound(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(InboundEndpointCreateSchema)) body: InboundEndpointCreate) {
    return this.webhooks.createInbound(auth, req, body);
  }

  @ApiRoute(API_ROUTES.webhookOutboundCreate)
  createOutbound(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(OutboundEndpointCreateSchema)) body: OutboundEndpointCreate) {
    return this.webhooks.createOutbound(auth, req, body);
  }

  @ApiRoute(API_ROUTES.webhookEndpointGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.webhooks.get(auth, id);
  }

  @ApiRoute(API_ROUTES.webhookEndpointUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(WebhookEndpointUpdateSchema)) body: WebhookEndpointUpdate) {
    return this.webhooks.update(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.webhookEndpointDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.webhooks.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.webhookRotateSecret)
  rotateSecret(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(WebhookRotateSecretSchema)) body: { graceHours: number }) {
    return this.webhooks.rotateSecret(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.webhookCapture)
  capture(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(WebhookCaptureSchema)) body: WebhookCapture) {
    return this.webhooks.capture(auth, id, body);
  }

  @ApiRoute(API_ROUTES.webhookTestSend)
  testSend(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(WebhookTestSendSchema)) body: { event?: string }) {
    return this.webhooks.testSend(auth, id, body);
  }

  @ApiRoute(API_ROUTES.webhookMappingPreview)
  preview(@Body(new ZodPipe(MappingPreviewRequestSchema)) body: z.output<typeof MappingPreviewRequestSchema>) {
    return this.webhooks.preview(body);
  }

  @ApiRoute(API_ROUTES.webhookDeliveryList)
  deliveries(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(WebhookDeliveryQuerySchema)) q: WebhookDeliveryQuery) {
    return this.webhooks.deliveries(auth, q);
  }

  @ApiRoute(API_ROUTES.webhookDeliveryGet)
  delivery(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.webhooks.delivery(auth, id);
  }

  @ApiRoute(API_ROUTES.webhookDeliveryReplay)
  replay(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.webhooks.replay(auth, req, id);
  }
}

/** API keys. `scopes` is declared before `{id}` routes. */
@Controller()
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @ApiRoute(API_ROUTES.apiKeyScopes)
  scopes(@CurrentAuth() auth: AuthContext) {
    return this.keys.scopes(auth);
  }

  @ApiRoute(API_ROUTES.apiKeyList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.keys.list(auth);
  }

  @ApiRoute(API_ROUTES.apiKeyCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(ApiKeyCreateSchema)) body: ApiKeyCreate) {
    return this.keys.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.apiKeyUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(ApiKeyUpdateSchema)) body: ApiKeyUpdate) {
    return this.keys.update(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.apiKeyRotate)
  rotate(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(ApiKeyRotateSchema)) body: { graceMinutes: number }) {
    return this.keys.rotate(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.apiKeyRevoke)
  revoke(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.keys.revoke(auth, req, id);
  }
}

/** Public API reference (no auth): OpenAPI 3.1 of the API-key routes, built once per process. */
@Controller()
export class PublicApiController {
  private doc: Promise<unknown> | null = null;

  @ApiRoute(API_ROUTES.publicOpenApi)
  @Header('Cache-Control', 'public, max-age=300')
  openapi() {
    this.doc ??= import('@vistar/shared/openapi').then((m) => m.buildPublicOpenApiDocument({ serverUrl: getEnv().API_PUBLIC_URL }));
    return this.doc;
  }
}
