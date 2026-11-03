import { Body, Controller, Param, Req } from '@nestjs/common';
import {
  API_ROUTES,
  ConfigGroupParamSchema,
  ConfigGroupTestSchema,
  ConfigGroupUpdateSchema,
  RegistryGroupParamSchema,
  type ConfigAuditEntry,
  type ConfigGroup,
  type ConfigRegistry,
  type ConfigTestResult,
  type GoLiveChecklist,
  type PublicPlatformInfo,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { runConfigTest } from './config-tests.js';
import { GoLiveService } from './go-live.service.js';
import { PlatformConfigService } from './platform-config.service.js';
import { googleClientId, googleOAuthConfig, monitoringConfig, platformBranding, securityPolicy } from './snapshot.js';

type GroupParam = z.output<typeof ConfigGroupParamSchema>;
type RegistryParam = z.output<typeof RegistryGroupParamSchema>;

/** Super Admin > Config (D-073): registry groups, tests, audit trail, go-live checklist. */
@Controller()
export class SuperConfigRegistryController {
  constructor(
    private readonly config: PlatformConfigService,
    private readonly goLive: GoLiveService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiRoute(API_ROUTES.superConfigRegistry)
  registry(@CurrentPlatformAdmin() _admin: PlatformAuthContext): Promise<ConfigRegistry> {
    return this.config.registry();
  }

  @ApiRoute(API_ROUTES.superConfigGroupGet)
  group(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(ConfigGroupParamSchema)) { group }: GroupParam): Promise<ConfigGroup> {
    return this.config.group(group);
  }

  @ApiRoute(API_ROUTES.superConfigGroupUpdate)
  update(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(RegistryGroupParamSchema)) { group }: RegistryParam,
    @Body(new ZodPipe(ConfigGroupUpdateSchema)) body: z.output<typeof ConfigGroupUpdateSchema>,
  ): Promise<ConfigGroup> {
    return this.config.update(admin, req, group, body);
  }

  @ApiRoute(API_ROUTES.superConfigGroupReset)
  reset(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(RegistryGroupParamSchema)) { group }: RegistryParam): Promise<ConfigGroup> {
    return this.config.reset(admin, req, group);
  }

  @ApiRoute(API_ROUTES.superConfigGroupTest)
  async test(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(RegistryGroupParamSchema)) { group }: RegistryParam,
    @Body(new ZodPipe(ConfigGroupTestSchema)) body: z.output<typeof ConfigGroupTestSchema>,
  ): Promise<ConfigTestResult> {
    const to = body.to ?? (await this.prisma.platformAdmin.findUnique({ where: { id: admin.adminId }, select: { email: true } }))?.email ?? '';
    const result = await runConfigTest(group, { to });
    await this.config.recordTest(admin, req, group, result);
    return result;
  }

  @ApiRoute(API_ROUTES.superConfigGroupAudit)
  audit(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(ConfigGroupParamSchema)) { group }: GroupParam): Promise<{ items: ConfigAuditEntry[] }> {
    return this.config.auditTrail(group);
  }

  @ApiRoute(API_ROUTES.superGoLive)
  goLiveChecklist(@CurrentPlatformAdmin() _admin: PlatformAuthContext): Promise<GoLiveChecklist> {
    return this.goLive.evaluate();
  }
}

/** GET /public/platform: Vistar's own name, contacts and legal links, password rule, web DSN (no secrets). */
@Controller()
export class PublicPlatformController {
  @ApiRoute(API_ROUTES.publicPlatformInfo)
  info(): PublicPlatformInfo {
    const b = platformBranding();
    const m = monitoringConfig();
    return {
      productName: b.productName,
      supportEmail: b.supportEmail,
      supportPhone: b.supportPhone,
      websiteUrl: b.websiteUrl,
      termsUrl: b.termsUrl,
      privacyUrl: b.privacyUrl,
      passwordMinLength: securityPolicy().passwordMinLength,
      monitoring: m.webDsn ? { dsn: m.webDsn, environment: m.environment, tracesSampleRate: m.tracesSampleRate, errorSampleRate: m.errorSampleRate } : null,
      googleSignIn: googleOAuthConfig() !== null,
      googleClientId: googleClientId(),
    };
  }
}
