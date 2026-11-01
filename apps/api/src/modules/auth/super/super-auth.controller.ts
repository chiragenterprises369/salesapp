import { Body, Controller, Req, Res } from '@nestjs/common';
import { API_ROUTES, SuperLoginRequestSchema, SuperVerifyRequestSchema } from '@vistar/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../../common/auth/auth-context.js';
import { ApiRoute } from '../../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../../common/validation/zod.pipe.js';
import { SuperAuthService } from './super-auth.service.js';

/** Super Admin auth under /api/super (platform audience). */
@Controller()
export class SuperAuthController {
  constructor(private readonly superAuth: SuperAuthService) {}

  @ApiRoute(API_ROUTES.superLogin)
  login(@Body(new ZodPipe(SuperLoginRequestSchema)) body: z.output<typeof SuperLoginRequestSchema>, @Req() req: Request) {
    return this.superAuth.login(body, req);
  }

  @ApiRoute(API_ROUTES.superVerify)
  verify(@Body(new ZodPipe(SuperVerifyRequestSchema)) body: z.output<typeof SuperVerifyRequestSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.superAuth.verify(body, req, res);
  }

  @ApiRoute(API_ROUTES.superRefresh)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.superAuth.refresh(req, res);
  }

  @ApiRoute(API_ROUTES.superLogout)
  logout(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.superAuth.logout(admin, req, res);
  }

  @ApiRoute(API_ROUTES.superMe)
  me(@CurrentPlatformAdmin() admin: PlatformAuthContext) {
    return this.superAuth.me(admin);
  }
}
