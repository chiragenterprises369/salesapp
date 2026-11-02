import { Injectable } from '@nestjs/common';
import type { User, UserSummary, UserUpdate } from '@vistar/shared';
import type { Request } from 'express';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException, conflict, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { AccountStatusService } from '../auth/state/account-status.service.js';
import { toUser, USER_SELECT } from './mappers.js';
import { countActiveAdmins, isAdminCapable } from './roles.service.js';

type ProfileUpdate = Pick<UserUpdate, 'name' | 'phone' | 'title' | 'avatar'>;

export function requireUserId(auth: AuthContext): string {
  if (!auth.userId) throw new AppException('FORBIDDEN', 'This action needs a signed-in user');
  return auth.userId;
}

const jsonOrNull = (v: unknown) => (v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/**
 * Team members. The employee status control (PUT /me/status) moved to the realtime stream's presence
 * engine in change #19 (D-062).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly status: AccountStatusService,
  ) {}

  async get(workspaceId: string, userId: string): Promise<User> {
    const row = await this.prisma.forTenant(workspaceId).user.findFirst({ where: { id: userId, deletedAt: null }, select: USER_SELECT });
    if (!row) throw notFound('User');
    return toUser(row);
  }

  async list(auth: AuthContext, query: { q?: string; teamId?: string }, includeInactive: boolean): Promise<{ items: User[] }> {
    const q = query.q?.trim();
    const rows = await this.prisma.forTenant(auth.workspaceId).user.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      select: USER_SELECT,
      orderBy: { name: 'asc' },
      take: 500,
    });
    return { items: rows.map(toUser) };
  }

  /** Pickers (owner dropdown, reassign): active users inside the caller's data scope. */
  async options(auth: AuthContext, q?: string): Promise<{ items: UserSummary[] }> {
    const ids = await this.scope.visibleUserIds(auth);
    const term = q?.trim();
    const rows = await this.prisma.forTenant(auth.workspaceId).user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        ...(ids ? { id: { in: ids } } : {}),
        ...(term ? { name: { contains: term, mode: 'insensitive' } } : {}),
      },
      select: USER_SUMMARY_SELECT,
      orderBy: { name: 'asc' },
      take: 200,
    });
    return { items: rows.map((r) => toUserSummary(r)) };
  }

  async update(auth: AuthContext, req: Request, id: string, body: UserUpdate): Promise<User> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const target = await db.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...USER_SELECT, role: { select: { kind: true, name: true, permissions: true } } },
    });
    if (!target) throw notFound('User');
    await assertInTenant(db, { role: body.roleId, team: body.teamId });

    const roleChanged = body.roleId !== undefined && body.roleId !== target.roleId;
    const nextRole = roleChanged ? await db.role.findFirst({ where: { id: body.roleId }, select: { kind: true, permissions: true } }) : target.role;
    if (!nextRole) throw notFound('Role');
    const nextActive = body.isActive ?? target.isActive;
    if (target.isActive && isAdminCapable(target.role) && !(nextActive && isAdminCapable(nextRole))) {
      if ((await countActiveAdmins(db, { userId: id })) === 0) {
        throw conflict('Keep at least one active company admin. Make someone else an admin first');
      }
    }

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.title !== undefined) data.title = body.title;
    if (body.teamId !== undefined) data.teamId = body.teamId;
    if (body.roleId !== undefined) data.roleId = body.roleId;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.workingHours !== undefined) data.workingHours = jsonOrNull(body.workingHours);
    if (body.avatar !== undefined) data.avatar = jsonOrNull(body.avatar);
    if (body.isFieldStaff !== undefined) data.isFieldStaff = body.isFieldStaff;
    const updated = await db.user.update({ where: { id }, data, select: USER_SELECT });

    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (roleChanged) diff.roleId = { from: target.roleId, to: updated.roleId };
    if (body.teamId !== undefined && body.teamId !== target.teamId) diff.teamId = { from: target.teamId, to: updated.teamId };
    if (body.isActive !== undefined && body.isActive !== target.isActive) diff.isActive = { from: target.isActive, to: updated.isActive };
    if (body.isFieldStaff !== undefined && body.isFieldStaff !== target.isFieldStaff) diff.isFieldStaff = { from: target.isFieldStaff, to: updated.isFieldStaff };
    if (Object.keys(diff).length) {
      const action = diff.isActive
        ? updated.isActive ? 'user.activate' : 'user.deactivate'
        : diff.roleId ? 'user.role_change' : diff.teamId ? 'user.team_change' : 'user.field_staff_change';
      await this.audit.record(auth, req, { action, entityType: 'user', entityId: id, diff });
    }
    if (diff.isActive && !updated.isActive) await this.status.revokeAllForUser(auth.workspaceId, id);
    if (diff.isActive || diff.roleId) await this.status.invalidateUser(id);
    return toUser(updated);
  }

  async updateProfile(auth: AuthContext, body: ProfileUpdate): Promise<User> {
    const userId = requireUserId(auth);
    const data: Prisma.UserUncheckedUpdateInput = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.phone !== undefined) data.phone = body.phone;
    if (body.title !== undefined) data.title = body.title;
    if (body.avatar !== undefined) data.avatar = jsonOrNull(body.avatar);
    const db = this.prisma.forTenant(auth.workspaceId);
    if (!Object.keys(data).length) return this.get(auth.workspaceId, userId);
    const updated = await db.user.update({ where: { id: userId }, data, select: USER_SELECT });
    return toUser(updated);
  }
}
