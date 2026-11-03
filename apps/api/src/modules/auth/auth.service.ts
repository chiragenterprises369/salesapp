import { Injectable } from '@nestjs/common';
import type { GoogleAuthRequest, LoginRequest, SignupRequest } from '@vistar/shared';
import type { Request, Response } from 'express';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { googleClientId } from '../config-registry/snapshot.js';
import { assertTimeZone } from '../workspace/util.js';
import { AccountLinksService, assertPasswordPolicy } from './account-links.service.js';
import { InviteService } from './invite.service.js';
import { hashPassword, verifyPassword } from './password.js';
import { AUTH_USER_SELECT, authContextFromClaims, SessionService, type AuthSession, type AuthUser } from './session.service.js';
import { WorkspaceProvisioner } from './workspace-provisioner.js';

/** Same message for unknown email and wrong password, so login never reveals whether an email exists. */
const invalidCredentials = () => new AppException('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect');
const emailTaken = () => new AppException('AUTH_EMAIL_TAKEN', 'An account with this email already exists. Sign in instead');

@Injectable()
export class AuthService {
  private google: OAuth2Client | null = null;
  private googleClientId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly invites: InviteService,
    private readonly provisioner: WorkspaceProvisioner,
    private readonly audit: AuditService,
    // ---- change #20: config (verification e-mail after sign-up)
    private readonly links: AccountLinksService,
  ) {}

  async signup(body: SignupRequest, req: Request, res: Response): Promise<AuthSession> {
    assertTimeZone(body.timezone);
    // ---- change #20: config (security policy password length)
    assertPasswordPolicy(body.password);
    if (await this.prisma.user.count({ where: { email: body.email } })) throw emailTaken();
    const passwordHash = await hashPassword(body.password);
    return this.provisionAndStart(
      { ownerName: body.name, email: body.email, passwordHash, googleSub: null, workspaceName: body.workspaceName, timezone: body.timezone },
      req,
      res,
    );
  }

  async login(body: LoginRequest, req: Request, res: Response): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { email: body.email }, select: AUTH_USER_SELECT });
    const ok = await verifyPassword(user?.passwordHash, body.password);
    if (!user || !ok || user.deletedAt) throw invalidCredentials();
    this.sessions.assertCanSignIn(user);
    return this.sessions.start(user, req, res);
  }

  async loginWithGoogle(body: GoogleAuthRequest, req: Request, res: Response): Promise<AuthSession> {
    const profile = await this.verifyGoogle(body.idToken);
    const email = profile.email!.toLowerCase();

    const bySub = await this.prisma.user.findUnique({ where: { googleSub: profile.sub }, select: AUTH_USER_SELECT });
    const user = bySub ?? (await this.prisma.user.findUnique({ where: { email }, select: AUTH_USER_SELECT }));
    if (user) {
      if (user.deletedAt) throw invalidCredentials();
      if (user.googleSub && user.googleSub !== profile.sub) throw invalidCredentials();
      this.sessions.assertCanSignIn(user);
      if (!user.googleSub) {
        // Verified Google email matches an existing account: link it.
        await this.prisma.forTenant(user.workspaceId).user.update({ where: { id: user.id }, data: { googleSub: profile.sub } });
      }
      return this.sessions.start(user, req, res);
    }

    const name = (profile.name ?? email.split('@')[0] ?? 'New user').slice(0, 80);
    if (body.inviteToken) {
      return this.invites.accept(body.inviteToken, { email, name, password: null, googleSub: profile.sub }, req, res);
    }
    if (body.workspaceName) {
      return this.provisionAndStart({ ownerName: name, email, passwordHash: null, googleSub: profile.sub, workspaceName: body.workspaceName, timezone: 'Asia/Kolkata' }, req, res);
    }
    throw new AppException('VALIDATION_FAILED', 'No Vistar account uses this Google email yet. Add a workspace name to create one', {
      details: [{ path: 'workspaceName', message: 'Required to sign up' }],
    });
  }

  refresh(req: Request, res: Response) {
    return this.sessions.refresh(req, res);
  }

  async logout(auth: AuthContext, res: Response): Promise<{ ok: true }> {
    if (auth.sessionId && !auth.impersonation) await this.sessions.revokeFamily(auth.workspaceId, auth.sessionId);
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  private async provisionAndStart(input: Parameters<WorkspaceProvisioner['provision']>[0], req: Request, res: Response): Promise<AuthSession> {
    const { workspaceId, userId } = await this.provisioner.provision(input);
    // ---- change #20: config. A verified Google e-mail counts as verified; password sign-ups get a link.
    if (input.googleSub) await this.prisma.forTenant(workspaceId).user.updateMany({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    const user: AuthUser = await this.prisma.forTenant(workspaceId).user.findFirstOrThrow({ where: { id: userId }, select: AUTH_USER_SELECT });
    const session = await this.sessions.start(user, req, res);
    const auth = authContextFromClaims(this.sessions.claimsFor(user, 'signup'));
    await this.audit.record(auth, req, { action: 'workspace.create', entityType: 'workspace', entityId: workspaceId, diff: { plan: 'free', status: 'trial' } }, user.name);
    if (!input.googleSub) void this.links.sendVerification(userId, workspaceId, req);
    return session;
  }

  private async verifyGoogle(idToken: string): Promise<TokenPayload> {
    // ---- change #20: config (Super Admin > Config > Google OAuth client, env fallback)
    const clientId = googleClientId();
    if (!clientId) throw new AppException('INTEGRATION_NOT_CONNECTED', 'Google sign-in is not set up on this server. Use email and password');
    if (this.googleClientId !== clientId) {
      this.google = new OAuth2Client({ clientId });
      this.googleClientId = clientId;
    }
    this.google ??= new OAuth2Client({ clientId });
    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      throw new AppException('AUTH_TOKEN_INVALID', 'Google sign-in failed. Try again');
    }
    if (!payload?.sub || !payload.email) throw new AppException('AUTH_TOKEN_INVALID', 'Google sign-in failed. Try again');
    if (payload.email_verified !== true) throw new AppException('AUTH_TOKEN_INVALID', 'Verify your Google account email, then try again');
    return payload;
  }
}
