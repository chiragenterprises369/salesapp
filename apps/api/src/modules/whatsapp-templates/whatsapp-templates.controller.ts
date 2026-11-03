import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  IdParamSchema,
  WhatsAppTemplateCreateSchema,
  WhatsAppTemplateListQuerySchema,
  WhatsAppTemplateUpdateSchema,
  type Template,
  type WhatsAppTemplate,
  type WhatsAppTemplateSyncResult,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { WhatsappTemplatesService } from './whatsapp-templates.service.js';

type IdParam = { id: string };

/** Company > Settings > WhatsApp templates (Meta review), plus the inbox's POST /templates/sync. */
@Controller()
export class WhatsappTemplatesController {
  constructor(private readonly templates: WhatsappTemplatesService) {}

  @ApiRoute(API_ROUTES.whatsappTemplateList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(WhatsAppTemplateListQuerySchema)) q: z.output<typeof WhatsAppTemplateListQuerySchema>): Promise<{ items: WhatsAppTemplate[] }> {
    return this.templates.list(auth, q);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateSync)
  async sync(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<WhatsAppTemplateSyncResult> {
    const { rows: _rows, ...result } = await this.templates.sync(auth, req);
    return result;
  }

  @ApiRoute(API_ROUTES.templateSync)
  legacySync(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<{ items: Template[] }> {
    return this.templates.legacySync(auth, req);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(WhatsAppTemplateCreateSchema)) body: z.output<typeof WhatsAppTemplateCreateSchema>): Promise<WhatsAppTemplate> {
    return this.templates.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<WhatsAppTemplate> {
    return this.templates.get(auth, id);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateUpdate)
  update(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) { id }: IdParam,
    @Body(new ZodPipe(WhatsAppTemplateUpdateSchema)) body: z.output<typeof WhatsAppTemplateUpdateSchema>,
  ): Promise<WhatsAppTemplate> {
    return this.templates.update(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<{ ok: true }> {
    return this.templates.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.whatsappTemplateSubmit)
  submit(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<WhatsAppTemplate> {
    return this.templates.submit(auth, req, id);
  }
}
