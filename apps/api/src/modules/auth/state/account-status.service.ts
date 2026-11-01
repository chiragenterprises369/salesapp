import { Injectable } from '@nestjs/common';
import type { WorkspaceStatus } from '@vistar/shared';
import { PrismaService } from '../../../infra/prisma/prisma.service.js';
import { ACCESS_TTL_SEC } from '../auth.constants.js';
import { KvStore } from './kv.store.js';

/** How long the guard trusts a cached user/workspace status (seconds). */
const STATUS_CACHE_TTL_SEC = 30;

const keys = {
  user: (userId: string) => `vistar:auth:user:${userId}`,
  workspace: (workspaceId: string) => `vistar:auth:ws:${workspaceId}`,
  revoked: (familyId: string) => `vistar:auth:revoked:${familyId}`,
  impersonation: (sessionId: string) => `vistar:auth:imp:${sessionId}`,
};

export interface UserStatus {
  active: boolean;
  roleId: string;
}

export interface ImpersonationStatus {
  active: boolean;
  adminId: string;
  readOnly: boolean;
  contentAccess: boolean;
  expiresAt: number;
}

export interface AccountSnapshot {
  /** null = no such user in this workspace (or soft-deleted). */
  user: UserStatus | null;
  /** null = no such workspace. */
  workspaceStatus: WorkspaceStatus | null;
  /** The session family was revoked (logout, refresh reuse, deactivation). */
  revoked: boolean;
}

function parse<T>(raw: string | null | undefined): T | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * Short-lived cache of the facts the auth guard re-checks on every request (user active, current
 * role, workspace status, revoked session families, impersonation session state). Redis-backed
 * with an in-memory fallback. Invalidate after changing any of them.
 */
@Injectable()
export class AccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvStore,
  ) {}

  async snapshot(workspaceId: string, userId: string, familyId: string | null): Promise<AccountSnapshot> {
    const lookup = [keys.user(userId), keys.workspace(workspaceId), ...(familyId ? [keys.revoked(familyId)] : [])];
    const [userRaw, wsRaw, revokedRaw] = await this.kv.mget(lookup);
    let user = parse<UserStatus | null>(userRaw);
    let ws = parse<{ status: WorkspaceStatus | null }>(wsRaw);
    const db = this.prisma.forTenant(workspaceId);

    if (user === undefined) {
      const row = await db.user.findFirst({ where: { id: userId }, select: { isActive: true, deletedAt: true, roleId: true } });
      user = row && !row.deletedAt ? { active: row.isActive, roleId: row.roleId } : null;
      await this.kv.set(keys.user(userId), JSON.stringify(user), STATUS_CACHE_TTL_SEC);
    }
    if (ws === undefined) {
      const row = await db.workspace.findFirst({ select: { status: true, deletedAt: true } });
      ws = { status: row ? (row.deletedAt ? 'deleted' : row.status) : null };
      await this.kv.set(keys.workspace(workspaceId), JSON.stringify(ws), STATUS_CACHE_TTL_SEC);
    }
    return { user, workspaceStatus: ws.status, revoked: revokedRaw === '1' };
  }

  async workspaceStatus(workspaceId: string): Promise<WorkspaceStatus | null> {
    const cached = parse<{ status: WorkspaceStatus | null }>(await this.kv.get(keys.workspace(workspaceId)));
    if (cached) return cached.status;
    const row = await this.prisma.forTenant(workspaceId).workspace.findFirst({ select: { status: true, deletedAt: true } });
    const status: WorkspaceStatus | null = row ? (row.deletedAt ? 'deleted' : row.status) : null;
    await this.kv.set(keys.workspace(workspaceId), JSON.stringify({ status }), STATUS_CACHE_TTL_SEC);
    return status;
  }

  async impersonation(workspaceId: string, sessionId: string): Promise<ImpersonationStatus | null> {
    const cached = parse<ImpersonationStatus | null>(await this.kv.get(keys.impersonation(sessionId)));
    let status: ImpersonationStatus | null;
    if (cached !== undefined) {
      status = cached;
    } else {
      const row = await this.prisma
        .forTenant(workspaceId)
        .impersonationSession.findFirst({ where: { id: sessionId }, select: { adminId: true, readOnly: true, contentAccess: true, expiresAt: true, endedAt: true } });
      status = row
        ? { active: !row.endedAt, adminId: row.adminId, readOnly: row.readOnly, contentAccess: row.contentAccess, expiresAt: row.expiresAt.getTime() }
        : null;
      await this.kv.set(keys.impersonation(sessionId), JSON.stringify(status), STATUS_CACHE_TTL_SEC);
    }
    if (status && status.expiresAt <= Date.now()) return { ...status, active: false };
    return status;
  }

  /** Reject access tokens of this session family until they expire on their own. */
  async markFamilyRevoked(familyId: string): Promise<void> {
    await this.kv.set(keys.revoked(familyId), '1', ACCESS_TTL_SEC() + 60);
  }

  /** Revoke every refresh session of a user (deactivation) and their live access tokens. */
  async revokeAllForUser(workspaceId: string, userId: string): Promise<void> {
    const db = this.prisma.forTenant(workspaceId);
    const live = await db.session.findMany({ where: { userId, revokedAt: null }, select: { familyId: true } });
    await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await Promise.all([...new Set(live.map((s) => s.familyId))].map((f) => this.markFamilyRevoked(f)));
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.kv.del(keys.user(userId));
  }

  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await this.kv.del(keys.workspace(workspaceId));
  }

  async invalidateImpersonation(sessionIds: string[]): Promise<void> {
    await this.kv.del(...sessionIds.map(keys.impersonation));
  }
}
