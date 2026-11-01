import { Injectable, Logger } from '@nestjs/common';
import {
  isEntitled,
  manifestSummary,
  packEntitlement,
  PLANS,
  type PackCompanyUsage,
  type PackOverride,
  type PackUsage,
  type Plan,
  type SuperPack,
  type SuperPackVersion,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import type { WorkspacePack } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe } from '../leads/lib/context.js';
import { parseOverride } from './pack-entitlement.js';
import { loadManifest } from './pack-registry.js';

const coreLocked = (name: string) => new AppException('PACK_CORE_LOCKED', `${name} is a core pack: it is included in every plan and cannot be granted or revoked`);
const PLATFORM_ACTOR = (adminId: string, name: string | null) => ({ type: 'system' as const, id: adminId, name: name ?? 'Vistar support' });

/**
 * Super Admin pack registry (/api/super/packs). Registry and plan entitlements are platform tables (root
 * client). Per-company overrides live in the tenant table WorkspacePack (written with the company's tenant client).
 */
@Injectable()
export class SuperPacksService {
  private readonly logger = new Logger(SuperPacksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  private async definition(key: string) {
    const def = await this.prisma.packDefinition.findUnique({
      where: { key },
      include: { versions: { select: { version: true, checksum: true, createdAt: true }, orderBy: { createdAt: 'asc' } }, entitlements: { select: { plan: true } } },
    });
    if (!def) throw notFound('Pack');
    return def;
  }

  private async adminName(adminId: string): Promise<string | null> {
    return (await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { name: true } }))?.name ?? null;
  }

  private async toSuperPack(def: Awaited<ReturnType<SuperPacksService['definition']>>, installs: { active: number; total: number }): Promise<SuperPack> {
    const latest = await loadManifest(this.prisma, def.key, def.latestVersion);
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      industry: def.industry,
      icon: def.icon,
      core: def.core,
      latestVersion: def.latestVersion,
      versions: def.versions.map((v) => ({ version: v.version, checksum: v.checksum, createdAt: v.createdAt.toISOString() })),
      plans: def.core ? [...PLANS] : PLANS.filter((p) => def.entitlements.some((e) => e.plan === p)),
      priceInrMonthly: def.priceInrMonthly,
      installs,
      summary: manifestSummary(latest),
    };
  }

  /** Install counts per pack across companies (cross-tenant aggregate for the platform). */
  private async installCounts(): Promise<Map<string, { active: number; total: number }>> {
    const groups = await this.prisma.workspacePack.groupBy({ by: ['packKey', 'status'], where: { installedVersion: { not: null } }, _count: { _all: true } });
    const out = new Map<string, { active: number; total: number }>();
    for (const g of groups) {
      const c = out.get(g.packKey) ?? { active: 0, total: 0 };
      c.total += g._count._all;
      if (g.status === 'active') c.active += g._count._all;
      out.set(g.packKey, c);
    }
    return out;
  }

  async list(): Promise<{ items: SuperPack[] }> {
    const defs = await this.prisma.packDefinition.findMany({
      include: { versions: { select: { version: true, checksum: true, createdAt: true }, orderBy: { createdAt: 'asc' } }, entitlements: { select: { plan: true } } },
      orderBy: [{ core: 'desc' }, { name: 'asc' }],
    });
    const counts = await this.installCounts();
    return { items: await Promise.all(defs.map((d) => this.toSuperPack(d, counts.get(d.key) ?? { active: 0, total: 0 }))) };
  }

  async version(key: string, version: string): Promise<SuperPackVersion> {
    const row = await this.prisma.packVersion.findFirst({ where: { version, pack: { key } }, select: { checksum: true, createdAt: true } });
    if (!row) throw notFound('Pack version');
    const manifest = await loadManifest(this.prisma, key, version);
    return { key, version, checksum: row.checksum, createdAt: row.createdAt.toISOString(), manifest, summary: manifestSummary(manifest) };
  }

  /** Replace the plans that include a pack (and optionally its add-on price). Core packs are in every plan. */
  async updatePlans(admin: PlatformAuthContext, req: Request, key: string, body: { plans: Plan[]; priceInrMonthly?: number | null }): Promise<SuperPack> {
    const def = await this.definition(key);
    if (def.core) throw coreLocked(def.name);
    const plans = [...new Set(body.plans)];
    const before = def.entitlements.map((e) => e.plan);
    await this.prisma.$transaction([
      this.prisma.packPlanEntitlement.deleteMany({ where: { packId: def.id, plan: { notIn: plans } } }),
      this.prisma.packPlanEntitlement.createMany({ data: plans.map((plan) => ({ packId: def.id, plan })), skipDuplicates: true }),
      ...(body.priceInrMonthly !== undefined ? [this.prisma.packDefinition.update({ where: { id: def.id }, data: { priceInrMonthly: body.priceInrMonthly } })] : []),
    ]);
    await this.audit.platform(
      admin,
      req,
      { action: 'pack.plans_update', entityType: 'pack', entityId: key, diff: { plans: { from: before, to: plans }, ...(body.priceInrMonthly !== undefined ? { priceInrMonthly: { from: def.priceInrMonthly, to: body.priceInrMonthly } } : {}) } },
      await this.adminName(admin.adminId),
    );
    // Companies with the pack active may gain or lose it in their runtime.
    const active = await this.prisma.workspacePack.findMany({ where: { packKey: key, status: 'active' }, select: { workspaceId: true } });
    for (const { workspaceId } of active) await publishSafe(this.events, this.logger, 'customization.changed', workspaceId, { scope: 'packs', target: key });
    const fresh = await this.definition(key);
    return this.toSuperPack(fresh, (await this.installCounts()).get(key) ?? { active: 0, total: 0 });
  }

  private usageOf(
    ws: { id: string; name: string; plan: Plan },
    def: { core: boolean; entitlements: Array<{ plan: Plan }> },
    row: WorkspacePack | null | undefined,
    recordCount: number,
  ): PackCompanyUsage {
    const override = parseOverride(row?.platformOverride);
    const status = row && ['active', 'uninstalled', 'failed'].includes(row.status) ? (row.status as PackCompanyUsage['status']) : 'not_installed';
    return {
      workspaceId: ws.id,
      name: ws.name,
      plan: ws.plan,
      override,
      entitlement: packEntitlement({ core: def.core, plan: ws.plan, plans: def.entitlements.map((e) => e.plan), override }),
      status,
      installedVersion: row?.installedVersion ?? null,
      modes: row?.installedVersion ? [...row.modes] : [],
      recordCount,
    };
  }

  private async recordCounts(key: string, workspaceIds?: string[]): Promise<Map<string, number>> {
    const groups = await this.prisma.customRecord.groupBy({
      by: ['workspaceId'],
      where: { deletedAt: null, object: { packKey: key }, ...(workspaceIds ? { workspaceId: { in: workspaceIds } } : {}) },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.workspaceId, g._count._all]));
  }

  /** Grant / revoke (or clear) a pack for one company. Reason required; audit in PlatformAuditLog and the company AuditLog. */
  async updateCompany(admin: PlatformAuthContext, req: Request, key: string, workspaceId: string, body: { override: PackOverride | null; reason: string }): Promise<PackCompanyUsage> {
    const def = await this.definition(key);
    if (def.core) throw coreLocked(def.name);
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, plan: true, deletedAt: true } });
    if (!ws || ws.deletedAt) throw notFound('Company');
    const db = this.prisma.forTenant(workspaceId);
    const before = await db.workspacePack.findUnique({ where: { workspaceId_packKey: { workspaceId, packKey: key } } });
    const row = await db.workspacePack.upsert({
      where: { workspaceId_packKey: { workspaceId, packKey: key } },
      create: { workspaceId, packKey: key, status: 'not_installed', platformOverride: body.override, overrideReason: body.reason },
      update: { platformOverride: body.override, overrideReason: body.reason },
    });
    const name = await this.adminName(admin.adminId);
    await this.audit.platform(
      admin,
      req,
      { action: 'pack.entitlement', entityType: 'pack', entityId: key, workspaceId, reason: body.reason, diff: { override: { from: parseOverride(before?.platformOverride), to: body.override } } },
      name,
    );
    await publishSafe(this.events, this.logger, 'customization.changed', workspaceId, { scope: 'packs', target: key }, { actor: PLATFORM_ACTOR(admin.adminId, name) });
    const counts = await this.recordCounts(key, [workspaceId]);
    return this.usageOf(ws, def, row, counts.get(workspaceId) ?? 0);
  }

  async usage(key: string): Promise<PackUsage> {
    const def = await this.definition(key);
    const [workspaces, rows, counts] = await Promise.all([
      this.prisma.workspace.findMany({ where: { deletedAt: null }, select: { id: true, name: true, plan: true }, orderBy: { name: 'asc' } }),
      this.prisma.workspacePack.findMany({ where: { packKey: key } }),
      this.recordCounts(key),
    ]);
    const byWs = new Map(rows.map((r) => [r.workspaceId, r]));
    const companies = workspaces.map((ws) => this.usageOf(ws, def, byWs.get(ws.id), counts.get(ws.id) ?? 0));
    return {
      key,
      totals: {
        entitled: companies.filter((c) => isEntitled(c.entitlement)).length,
        active: companies.filter((c) => c.status === 'active').length,
        records: companies.reduce((n, c) => n + c.recordCount, 0),
      },
      companies,
    };
  }
}
