import { Body, Controller, Param, Query, Req, Res } from '@nestjs/common';
import {
  API_ROUTES,
  GoogleAuthRequestSchema,
  IdParamSchema,
  InviteAcceptSchema,
  InviteCreateSchema,
  LoginRequestSchema,
  SignupRequestSchema,
  type GoogleAuthRequest,
  type InviteCreate,
  type LoginRequest,
  type SignupRequest,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { InviteService } from './invite.service.js';
import { MeService } from './me.service.js';

/**
 * Link invites carry no email, so accepting one with a password needs it from the person.
 * Accepts the contract body plus an optional `email` (see CONTRACT-REQUEST in the summary).
 */
const InviteAcceptBodySchema = InviteAcceptSchema.extend({ email: z.email().optional() });

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly me: MeService,
    private readonly invites: InviteService,
  ) {}

  @ApiRoute(API_ROUTES.authSignup)
  signup(@Body(new ZodPipe(SignupRequestSchema)) body: SignupRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.signup(body, req, res);
  }

  @ApiRoute(API_ROUTES.authLogin)
  login(@Body(new ZodPipe(LoginRequestSchema)) body: LoginRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body, req, res);
  }

  @ApiRoute(API_ROUTES.authGoogle)
  google(@Body(new ZodPipe(GoogleAuthRequestSchema)) body: GoogleAuthRequest, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.loginWithGoogle(body, req, res);
  }

  @ApiRoute(API_ROUTES.authRefresh)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req, res);
  }

  @ApiRoute(API_ROUTES.authLogout)
  logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(auth, res);
  }

  @ApiRoute(API_ROUTES.authMe)
  getMe(@CurrentAuth() auth: AuthContext) {
    return this.me.build(auth);
  }

  @ApiRoute(API_ROUTES.inviteAccept)
  acceptInvite(
    @Body(new ZodPipe(InviteAcceptBodySchema)) body: z.output<typeof InviteAcceptBodySchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.invites.accept(body.token, { email: body.email ?? null, name: body.name, password: body.password, googleSub: null }, req, res);
  }
}

@Controller()
export class InviteController {
  constructor(private readonly invites: InviteService) {}

  @ApiRoute(API_ROUTES.inviteCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(InviteCreateSchema)) body: InviteCreate) {
    return this.invites.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.inviteList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.invites.list(auth);
  }

  @ApiRoute(API_ROUTES.inviteLookup)
  lookup(@Query(new ZodPipe(API_ROUTES.inviteLookup.query)) query: { token: string }) {
    return this.invites.lookup(query.token);
  }

  @ApiRoute(API_ROUTES.inviteRevoke)
  revoke(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) params: { id: string }) {
    return this.invites.revoke(auth, req, params.id);
  }
}
