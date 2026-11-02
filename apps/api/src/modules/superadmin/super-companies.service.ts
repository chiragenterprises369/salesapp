import { Injectable } from '@nestjs/common';
import {
  FEATURE_FLAGS,
  FeatureFlagSchema,
  type Company,
  type CompanyCreated,
  type CompanyCreateSchema,
  type CompanyListQuerySchema,
  type FeatureFlag,
  type FeatureFlags,
  type Page,
  type Plan,
  type WorkspaceStatus,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { getEnv } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { InviteService } from '../auth/invite.service.js';
import { WorkspaceProvisioner } from '../auth/workspace-provisioner.js';
import { afterTimeCursor, encodeCursor } from '../leads/lib/cursor.js';

type CompanyListQuery = z.output<typeof CompanyListQuerySchema>;
type CompanyCreateBody = z.output<typeof CompanyCreateSchema>;

const ADMIN_INVITE_DAYS = 7;

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  plan: Plan;
  trialEndsAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

const WORKSPACE_SELECT = { id: true, name: true, slug: true, status: true, plan: true, trialEndsAt: true, createdAt: true, deletedAt: true } as const;

/** Current usage period (YYYY-MM, India time like the usage counters). */
function currentPeriod(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Super Admin companies (SPEC 29.4, 29.6; D-060): list and detail with effective flags, custom domain and floor
 * progress, create a company with an admin invite, and the per-company switches (custom_domain, field_tracking and
 * every other flag) as FeatureFlagOverride rows. Cross-tenant reads use the root client and are batched per page;
 * writes into a company go through its tenant client. Every change is audited in PlatformAuditLog and the
 * company's AuditLog.
 */
@Injectable()
export class SuperCompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioner: WorkspaceProvisioner,
    private readonly invites: InviteService,
    private readonly audit: AuditService,
  ) {}

  private async adminName(adminId: string): Promise<string | null> {
    return (await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { name: true } }))?.name ?? null;
  }

  /** Batch mapping for a page of workspaces (one query per aspect, not per company). */
  private async toCompanies(rows: WorkspaceRow[]): Promise<Company[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const period = currentPeriod();
    const [plans, overrides, seats, leads, counters, files, lastSeen, owners, pendingOwners, domains, requests, floors] = await Promise.all([
      this.prisma.planDefinition.findMany({ select: { key: true, priceInrMonthly: true, features: true } }),
      this.prisma.featureFlagOverride.findMany({ where: { workspaceId: { in: ids } }, select: { workspaceId: true, flag: true, enabled: true } }),
      this.prisma.user.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, isActive: true, deletedAt: null }, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
      this.prisma.usageCounter.findMany({ where: { workspaceId: { in: ids }, period }, select: { workspaceId: true, metric: true, value: true } }),
      this.prisma.file.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids }, deletedAt: null }, _sum: { size: true } }),
      this.prisma.user.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: ids } }, _max: { lastSeenAt: true } }),
      this.prisma.user.findMany({ where: { workspaceId: { in: ids }, deletedAt: null, role: { kind: 'company_admin' } }, orderBy: { createdAt: 'asc' }, select: { workspaceId: true, email: true } }),
      this.prisma.invite.findMany({
        where: { workspaceId: { in: ids }, acceptedAt: null, revokedAt: null, email: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { workspaceId: true, email: true, roleId: true },
      }),
      this.prisma.customDomain.findMany({ where: { workspaceId: { in: ids } }, select: { workspaceId: true, hostname: true, status: true } }),
      this.prisma.floorRequest.findMany({ where: { workspaceId: { in: ids } }, orderBy: { submittedAt: 'desc' }, distinct: ['workspaceId'], select: { workspaceId: true, status: true } }),
      this.prisma.floorAsset.findMany({ where: { workspaceId: { in: ids }, status: 'published' }, orderBy: { version: 'desc' }, distinct: ['workspaceId'], select: { workspaceId: true, version: true } }),
    ]);
    const adminRoles = new Set(
      (await this.prisma.role.findMany({ where: { workspaceId: { in: ids }, kind: 'company_admin' }, select: { id: true } })).map((r) => r.id),
    );
    const planByKey = new Map(plans.map((p) => [p.key, p]));
    const first = <T extends { workspaceId: string }>(list: T[]) => {
      const m = new Map<string, T>();
      for (const x of list) if (!m.has(x.workspaceId)) m.set(x.workspaceId, x);
      return m;
    };
    const ownerBy = first(owners);
    const pendingBy = first(pendingOwners.filter((i) => adminRoles.has(i.roleId)));
    const seatsBy = new Map(seats.map((s) => [s.workspaceId, s._count._all]));
    const leadsBy = new Map(leads.map((s) => [s.workspaceId, s._count._all]));
    const filesBy = new Map(files.map((s) => [s.workspaceId, s._sum.size ?? 0]));
    const seenBy = new Map(lastSeen.map((s) => [s.workspaceId, s._max.lastSeenAt]));
    const domainBy = new Map(domains.map((d) => [d.workspaceId, d]));
    const requestBy = new Map(requests.map((r) => [r.workspaceId, r.status]));
    const floorBy = new Map(floors.map((f) => [f.workspaceId, f.version]));

    return rows.map((ws) => {
      const plan = planByKey.get(ws.plan);
      const own = overrides.filter((o) => o.workspaceId === ws.id);
      const flagOverrides: Partial<Record<FeatureFlag, boolean>> = {};
      for (const o of own) {
        const f = FeatureFlagSchema.safeParse(o.flag);
        if (f.success) flagOverrides[f.data] = o.enabled;
      }
      const planFlags = (plan?.features ?? {}) as Record<string, unknown>;
      const features = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, flagOverrides[f] ?? (typeof planFlags[f] === 'boolean' ? planFlags[f] : false)])) as FeatureFlags;
      const counter = (metric: string) => counters.find((c) => c.workspaceId === ws.id && c.metric === metric)?.value ?? 0;
      const status: WorkspaceStatus = ws.deletedAt ? 'deleted' : ws.status;
      const domain = domainBy.get(ws.id);
      const userCount = seatsBy.get(ws.id) ?? 0;
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        status,
        plan: ws.plan,
        trialEndsAt: ws.trialEndsAt?.toISOString() ?? null,
        mrrInr: status === 'active' ? (plan?.priceInrMonthly ?? 0) : 0,
        usage: {
          period: currentPeriod(),
          seats: userCount,
          leads: leadsBy.get(ws.id) ?? 0,
          whatsappMessages: counter('whatsapp_messages'),
          workflowRuns: counter('workflow_runs'),
          storageMb: Math.max(counter('storage_mb'), Math.ceil((filesBy.get(ws.id) ?? 0) / (1024 * 1024))),
        },
        flagOverrides,
        ownerEmail: ownerBy.get(ws.id)?.email ?? pendingBy.get(ws.id)?.email ?? null,
        lastActiveAt: seenBy.get(ws.id)?.toISOString() ?? null,
        createdAt: ws.createdAt.toISOString(),
        features,
        customDomain: domain ? { hostname: domain.hostname, status: domain.status } : null,
        floor: { requestStatus: requestBy.get(ws.id) ?? null, publishedVersion: floorBy.get(ws.id) ?? null },
        userCount,
      };
    });
  }

  async list(query: CompanyListQuery): Promise<Page<Company>> {
    const q = query.q?.trim();
    const where: Prisma.WorkspaceWhereInput = {
      ...(query.status === 'deleted' ? { OR: [{ status: 'deleted' }, { deletedAt: { not: null } }] } : query.status ? { status: query.status, deletedAt: null } : { deletedAt: null }),
      ...(query.plan ? { plan: query.plan } : {}),
    };
    const and: Prisma.WorkspaceWhereInput[] = [where];
    if (q) and.push({ OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] });
    const after = afterTimeCursor(query.cursor);
    if (Object.keys(after).length) and.push(after as Prisma.WorkspaceWhereInput);
    const rows = await this.prisma.workspace.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, select: WORKSPACE_SELECT });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return { items: await this.toCompanies(page), nextCursor: rows.length > query.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null };
  }

  private async row(id: string): Promise<WorkspaceRow> {
    const ws = await this.prisma.workspace.findUnique({ where: { id }, select: WORKSPACE_SELECT });
    if (!ws) throw notFound('Company');
    return ws;
  }

  async get(id: string): Promise<Company> {
    return (await this.toCompanies([await this.row(id)]))[0]!;
  }

  /**
   * New company on the chosen plan (trial when trialDays > 0) with system roles, the default pipeline and the core
   * pack, plus a company_admin invite for adminEmail. The invite link is returned once: always outside production;
   * in production too, because no invite email is sent yet (`emailed: false`).
   */
  async create(admin: PlatformAuthContext, req: Request, body: CompanyCreateBody): Promise<CompanyCreated> {
    const email = body.adminEmail.toLowerCase();
    if (await this.prisma.user.count({ where: { email } })) throw new AppException('AUTH_EMAIL_TAKEN', 'A Vistar account with this email already exists. Use another email for the company admin');
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: body.timezone });
    } catch {
      throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path: 'timezone', message: 'Unknown time zone' }] });
    }
    const tenant = await this.provisioner.provisionCompany({ name: body.name, plan: body.plan, timezone: body.timezone, trialDays: body.trialDays });
    const invite = await this.invites.createPlatformInvite(tenant.workspaceId, { email, roleId: tenant.adminRoleId, expiresInDays: ADMIN_INVITE_DAYS });
    const name = await this.adminName(admin.adminId);
    await this.audit.platform(
      admin,
      req,
      {
        action: 'company.create',
        entityType: 'workspace',
        entityId: tenant.workspaceId,
        workspaceId: tenant.workspaceId,
        diff: { name: body.name, plan: body.plan, trialDays: body.trialDays, timezone: body.timezone, adminEmail: email, inviteId: invite.id },
      },
      name,
    );
    const company = await this.get(tenant.workspaceId);
    const emailed = false;
    const showLink = getEnv().NODE_ENV !== 'production' || !emailed;
    return { ...company, adminInvite: { email, url: showLink ? invite.url : null, expiresAt: invite.expiresAt.toISOString(), emailed } };
  }

  /** Switches: `true|false` sets an override, `null` removes it (back to the plan). Unchanged values write nothing. */
  async setFlags(admin: PlatformAuthContext, req: Request, id: string, body: { overrides: Partial<Record<FeatureFlag, boolean | null>> }): Promise<Company> {
    const ws = await this.row(id);
    if (ws.deletedAt) throw notFound('Company');
    const db = this.prisma.forTenant(id);
    const before = new Map((await db.featureFlagOverride.findMany({ select: { flag: true, enabled: true } })).map((o) => [o.flag, o.enabled]));
    const diff: Record<string, { from: boolean | null; to: boolean | null }> = {};
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const [flag, value] of Object.entries(body.overrides) as Array<[FeatureFlag, boolean | null | undefined]>) {
      if (value === undefined) continue;
      const from = before.get(flag) ?? null;
      if (from === value) continue;
      diff[flag] = { from, to: value };
      ops.push(
        value === null
          ? db.featureFlagOverride.deleteMany({ where: { flag } })
          : db.featureFlagOverride.upsert({
              where: { workspaceId_flag: { workspaceId: id, flag } },
              create: { workspaceId: id, flag, enabled: value, setById: admin.adminId },
              update: { enabled: value, setById: admin.adminId },
            }),
      );
    }
    if (ops.length) {
      await this.prisma.$transaction(ops);
      await this.audit.platform(admin, req, { action: 'company.flags', entityType: 'workspace', entityId: id, workspaceId: id, diff }, await this.adminName(admin.adminId));
    }
    return this.get(id);
  }
}
