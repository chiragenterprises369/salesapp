import { Injectable } from '@nestjs/common';
import type { Invite, InviteCreate } from '@vistar/shared';
import type { Request, Response } from 'express';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException, conflict, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import { hashToken, randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { AUTH_USER_SELECT, authContextFromClaims, SessionService, type AuthSession } from './session.service.js';
import { hashPassword } from './password.js';

const inviteInvalid = () => new AppException('AUTH_INVITE_INVALID', 'This invite link is invalid or has expired. Ask your admin for a new one');

/** Identity of the person accepting an invite (password form or verified Google account). */
export interface InviteAcceptIdentity {
  email: string | null;
  name: string;
  /** Plain password from the form; hashed only after the invite checks pass. */
  password: string | null;
  googleSub: string | null;
}

function webOrigin(): string {
  return getEnv().WEB_ORIGIN.split(',')[0]!.trim().replace(/\/+$/, '');
}

@Injectable()
export class InviteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  private toInvite(row: { id: string; email: string | null; roleId: string; expiresAt: Date; acceptedAt: Date | null; createdAt: Date }, roleName: string, url?: string): Invite {
    return {
      id: row.id,
      email: row.email,
      roleId: row.roleId,
      roleName,
      ...(url ? { url } : {}),
      expiresAt: row.expiresAt.toISOString(),
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async create(auth: AuthContext, req: Request, body: InviteCreate): Promise<Invite> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    await assertInTenant(db, { role: body.roleId, team: body.teamId });
    const role = await db.role.findFirstOrThrow({ where: { id: body.roleId }, select: { name: true } });
    const email = body.email?.toLowerCase() ?? null;
    if (email && (await db.user.count({ where: { email, deletedAt: null } }))) {
      throw conflict('This person is already a member of your workspace');
    }

    const token = randomToken(32);
    const now = new Date();
    const invite = await db.$transaction(async (tx) => {
      // One live invite per email: a new invite replaces older pending ones.
      if (email) await tx.invite.updateMany({ where: { workspaceId: wid, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
      return tx.invite.create({
        data: {
          workspaceId: wid,
          email,
          roleId: body.roleId,
          teamId: body.teamId ?? null,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + body.expiresInDays * 86_400_000),
          createdById: auth.userId,
        },
      });
    });
    await this.audit.record(auth, req, {
      action: 'invite.create',
      entityType: 'invite',
      entityId: invite.id,
      diff: { email, roleId: body.roleId, teamId: body.teamId ?? null, expiresAt: invite.expiresAt.toISOString() },
    });
    return this.toInvite(invite, role.name, `${webOrigin()}/invite/${token}`);
  }

  async list(auth: AuthContext): Promise<{ items: Invite[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.invite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const roles = await db.role.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.roleId))] } }, select: { id: true, name: true } });
    const roleName = new Map(roles.map((r) => [r.id, r.name]));
    return { items: rows.map((r) => this.toInvite(r, roleName.get(r.roleId) ?? 'Deleted role')) };
  }

  async revoke(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const invite = await db.invite.findFirst({ where: { id } });
    if (!invite || invite.revokedAt) throw notFound('Invite');
    if (invite.acceptedAt) throw conflict('This invite was already accepted');
    await db.invite.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record(auth, req, { action: 'invite.revoke', entityType: 'invite', entityId: id, diff: { email: invite.email } });
    return { ok: true };
  }

  /** Public: what the invite page shows before the person accepts. */
  async lookup(token: string): Promise<{ workspaceName: string; email: string | null; roleName: string }> {
    const invite = await this.findValid(token);
    const role = await this.prisma.forTenant(invite.workspaceId).role.findFirst({ where: { id: invite.roleId }, select: { name: true } });
    if (!role) throw inviteInvalid();
    return { workspaceName: invite.workspace.name, email: invite.email, roleName: role.name };
  }

  /** Create the account from an invite and start a session (password form or Google). */
  async accept(token: string, identity: InviteAcceptIdentity, req: Request, res: Response): Promise<AuthSession> {
    const invite = await this.findValid(token);
    const wid = invite.workspaceId;
    const db = this.prisma.forTenant(wid);
    const givenEmail = identity.email?.toLowerCase() ?? null;
    if (invite.email && givenEmail && givenEmail !== invite.email.toLowerCase()) {
      throw new AppException('AUTH_INVITE_INVALID', 'This invite was sent to a different email address');
    }
    const email = invite.email?.toLowerCase() ?? givenEmail;
    if (!email) {
      throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path: 'email', message: 'Enter your work email to join with this link' }] });
    }
    if (await this.prisma.user.count({ where: { email } })) {
      throw new AppException('AUTH_EMAIL_TAKEN', 'An account with this email already exists. Sign in instead');
    }
    const role = await db.role.findFirst({ where: { id: invite.roleId }, select: { id: true } });
    if (!role) throw inviteInvalid();
    const teamId = invite.teamId && (await db.team.count({ where: { id: invite.teamId } })) ? invite.teamId : null;
    const passwordHash = identity.password ? await hashPassword(identity.password) : null;

    const now = new Date();
    const userId = await this.prisma
      .$transaction(async (tx) => {
        const { count } = await tx.invite.updateMany({
          where: { id: invite.id, workspaceId: wid, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { acceptedAt: now },
        });
        if (count !== 1) throw new Error('invite-race');
        const user = await tx.user.create({
          data: { workspaceId: wid, email, name: identity.name, passwordHash, googleSub: identity.googleSub, roleId: role.id, teamId, status: 'offline' },
          select: { id: true },
        });
        return user.id;
      })
      .catch((err: { message?: string; code?: string }) => {
        if (err.message === 'invite-race') throw inviteInvalid();
        if (err.code === 'P2002') throw new AppException('AUTH_EMAIL_TAKEN', 'An account with this email already exists. Sign in instead');
        throw err;
      });

    const user = await db.user.findFirstOrThrow({ where: { id: userId }, select: AUTH_USER_SELECT });
    this.sessions.assertCanSignIn(user);
    const session = await this.sessions.start(user, req, res);
    const auth = authContextFromClaims(this.sessions.claimsFor(user, 'invite'));
    await this.audit.record(auth, req, { action: 'invite.accept', entityType: 'invite', entityId: invite.id, diff: { userId, roleId: role.id, teamId } }, user.name);
    return session;
  }

  /** Cross-tenant lookup by the unguessable token hash (the caller is not signed in yet). */
  private async findValid(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { workspace: { select: { name: true, status: true, deletedAt: true } } },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) throw inviteInvalid();
    if (invite.workspace.deletedAt || invite.workspace.status === 'suspended' || invite.workspace.status === 'deleted') throw inviteInvalid();
    return invite;
  }
}
