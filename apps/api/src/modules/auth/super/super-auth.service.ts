import { Injectable, Logger } from '@nestjs/common';
import {
  PLATFORM_PERMISSIONS,
  SUPER_SESSION,
  type PlatformAdmin,
  type PlatformPermission,
  type SuperLoginChallenge,
  type SuperSession,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PlatformAuthContext } from '../../../common/auth/auth-context.js';
import { AuditService } from '../../../common/audit/audit.service.js';
import { AppException } from '../../../common/errors/app-exception.js';
import { decryptSecret, encryptSecret, hashToken, randomToken } from '../../../infra/crypto/secrets.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../../infra/crypto/totp.js';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import {
  CHALLENGE_MAX_ATTEMPTS,
  CHALLENGE_TTL_SEC,
  clientIp,
  refreshCookieOptions,
  SUPER_REFRESH_COOKIE,
  SUPER_REFRESH_PATH,
  userAgent,
} from '../auth.constants.js';
import { KvStore } from '../state/kv.store.js';
import { verifyPassword } from '../password.js';
import { TokenService } from '../token.service.js';
import { ipAllowed } from './ip-allowlist.js';

const PLATFORM_PERMISSION_SET = new Set<string>(PLATFORM_PERMISSIONS);
const invalidCredentials = () => new AppException('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect');
const badCode = () => new AppException('AUTH_INVALID_CREDENTIALS', 'The code is incorrect or expired. Enter the latest code from your app');
const sessionEnded = () => new AppException('AUTH_TOKEN_INVALID', 'Your session ended. Sign in again');

const chalKeys = {
  used: (jti: string) => `vistar:super:chal:used:${jti}`,
  attempts: (jti: string) => `vistar:super:chal:attempts:${jti}`,
};

interface AdminRow {
  id: string;
  email: string;
  name: string;
  permissions: string[];
  mfaEnabledAt: Date | null;
  ipAllowlist: string[];
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function platformPermissions(list: readonly string[]): PlatformPermission[] {
  return [...new Set(list.filter((p) => PLATFORM_PERMISSION_SET.has(p)))] as PlatformPermission[];
}

export function toPlatformAdmin(a: AdminRow): PlatformAdmin {
  return {
    id: a.id,
    email: a.email,
    name: a.name,
    permissions: platformPermissions(a.permissions),
    mfaEnabled: !!a.mfaEnabledAt,
    ipAllowlist: a.ipAllowlist,
    isActive: a.isActive,
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Super Admin (platform audience) authentication:
 *  1. password -> single-use 2FA challenge (5 min); first login enrols TOTP and returns otpauthUrl once
 *  2. TOTP (replay-protected via totpLastStep) -> platform access token + `vistar_srt` refresh cookie
 * PlatformSession enforces idle (30 min, lastSeenAt) and absolute (12 h) timeouts; the per-admin IP
 * allowlist applies to login and every /api/super request. Every login success/failure and logout is
 * written to PlatformAuditLog. Secrets and codes are never logged.
 */
@Injectable()
export class SuperAuthService {
  private readonly logger = new Logger(SuperAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly kv: KvStore,
    private readonly audit: AuditService,
  ) {}

  private async auditFailure(req: Request, adminId: string | null, reason: string, email?: string): Promise<void> {
    await this.audit.platform({ adminId }, req, {
      action: 'auth.login_failed',
      entityType: 'platform_admin',
      entityId: adminId,
      reason,
      diff: email ? { email } : null,
    });
  }

  async login(body: { email: string; password: string }, req: Request): Promise<SuperLoginChallenge> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: body.email } });
    const passwordOk = await verifyPassword(admin?.passwordHash, body.password);
    if (!admin || !passwordOk) {
      await this.auditFailure(req, admin?.id ?? null, 'invalid_credentials', body.email);
      throw invalidCredentials();
    }
    if (!ipAllowed(clientIp(req), admin.ipAllowlist)) {
      // Same message as a wrong password: do not reveal that the password was right.
      await this.auditFailure(req, admin.id, 'ip_not_allowed');
      throw invalidCredentials();
    }
    if (!admin.isActive) {
      await this.auditFailure(req, admin.id, 'account_disabled');
      throw new AppException('AUTH_ACCOUNT_DISABLED', 'This Super Admin account is disabled');
    }

    let enrollUrl: string | null = null;
    if (!admin.mfaEnabledAt) {
      // Enrolment: a fresh secret on every attempt until the first valid code confirms it.
      const secret = generateTotpSecret();
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { totpSecretEncrypted: encryptSecret(secret), totpLastStep: null } });
      enrollUrl = otpauthUrl(admin.email, secret);
    }
    const challengeToken = this.tokens.signChallenge(admin.id, randomUUID());
    return { challengeToken, enrollmentRequired: !admin.mfaEnabledAt, otpauthUrl: enrollUrl };
  }

  async verify(body: { challengeToken: string; code: string }, req: Request, res: Response): Promise<SuperSession> {
    const challenge = await this.tokens.verifyChallenge(body.challengeToken);
    if (await this.kv.get(chalKeys.used(challenge.jti))) {
      throw new AppException('AUTH_TOKEN_INVALID', 'This sign-in attempt was already used. Enter your password again');
    }
    if ((await this.kv.incr(chalKeys.attempts(challenge.jti), CHALLENGE_TTL_SEC)) > CHALLENGE_MAX_ATTEMPTS) {
      await this.auditFailure(req, challenge.sub, 'too_many_attempts');
      throw new AppException('AUTH_TOKEN_INVALID', 'Too many attempts. Enter your password again');
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: challenge.sub } });
    if (!admin || !admin.isActive || !admin.totpSecretEncrypted) {
      await this.auditFailure(req, challenge.sub, admin && !admin.isActive ? 'account_disabled' : 'invalid_challenge');
      throw invalidCredentials();
    }
    if (!ipAllowed(clientIp(req), admin.ipAllowlist)) {
      await this.auditFailure(req, admin.id, 'ip_not_allowed');
      throw invalidCredentials();
    }

    let step: number | null = null;
    try {
      step = verifyTotp(decryptSecret(admin.totpSecretEncrypted), body.code, { lastUsedStep: admin.totpLastStep });
    } catch {
      this.logger.error('TOTP secret could not be decrypted (check ENCRYPTION_KEY)');
    }
    if (step === null) {
      await this.auditFailure(req, admin.id, 'invalid_totp');
      throw badCode();
    }
    if (!(await this.kv.setNx(chalKeys.used(challenge.jti), '1', CHALLENGE_TTL_SEC))) {
      throw new AppException('AUTH_TOKEN_INVALID', 'This sign-in attempt was already used. Enter your password again');
    }

    const now = new Date();
    const enrolling = !admin.mfaEnabledAt;
    // Replay protection: the step must be newer than the last accepted one (atomic check-and-set).
    const { count } = await this.prisma.platformAdmin.updateMany({
      where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step, lastLoginAt: now, ...(enrolling ? { mfaEnabledAt: now } : {}) },
    });
    if (count !== 1) {
      await this.auditFailure(req, admin.id, 'totp_replay');
      throw badCode();
    }

    const familyId = randomUUID();
    const refreshToken = randomToken(32);
    const expiresAt = new Date(now.getTime() + SUPER_SESSION.absoluteTimeoutSec * 1000);
    await this.prisma.platformSession.create({
      data: { adminId: admin.id, familyId, tokenHash: hashToken(refreshToken), ip: clientIp(req), userAgent: userAgent(req), lastSeenAt: now, expiresAt },
    });
    this.setCookie(res, refreshToken, expiresAt);
    const updated = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: admin.id } });
    await this.audit.platform({ adminId: admin.id }, req, { action: 'auth.login', entityType: 'platform_admin', entityId: admin.id, diff: { mfaEnrolled: enrolling } }, admin.name);
    return this.session(updated, familyId);
  }

  async refresh(req: Request, res: Response): Promise<SuperSession> {
    const raw = (req.cookies as Record<string, unknown> | undefined)?.[SUPER_REFRESH_COOKIE];
    if (typeof raw !== 'string' || !raw) throw new AppException('AUTH_UNAUTHENTICATED', 'Sign in to continue');
    const session = await this.prisma.platformSession.findUnique({ where: { tokenHash: hashToken(raw) }, include: { admin: true } });
    if (!session) {
      this.clearCookie(res);
      throw sessionEnded();
    }
    if (session.revokedAt) {
      await this.revokeFamily(session.familyId);
      if (session.replacedById) {
        // A rotated token presented again is a theft signal; a logged-out one simply ended.
        this.logger.warn(`Platform refresh token reuse: session family ${session.familyId} revoked`);
        await this.audit.platform({ adminId: session.adminId }, req, { action: 'auth.refresh_reuse', entityType: 'platform_session', entityId: session.familyId });
      }
      this.clearCookie(res);
      throw sessionEnded();
    }
    const now = Date.now();
    const timeout = this.timeoutReason(session, now);
    if (timeout) {
      await this.revokeFamily(session.familyId);
      this.clearCookie(res);
      throw new AppException('AUTH_TOKEN_EXPIRED', timeout);
    }
    if (!session.admin.isActive) {
      await this.revokeFamily(session.familyId);
      this.clearCookie(res);
      throw new AppException('AUTH_ACCOUNT_DISABLED', 'This Super Admin account is disabled');
    }
    if (!ipAllowed(clientIp(req), session.admin.ipAllowlist)) throw new AppException('FORBIDDEN', 'Requests from this network are not allowed');

    const nextToken = randomToken(32);
    const rotated = await this.prisma
      .$transaction(async (tx) => {
        const next = await tx.platformSession.create({
          data: {
            adminId: session.adminId,
            familyId: session.familyId,
            tokenHash: hashToken(nextToken),
            ip: clientIp(req),
            userAgent: userAgent(req),
            // Refreshing is not activity: the idle clock and the 12 h limit carry over.
            lastSeenAt: session.lastSeenAt,
            expiresAt: session.expiresAt,
          },
        });
        const { count } = await tx.platformSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date(now), replacedById: next.id } });
        if (count !== 1) throw new Error('refresh-race');
        return true;
      })
      .catch((err: Error) => {
        if (err.message === 'refresh-race') return false;
        throw err;
      });
    if (!rotated) {
      await this.revokeFamily(session.familyId);
      this.clearCookie(res);
      throw sessionEnded();
    }
    this.setCookie(res, nextToken, session.expiresAt);
    return this.session(session.admin, session.familyId);
  }

  async logout(ctx: PlatformAuthContext, req: Request, res: Response): Promise<{ ok: true }> {
    await this.revokeFamily(ctx.sessionId);
    this.clearCookie(res);
    await this.audit.platform(ctx, req, { action: 'auth.logout', entityType: 'platform_session', entityId: ctx.sessionId });
    return { ok: true };
  }

  async me(ctx: PlatformAuthContext): Promise<PlatformAdmin> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: ctx.adminId } });
    if (!admin) throw sessionEnded();
    return toPlatformAdmin(admin);
  }

  /** Guard for `super` routes: verified platform token + live session + IP allowlist. */
  async authenticate(token: string, req: Request): Promise<PlatformAuthContext> {
    const claims = await this.tokens.verifyPlatformAccess(token);
    const session = await this.prisma.platformSession.findFirst({
      where: { familyId: claims.sid, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { admin: { select: { isActive: true, ipAllowlist: true } } },
    });
    if (!session || session.adminId !== claims.sub) throw sessionEnded();
    const now = Date.now();
    const timeout = this.timeoutReason(session, now);
    if (timeout) throw new AppException('AUTH_TOKEN_EXPIRED', timeout);
    if (!session.admin.isActive) throw new AppException('AUTH_ACCOUNT_DISABLED', 'This Super Admin account is disabled');
    if (!ipAllowed(clientIp(req), session.admin.ipAllowlist)) throw new AppException('FORBIDDEN', 'Requests from this network are not allowed');
    if (now - session.lastSeenAt.getTime() > 60_000) {
      await this.prisma.platformSession.updateMany({ where: { id: session.id, lastSeenAt: { lt: new Date(now - 60_000) } }, data: { lastSeenAt: new Date(now) } });
    }
    return { audience: 'platform', adminId: claims.sub, permissions: claims.perms, sessionId: claims.sid };
  }

  private timeoutReason(session: { expiresAt: Date; lastSeenAt: Date }, now: number): string | null {
    if (session.expiresAt.getTime() <= now) return 'Your session reached its 12-hour limit. Sign in again';
    if (session.lastSeenAt.getTime() + SUPER_SESSION.idleTimeoutSec * 1000 <= now) return 'You were signed out after 30 minutes of inactivity';
    return null;
  }

  private session(admin: AdminRow, familyId: string): SuperSession {
    const { token, expiresIn } = this.tokens.signPlatformAccess({ sub: admin.id, role: 'super_admin', perms: platformPermissions(admin.permissions), sid: familyId, mfa: true });
    return { accessToken: token, expiresIn, admin: toPlatformAdmin(admin), idleTimeoutSec: SUPER_SESSION.idleTimeoutSec };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.platformSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private setCookie(res: Response, token: string, expiresAt: Date): void {
    const maxAgeSec = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    res.cookie(SUPER_REFRESH_COOKIE, token, refreshCookieOptions(SUPER_REFRESH_PATH, maxAgeSec));
  }

  private clearCookie(res: Response): void {
    res.clearCookie(SUPER_REFRESH_COOKIE, refreshCookieOptions(SUPER_REFRESH_PATH));
  }
}
