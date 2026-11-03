import { Injectable } from '@nestjs/common';
import { type Page, type PlatformAuditLog, type SetupChecklist, type SuperCompanyUser } from '@vistar/shared';
import { notFound } from '../../common/errors/app-exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { afterTimeCursor, nextTimeCursor } from '../leads/lib/cursor.js';
import { SetupService } from '../setup/setup.service.js';

/** Max users returned for one company (the Users tab is a support view, not a directory export). */
const USERS_MAX = 500;

/**
 * SUPER ADMIN COMPANY DETAIL (change #20, requests 1, 2 and 4 of CONFIG-WEB): the users tab (no phone numbers,
 * nothing beyond name and e-mail), the platform audit log with company and action filters, and the company's
 * setup checklist. Read-only.
 */
@Injectable()
export class SuperCompanyDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly setup: SetupService,
  ) {}

  private async assertCompany(id: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true } });
    if (!ws) throw notFound('Company');
  }

  async users(id: string): Promise<{ items: SuperCompanyUser[] }> {
    await this.assertCompany(id);
    const rows = await this.prisma.forTenant(id).user.findMany({
      where: { deletedAt: null },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      take: USERS_MAX,
      select: { id: true, name: true, email: true, isActive: true, lastSeenAt: true, createdAt: true, role: { select: { name: true, kind: true } }, _count: { select: { devices: true } } },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        roleName: u.role?.name ?? null,
        roleKind: u.role?.kind ?? null,
        isActive: u.isActive,
        lastActiveAt: u.lastSeenAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        devices: u._count.devices,
      })),
    };
  }

  async setupChecklist(id: string): Promise<SetupChecklist> {
    await this.assertCompany(id);
    return this.setup.checklistFor(id, null);
  }

  /**
   * GET /api/super/audit-logs: newest first, keyset cursor over (createdAt, id). `workspaceId` = one company;
   * `action` = exact action, or a prefix when it ends with "." or "*" (e.g. `config.email.` or `company.*`).
   */
  async auditList(q: { cursor?: string; limit: number; workspaceId?: string; action?: string }): Promise<Page<PlatformAuditLog>> {
    const and: Prisma.PlatformAuditLogWhereInput[] = [];
    if (q.workspaceId) and.push({ workspaceId: q.workspaceId });
    const action = q.action?.trim();
    if (action) {
      const prefix = action.endsWith('*') ? action.slice(0, -1) : action.endsWith('.') ? action : null;
      and.push(prefix !== null ? { action: { startsWith: prefix } } : { action });
    }
    const after = afterTimeCursor(q.cursor);
    if (Object.keys(after).length) and.push(after as Prisma.PlatformAuditLogWhereInput);
    const rows = await this.prisma.platformAuditLog.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    return {
      items: rows.slice(0, q.limit).map((r) => ({
        id: r.id,
        adminId: r.adminId,
        adminName: r.adminName,
        action: r.action,
        workspaceId: r.workspaceId,
        entityType: r.entityType,
        entityId: r.entityId,
        reason: r.reason,
        diff: r.diff && typeof r.diff === 'object' && !Array.isArray(r.diff) ? (r.diff as Record<string, unknown>) : null,
        ip: r.ip,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: nextTimeCursor(rows, q.limit),
    };
  }
}
