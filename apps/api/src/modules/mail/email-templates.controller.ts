import { Body, Controller, Param, Req } from '@nestjs/common';
import {
  API_ROUTES,
  CompanyEmailTemplateParamSchema,
  EmailTemplatePreviewSchema,
  EmailTemplateTestSchema,
  EmailTemplateUpdateSchema,
  PlatformEmailTemplateParamSchema,
  type EmailPreview,
  type EmailSendResult,
  type EmailTemplate,
  type EmailTemplateSummary,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, CurrentPlatformAdmin, type AuthContext, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { EmailTemplatesService } from './email-templates.service.js';

type PlatformKey = z.output<typeof PlatformEmailTemplateParamSchema>;
type CompanyKey = z.output<typeof CompanyEmailTemplateParamSchema>;

/** Super Admin > Config > E-mail templates. */
@Controller()
export class SuperEmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @ApiRoute(API_ROUTES.superEmailTemplateList)
  list(@CurrentPlatformAdmin() _admin: PlatformAuthContext): Promise<{ items: EmailTemplateSummary[] }> {
    return this.templates.platformList();
  }

  @ApiRoute(API_ROUTES.superEmailTemplateGet)
  get(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(PlatformEmailTemplateParamSchema)) { key }: PlatformKey): Promise<EmailTemplate> {
    return this.templates.platformGet(key);
  }

  @ApiRoute(API_ROUTES.superEmailTemplateUpdate)
  update(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(PlatformEmailTemplateParamSchema)) { key }: PlatformKey,
    @Body(new ZodPipe(EmailTemplateUpdateSchema)) body: z.output<typeof EmailTemplateUpdateSchema>,
  ): Promise<EmailTemplate> {
    return this.templates.platformUpdate(admin, req, key, body);
  }

  @ApiRoute(API_ROUTES.superEmailTemplateReset)
  reset(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(PlatformEmailTemplateParamSchema)) { key }: PlatformKey): Promise<EmailTemplate> {
    return this.templates.platformReset(admin, req, key);
  }

  @ApiRoute(API_ROUTES.superEmailTemplatePreview)
  preview(
    @CurrentPlatformAdmin() _admin: PlatformAuthContext,
    @Param(new ZodPipe(PlatformEmailTemplateParamSchema)) { key }: PlatformKey,
    @Body(new ZodPipe(EmailTemplatePreviewSchema)) body: z.output<typeof EmailTemplatePreviewSchema>,
  ): Promise<EmailPreview> {
    return this.templates.platformPreview(key, body);
  }

  @ApiRoute(API_ROUTES.superEmailTemplateTest)
  test(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Param(new ZodPipe(PlatformEmailTemplateParamSchema)) { key }: PlatformKey,
    @Body(new ZodPipe(EmailTemplateTestSchema)) body: z.output<typeof EmailTemplateTestSchema>,
  ): Promise<EmailSendResult> {
    return this.templates.platformTest(admin, key, body);
  }
}

/** Company > Settings > E-mail templates. */
@Controller()
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @ApiRoute(API_ROUTES.emailTemplateList)
  list(@CurrentAuth() auth: AuthContext): Promise<{ items: EmailTemplateSummary[] }> {
    return this.templates.companyList(auth);
  }

  @ApiRoute(API_ROUTES.emailTemplateGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(CompanyEmailTemplateParamSchema)) { key }: CompanyKey): Promise<EmailTemplate> {
    return this.templates.companyGet(auth, key);
  }

  @ApiRoute(API_ROUTES.emailTemplateUpdate)
  update(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(CompanyEmailTemplateParamSchema)) { key }: CompanyKey,
    @Body(new ZodPipe(EmailTemplateUpdateSchema)) body: z.output<typeof EmailTemplateUpdateSchema>,
  ): Promise<EmailTemplate> {
    return this.templates.companyUpdate(auth, req, key, body);
  }

  @ApiRoute(API_ROUTES.emailTemplateReset)
  reset(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(CompanyEmailTemplateParamSchema)) { key }: CompanyKey): Promise<EmailTemplate> {
    return this.templates.companyReset(auth, req, key);
  }

  @ApiRoute(API_ROUTES.emailTemplatePreview)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(CompanyEmailTemplateParamSchema)) { key }: CompanyKey,
    @Body(new ZodPipe(EmailTemplatePreviewSchema)) body: z.output<typeof EmailTemplatePreviewSchema>,
  ): Promise<EmailPreview> {
    return this.templates.companyPreview(auth, key, body);
  }

  @ApiRoute(API_ROUTES.emailTemplateTest)
  test(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(CompanyEmailTemplateParamSchema)) { key }: CompanyKey,
    @Body(new ZodPipe(EmailTemplateTestSchema)) body: z.output<typeof EmailTemplateTestSchema>,
  ): Promise<EmailSendResult> {
    return this.templates.companyTest(auth, key, body);
  }
}
