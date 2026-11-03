import { Body, Controller, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  EmailVerifySchema,
  PasswordForgotSchema,
  PasswordResetLookupQuerySchema,
  PasswordResetSchema,
  type EmailVerificationStatus,
  type PasswordResetLookup,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AccountLinksService } from './account-links.service.js';

/** Change #20: password reset and e-mail verification links. */
@Controller()
export class AccountLinksController {
  constructor(private readonly links: AccountLinksService) {}

  @ApiRoute(API_ROUTES.authPasswordForgot)
  forgot(@Req() req: Request, @Body(new ZodPipe(PasswordForgotSchema)) body: z.output<typeof PasswordForgotSchema>): Promise<{ ok: true }> {
    return this.links.forgot(body.email, req);
  }

  @ApiRoute(API_ROUTES.authPasswordResetLookup)
  lookup(@Query(new ZodPipe(PasswordResetLookupQuerySchema)) q: z.output<typeof PasswordResetLookupQuerySchema>): Promise<PasswordResetLookup> {
    return this.links.lookup(q.token);
  }

  @ApiRoute(API_ROUTES.authPasswordReset)
  reset(@Req() req: Request, @Body(new ZodPipe(PasswordResetSchema)) body: z.output<typeof PasswordResetSchema>): Promise<{ ok: true }> {
    return this.links.reset(body.token, body.password, req);
  }

  @ApiRoute(API_ROUTES.authEmailVerify)
  verify(@Body(new ZodPipe(EmailVerifySchema)) body: z.output<typeof EmailVerifySchema>): Promise<{ ok: true }> {
    return this.links.verify(body.token);
  }

  @ApiRoute(API_ROUTES.myEmailVerification)
  status(@CurrentAuth() auth: AuthContext): Promise<EmailVerificationStatus> {
    return this.links.status(auth);
  }

  @ApiRoute(API_ROUTES.myEmailVerificationSend)
  resend(@CurrentAuth() auth: AuthContext, @Req() req: Request): Promise<EmailVerificationStatus> {
    return this.links.resend(auth, req);
  }
}
