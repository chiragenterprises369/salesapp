import { Injectable, Logger } from '@nestjs/common';
import { AUTH_LINK_PATHS, EMAIL_VERIFY_TTL_HOURS, PASSWORD_RESET_TTL_MIN, type EmailVerificationStatus, type PasswordResetLookup } from '@vistar/shared';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { hashToken, randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { securityPolicy } from '../config-registry/snapshot.js';
import { PlatformMailerService } from '../mail/platform-mailer.service.js';
import { requireUserId } from '../workspace/users.service.js';
import { clientIp } from './auth.constants.js';
import { hashPassword } from './password.js';
import { SessionService } from './session.service.js';

const linkInvalid = () => new AppException('AUTH_LINK_INVALID', 'This link is invalid, used or expired. Ask for a new one');
/** At most this many reset e-mails per account per hour (the route is also rate limited per IP). */
const RESET_PER_HOUR = 3;
const VERIFY_PER_HOUR = 5;

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

function webOrigin(): string {
  return getEnv().WEB_ORIGIN.split(',')[0]!.trim().replace(/\/+$/, '');
}

/** Password rule of the security policy (on top of PasswordSchema's 8 to 128). */
export function assertPasswordPolicy(password: string | null | undefined, path = 'password'): void {
  if (!password) return;
  const min = securityPolicy().passwordMinLength;
  if (password.length < min) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path, message: `At least ${min} characters` }] });
}

/**
 * ONE-TIME LINKS (change #20): password reset and e-mail verification. Tokens are random (32 bytes), stored as
 * SHA-256 only, single use, short-lived. "Forgot password" always answers 200 so it never reveals whether an
 * account exists. A reset signs out every session of the account.
 */
@Injectable()
export class AccountLinksService {
  private readonly logger = new Logger(AccountLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mailer: PlatformMailerService,
  ) {}

  private async recentCount(userId: string, kind: 'password_reset' | 'email_verify'): Promise<number> {
    return this.prisma.userToken.count({ where: { userId, kind, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  }

  private async issue(user: { id: string; workspaceId: string }, kind: 'password_reset' | 'email_verify', ttlMs: number, ip: string | null): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.prisma.forTenant(user.workspaceId).$transaction(async (tx) => {
      // Older unused links of the same kind stop working.
      await tx.userToken.updateMany({ where: { workspaceId: user.workspaceId, userId: user.id, kind, usedAt: null }, data: { usedAt: new Date() } });
      await tx.userToken.create({ data: { workspaceId: user.workspaceId, userId: user.id, kind, tokenHash: hashToken(token), expiresAt, ip } });
    });
    return { token, expiresAt };
  }

  /** Cross-tenant lookup by the unguessable token hash (the caller is not signed in). */
  private async findValid(token: string, kind: 'password_reset' | 'email_verify') {
    const row = await this.prisma.userToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { id: true, email: true, name: true, isActive: true, deletedAt: true, workspaceId: true } } } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
    if (!row.user.isActive || row.user.deletedAt) return null;
    return row;
  }

  // ---------------------------------------------------------------- password reset

  async forgot(email: string, req: Request): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, workspaceId: true, name: true, email: true, isActive: true, deletedAt: true, workspace: { select: { status: true, deletedAt: true } } } });
    const usable = user && user.isActive && !user.deletedAt && !user.workspace.deletedAt && user.workspace.status !== 'suspended' && user.workspace.status !== 'deleted';
    if (!usable) return { ok: true };
    if ((await this.recentCount(user.id, 'password_reset')) >= RESET_PER_HOUR) return { ok: true };
    const ip = clientIp(req);
    const { token } = await this.issue(user, 'password_reset', PASSWORD_RESET_TTL_MIN * 60_000, ip);
    await this.mailer.sendTemplate('password_reset', user.email, {
      name: user.name,
      link: `${webOrigin()}${AUTH_LINK_PATHS.passwordReset}?token=${encodeURIComponent(token)}`,
      expiresInMinutes: String(PASSWORD_RESET_TTL_MIN),
      ip: ip ?? 'unknown',
    });
    await this.audit.system(user.workspaceId, { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
    return { ok: true };
  }

  async lookup(token: string): Promise<PasswordResetLookup> {
    const row = await this.findValid(token, 'password_reset');
    return { valid: !!row, email: row ? maskEmail(row.user.email) : null, passwordMinLength: securityPolicy().passwordMinLength, expiresAt: row?.expiresAt.toISOString() ?? null };
  }

  async reset(token: string, password: string, req: Request): Promise<{ ok: true }> {
    const row = await this.findValid(token, 'password_reset');
    if (!row) throw linkInvalid();
    assertPasswordPolicy(password);
    const passwordHash = await hashPassword(password);
    const wid = row.user.workspaceId;
    const now = new Date();
    const used = await this.prisma.forTenant(wid).$transaction(async (tx) => {
      const { count } = await tx.userToken.updateMany({ where: { id: row.id, workspaceId: wid, usedAt: null }, data: { usedAt: now } });
      if (count !== 1) return false;
      await tx.user.updateMany({ where: { id: row.userId, workspaceId: wid }, data: { passwordHash, ...(row.user.email ? { emailVerifiedAt: now } : {}) } });
      return true;
    });
    if (!used) throw linkInvalid();
    // Sign out everywhere: a reset after a leaked password must end the attacker's sessions too.
    const families = await this.prisma.forTenant(wid).session.findMany({ where: { userId: row.userId, revokedAt: null }, select: { familyId: true }, distinct: ['familyId'] });
    for (const f of families) await this.sessions.revokeFamily(wid, f.familyId);
    await this.audit.system(wid, { action: 'auth.password_reset', entityType: 'user', entityId: row.userId, diff: { sessionsEnded: families.length, ip: clientIp(req) } });
    return { ok: true };
  }

  // ---------------------------------------------------------------- e-mail verification

  /** Send a verification link (sign-up, link invites, "send again"). Never throws. */
  async sendVerification(userId: string, workspaceId: string, req: Request | null): Promise<void> {
    try {
      const db = this.prisma.forTenant(workspaceId);
      const user = await db.user.findFirst({ where: { id: userId }, select: { id: true, workspaceId: true, email: true, name: true, emailVerifiedAt: true } });
      if (!user || user.emailVerifiedAt) return;
      if ((await this.recentCount(user.id, 'email_verify')) >= VERIFY_PER_HOUR) return;
      const ws = await db.workspace.findFirst({ select: { name: true } });
      const { token } = await this.issue(user, 'email_verify', EMAIL_VERIFY_TTL_HOURS * 3_600_000, clientIp(req));
      await this.mailer.sendTemplate('email_verify', user.email, { name: user.name, workspace: ws?.name ?? '', link: `${webOrigin()}${AUTH_LINK_PATHS.emailVerify}?token=${encodeURIComponent(token)}` });
    } catch (err) {
      this.logger.error(`Verification e-mail failed: ${(err as Error).name}`);
    }
  }

  async verify(token: string): Promise<{ ok: true }> {
    const row = await this.findValid(token, 'email_verify');
    if (!row) throw linkInvalid();
    const wid = row.user.workspaceId;
    const now = new Date();
    await this.prisma.forTenant(wid).$transaction(async (tx) => {
      await tx.userToken.updateMany({ where: { id: row.id, workspaceId: wid, usedAt: null }, data: { usedAt: now } });
      await tx.user.updateMany({ where: { id: row.userId, workspaceId: wid, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    });
    await this.audit.system(wid, { action: 'auth.email_verified', entityType: 'user', entityId: row.userId });
    return { ok: true };
  }

  async status(auth: AuthContext): Promise<EmailVerificationStatus> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const userId = requireUserId(auth);
    const [user, last] = await Promise.all([
      db.user.findFirst({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      db.userToken.findFirst({ where: { userId, kind: 'email_verify' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return { verified: !!user?.emailVerifiedAt, verifiedAt: user?.emailVerifiedAt?.toISOString() ?? null, sentAt: last?.createdAt.toISOString() ?? null };
  }

  async resend(auth: AuthContext, req: Request): Promise<EmailVerificationStatus> {
    if (auth.impersonation) throw new AppException('FORBIDDEN', 'Not available while viewing as the company');
    await this.sendVerification(requireUserId(auth), auth.workspaceId, req);
    return this.status(auth);
  }
}
