import { Injectable } from '@nestjs/common';
import { LOCKED_ADMIN_PERMISSIONS, SYSTEM_ROLE_KEYS, type Role, type RoleCreate, type RoleKind, type RoleUpdateSchema } from '@vistar/shared';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException, conflict, forbidden, notFound } from '../../common/errors/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../infra/prisma/tenant.js';
import { ROLE_MEMBER_COUNT, toRole, validPermissions } from './mappers.js';
import { slugify } from './util.js';

export type RoleUpdate = z.infer<typeof RoleUpdateSchema>;

/** A role that can still administer the workspace (lock-out guard). */
export function isAdminCapable(role: { kind: RoleKind; permissions: readonly string[] }): boolean {
  return role.kind === 'company_admin' && LOCKED_ADMIN_PERMISSIONS.every((p) => role.permissions.includes(p));
}

/** Active users (optionally excluding one user and/or one role) whose role is admin-capable. */
export function countActiveAdmins(db: TenantPrisma, exclude: { userId?: string; roleId?: string } = {}): Promise<number> {
  return db.user.count({
    where: {
      isActive: true,
      deletedAt: null,
      ...(exclude.userId ? { id: { not: exclude.userId } } : {}),
      role: {
        kind: 'company_admin',
        permissions: { hasEvery: LOCKED_ADMIN_PERMISSIONS },
        ...(exclude.roleId ? { id: { not: exclude.roleId } } : {}),
      },
    },
  });
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(workspaceId: string, roleId: string): Promise<Role> {
    const role = await this.prisma.forTenant(workspaceId).role.findFirst({ where: { id: roleId }, include: ROLE_MEMBER_COUNT });
    if (!role) throw notFound('Role');
    return toRole(role);
  }

  async list(auth: AuthContext): Promise<{ items: Role[] }> {
    const rows = await this.prisma
      .forTenant(auth.workspaceId)
      .role.findMany({ include: ROLE_MEMBER_COUNT, orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }] });
    return { items: rows.map(toRole) };
  }

  async create(auth: AuthContext, req: Request, body: RoleCreate): Promise<Role> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const key = slugify(body.name, '_', 40) || `role_${randomBytes(3).toString('hex')}`;
    const taken = await db.role.count({ where: { OR: [{ key }, { name: { equals: body.name, mode: 'insensitive' } }] } });
    if (taken) throw conflict('A role with this name already exists. Choose another name');
    const permissions = validPermissions(body.permissions);
    const role = await db.role.create({
      data: { workspaceId: auth.workspaceId, key, name: body.name, kind: body.kind, dataScope: body.dataScope, permissions, isSystem: false },
      include: ROLE_MEMBER_COUNT,
    });
    await this.audit.record(auth, req, {
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      diff: { name: body.name, kind: body.kind, dataScope: body.dataScope, permissions },
    });
    return toRole(role);
  }

  async update(auth: AuthContext, req: Request, id: string, body: RoleUpdate): Promise<Role> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const role = await db.role.findFirst({ where: { id }, include: ROLE_MEMBER_COUNT });
    if (!role) throw notFound('Role');

    if (role.isSystem && body.kind !== undefined && body.kind !== role.kind) throw forbidden('The kind of a system role cannot change');
    const nextPermissions = body.permissions !== undefined ? validPermissions(body.permissions) : validPermissions(role.permissions);
    const nextKind = body.kind ?? role.kind;
    if (role.isSystem && role.key === SYSTEM_ROLE_KEYS.company_admin && !LOCKED_ADMIN_PERMISSIONS.every((p) => nextPermissions.includes(p))) {
      throw forbidden('The Company admin role must keep role, team and settings management');
    }
    if (body.name !== undefined && body.name.toLowerCase() !== role.name.toLowerCase()) {
      const clash = await db.role.count({ where: { id: { not: id }, name: { equals: body.name, mode: 'insensitive' } } });
      if (clash) throw conflict('A role with this name already exists. Choose another name');
    }
    // Lock-out guard: removing admin capability from this role must leave another active admin.
    if (isAdminCapable(role) && !isAdminCapable({ kind: nextKind, permissions: nextPermissions })) {
      const members = await db.user.count({ where: { roleId: id, isActive: true, deletedAt: null } });
      if (members > 0 && (await countActiveAdmins(db, { roleId: id })) === 0) {
        throw conflict('Keep at least one active company admin. Give another member full admin access first');
      }
    }

    const updated = await db.role.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.dataScope !== undefined ? { dataScope: body.dataScope } : {}),
        ...(body.permissions !== undefined ? { permissions: nextPermissions } : {}),
      },
      include: ROLE_MEMBER_COUNT,
    });

    const before = new Set(role.permissions);
    const after = new Set(updated.permissions);
    const diff: Record<string, unknown> = {};
    if (updated.name !== role.name) diff.name = { from: role.name, to: updated.name };
    if (updated.kind !== role.kind) diff.kind = { from: role.kind, to: updated.kind };
    if (updated.dataScope !== role.dataScope) diff.dataScope = { from: role.dataScope, to: updated.dataScope };
    const added = [...after].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !after.has(p));
    if (added.length || removed.length) diff.permissions = { added, removed };
    if (Object.keys(diff).length) await this.audit.record(auth, req, { action: 'role.update', entityType: 'role', entityId: id, diff });
    return toRole(updated);
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const role = await db.role.findFirst({ where: { id } });
    if (!role) throw notFound('Role');
    if (role.isSystem) throw forbidden('System roles cannot be deleted');
    // Soft-deleted users still reference the role (foreign key), so they count too.
    const members = await db.user.count({ where: { roleId: id } });
    if (members > 0) throw new AppException('CONFLICT', 'Move this role’s members to another role first');
    await db.$transaction([
      db.invite.updateMany({ where: { roleId: id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      db.role.delete({ where: { id } }),
    ]);
    await this.audit.record(auth, req, { action: 'role.delete', entityType: 'role', entityId: id, diff: { name: role.name, kind: role.kind } });
    return { ok: true };
  }
}
