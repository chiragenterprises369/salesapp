import { Injectable } from '@nestjs/common';
import {
  LeadsViewModeSchema,
  SavedViewSchema,
  type SavedView,
  type SavedViewCreate,
  type Tag,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { forbidden, notFound } from '../../common/errors/app-exception.js';
import { Prisma, type SavedView as SavedViewRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/**
 * Saved views and the tag catalogue. (Custom field definitions live in the customization module.)
 * SavedView has no viewMode column yet: it is stored inside `filters` under `viewMode` (see CONTRACT-REQUEST).
 */
@Injectable()
export class LeadMetaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private toView(v: SavedViewRow): SavedView {
    const json = (v.filters ?? {}) as Record<string, unknown>;
    const filters = SavedViewSchema.shape.filters.safeParse(json);
    const viewMode = LeadsViewModeSchema.safeParse(json.viewMode);
    return {
      id: v.id,
      name: v.name,
      entity: 'lead',
      filters: filters.success ? filters.data : {},
      columns: v.columns,
      viewMode: viewMode.success ? viewMode.data : null,
      isShared: v.isShared,
      ownerId: v.ownerId,
    };
  }

  private visibleViews(auth: AuthContext): Prisma.SavedViewWhereInput {
    return { entity: 'lead', OR: [{ isShared: true }, ...(auth.userId ? [{ ownerId: auth.userId }] : [])] };
  }

  async listViews(auth: AuthContext): Promise<{ items: SavedView[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).savedView.findMany({ where: this.visibleViews(auth), orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return { items: rows.map((v) => this.toView(v)) };
  }

  async createView(auth: AuthContext, body: SavedViewCreate): Promise<SavedView> {
    const row = await this.prisma.forTenant(auth.workspaceId).savedView.create({
      data: {
        workspaceId: auth.workspaceId,
        ownerId: auth.userId,
        name: body.name.trim().slice(0, 80) || 'Untitled view',
        entity: 'lead',
        filters: { ...body.filters, viewMode: body.viewMode } as Prisma.InputJsonObject,
        columns: body.columns,
        isShared: body.isShared,
      },
    });
    return this.toView(row);
  }

  /** Owners delete their views; company admins may also delete shared views. */
  async deleteView(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const view = await db.savedView.findFirst({ where: { id, ...this.visibleViews(auth) } });
    if (!view) throw notFound('Saved view');
    if (view.ownerId !== auth.userId && auth.kind !== 'company_admin') throw forbidden('Only the owner can delete this view');
    await db.savedView.deleteMany({ where: { id } });
    return { ok: true };
  }

  /** Tag catalogue with usage counts over the leads the caller can see. Tags used on leads are added to the catalogue. */
  async listTags(auth: AuthContext): Promise<{ items: Tag[] }> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const visible = await this.scope.visibleUserIds(auth);
    // Raw SQL is not tenant-scoped automatically: filter by workspaceId explicitly.
    const usage = await this.prisma.$queryRaw<Array<{ name: string; count: number }>>`
      SELECT t AS name, COUNT(*)::int AS count
      FROM "Lead" l, unnest(l.tags) AS t
      WHERE l."workspaceId" = ${wid}::uuid AND l."deletedAt" IS NULL
      ${visible ? Prisma.sql`AND l."ownerId" = ANY(${visible}::uuid[])` : Prisma.empty}
      GROUP BY t`;
    const counts = new Map(usage.map((u) => [u.name, u.count]));
    let tags = await db.tag.findMany();
    const known = new Set(tags.map((t) => t.name));
    const missing = usage.map((u) => u.name).filter((n) => !known.has(n));
    if (missing.length) {
      await db.tag.createMany({ data: missing.map((name) => ({ workspaceId: wid, name })), skipDuplicates: true });
      tags = await db.tag.findMany();
    }
    const items = tags
      .map((t) => ({ id: t.id, name: t.name, color: t.color, usageCount: counts.get(t.name) ?? 0 }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
    return { items };
  }
}
