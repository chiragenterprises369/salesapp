import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthContext } from './auth-context.js';

/**
 * DATA SCOPE (contract). Apply to every list/detail/aggregate on owned records:
 *   Lead.ownerId, Task.assigneeId, Call.userId, Conversation.assigneeId (and dashboard/report/floor queries).
 *
 *   const where = { ...filters, ...(await this.scope.where(auth, 'ownerId')) };
 *
 * own  -> field = auth.userId
 * team -> field IN (auth.userId + members of teams managed by auth.userId)
 * all  -> no extra filter
 */
@Injectable()
export class ScopeService {
  /** Per-request cache keyed by the AuthContext object. */
  private readonly cache = new WeakMap<AuthContext, Promise<string[]>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Users visible to the caller for owned records; null = everyone in the workspace. */
  async visibleUserIds(auth: AuthContext): Promise<string[] | null> {
    if (auth.dataScope === 'all' || auth.via === 'api_key') return null;
    if (!auth.userId) return [];
    if (auth.dataScope === 'own') return [auth.userId];
    let pending = this.cache.get(auth);
    if (!pending) {
      pending = this.prisma
        .forTenant(auth.workspaceId)
        .user.findMany({ where: { team: { managerId: auth.userId } }, select: { id: true } })
        .then((rows) => [...new Set([auth.userId as string, ...rows.map((r) => r.id)])]);
      this.cache.set(auth, pending);
    }
    return pending;
  }

  /** Prisma `where` fragment for an owner-like field. */
  async where(auth: AuthContext, field: 'ownerId' | 'assigneeId' | 'userId'): Promise<Record<string, unknown>> {
    const ids = await this.visibleUserIds(auth);
    if (ids === null) return {};
    return ids.length === 1 ? { [field]: ids[0] } : { [field]: { in: ids } };
  }

  /** True if the caller may see a record owned by `ownerId` (null owner = only for scope all). */
  async canSee(auth: AuthContext, ownerId: string | null): Promise<boolean> {
    const ids = await this.visibleUserIds(auth);
    if (ids === null) return true;
    return ownerId !== null && ids.includes(ownerId);
  }
}
