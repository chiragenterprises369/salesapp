import { Body, Controller, Module, Param, Req } from '@nestjs/common';
import { API_ROUTES, SetupBannerSchema, SetupItemAckSchema, SetupItemParamSchema, type SetupChecklist } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { SetupService } from './setup.service.js';

/** Company > Settings > Setup (checklist, hand-ticked items, dashboard banner). */
@Controller()
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @ApiRoute(API_ROUTES.setupChecklist)
  checklist(@CurrentAuth() auth: AuthContext): Promise<SetupChecklist> {
    return this.setup.checklist(auth);
  }

  @ApiRoute(API_ROUTES.setupItemAcknowledge)
  acknowledge(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(SetupItemParamSchema)) { key }: z.output<typeof SetupItemParamSchema>,
    @Body(new ZodPipe(SetupItemAckSchema)) body: z.output<typeof SetupItemAckSchema>,
  ): Promise<SetupChecklist> {
    return this.setup.acknowledge(auth, req, key, body.acknowledged);
  }

  @ApiRoute(API_ROUTES.setupBanner)
  banner(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(SetupBannerSchema)) body: z.output<typeof SetupBannerSchema>): Promise<SetupChecklist> {
    return this.setup.banner(auth, body.dismissed);
  }
}

/** OWNER: backend-core (CONFIG-API stream, change #20). Company setup checklist (exported for the Super Admin company detail). */
@Module({
  imports: [IntegrationsModule],
  controllers: [SetupController],
  providers: [SetupService],
  exports: [SetupService],
})
export class SetupModule {}
