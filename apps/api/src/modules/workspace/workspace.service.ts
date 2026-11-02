import { Injectable, Logger } from '@nestjs/common';
import {
  BusinessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  FEATURE_FLAGS,
  FeatureFlagSchema,
  HexColorSchema,
  HolidaySchema,
  ThemeModeSchema,
  type FeatureFlags,
  type Plan,
  type ThemeMode,
  type Workspace,
  type WorkspaceUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { notFound } from '../../common/errors/app-exception.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../infra/prisma/tenant.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccountStatusService } from '../auth/state/account-status.service.js';
import { SettingsService } from './settings.service.js';
import { actorOf, assertTimeZone, diffOf } from './util.js';

const HolidaysSchema = z.array(HolidaySchema);
const UrlSchema = z.url();

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly status: AccountStatusService,
  ) {}

  /** Effective feature flags = PlanDefinition.features overlaid with FeatureFlagOverride rows. */
  async features(db: TenantPrisma, plan: Plan): Promise<FeatureFlags> {
    const [def, overrides] = await Promise.all([
      this.prisma.planDefinition.findUnique({ where: { key: plan }, select: { features: true } }),
      db.featureFlagOverride.findMany({ select: { flag: true, enabled: true } }),
    ]);
    const flags = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, false])) as FeatureFlags;
    const planFlags = (def?.features ?? {}) as Record<string, unknown>;
    for (const f of FEATURE_FLAGS) if (typeof planFlags[f] === 'boolean') flags[f] = planFlags[f];
    for (const o of overrides) {
      const flag = FeatureFlagSchema.safeParse(o.flag);
      if (flag.success) flags[flag.data] = o.enabled;
    }
    return flags;
  }

  async get(workspaceId: string): Promise<Workspace> {
    const db = this.prisma.forTenant(workspaceId);
    const ws = await db.workspace.findFirst({});
    if (!ws) throw notFound('Workspace');
    const [values, features] = await Promise.all([this.settings.getWorkspaceSettings(db, workspaceId), this.features(db, ws.plan)]);
    const hours = BusinessHoursSchema.safeParse(ws.businessHours);
    const holidays = HolidaysSchema.safeParse(ws.holidays);
    const accent = HexColorSchema.safeParse(ws.accentColor);
    const logo = UrlSchema.safeParse(ws.logoUrl);
    const supportActive = !!ws.supportAccessUntil && ws.supportAccessUntil.getTime() > Date.now();
    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      status: ws.status,
      timezone: ws.timezone,
      currency: 'INR',
      businessHours: hours.success ? hours.data : DEFAULT_BUSINESS_HOURS,
      holidays: holidays.success ? holidays.data : [],
      plan: ws.plan,
      logoUrl: logo.success ? logo.data : null,
      accentColor: accent.success ? accent.data : null,
      defaultTheme: ThemeModeSchema.catch('system').parse(ws.defaultTheme),
      defaultLeadsViewMode: values.defaultLeadsViewMode,
      showEmployeeRank: values.showEmployeeRank,
      defaultInterfaceStyle: values.defaultInterfaceStyle,
      defaultBoardSkin: values.defaultBoardSkin,
      supportAccess: {
        until: supportActive ? ws.supportAccessUntil!.toISOString() : null,
        includeContent: supportActive ? ws.supportAccessContent : false,
      },
      features,
      createdAt: ws.createdAt.toISOString(),
    };
  }

  async update(auth: AuthContext, req: Request, body: WorkspaceUpdate): Promise<Workspace> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    if (body.timezone !== undefined) assertTimeZone(body.timezone);
    const before = await this.get(wid);

    const { defaultLeadsViewMode, showEmployeeRank, defaultInterfaceStyle, defaultBoardSkin, ...columns } = body;
    const data: Prisma.WorkspaceUpdateInput = {};
    if (columns.name !== undefined) data.name = columns.name;
    if (columns.timezone !== undefined) data.timezone = columns.timezone;
    if (columns.businessHours !== undefined) data.businessHours = columns.businessHours;
    if (columns.holidays !== undefined) data.holidays = columns.holidays;
    if (columns.logoUrl !== undefined) data.logoUrl = columns.logoUrl;
    if (columns.accentColor !== undefined) data.accentColor = columns.accentColor;
    if (columns.defaultTheme !== undefined) data.defaultTheme = columns.defaultTheme;

    const ops = [
      ...(Object.keys(data).length ? [db.workspace.update({ where: { id: wid }, data })] : []),
      ...this.settings.workspaceSettingWrites(db, wid, { defaultLeadsViewMode, showEmployeeRank, defaultInterfaceStyle, defaultBoardSkin }),
    ];
    if (ops.length) await db.$transaction(ops);

    const after = await this.get(wid);
    const diff = diffOf(before as unknown as Record<string, unknown>, body as Record<string, unknown>);
    if (Object.keys(diff).length) {
      // Large JSON fields are logged as "changed" only.
      for (const k of ['businessHours', 'holidays'] as const) if (diff[k]) diff[k] = { from: '[changed]', to: '[changed]' };
      await this.audit.record(auth, req, { action: 'workspace.update', entityType: 'workspace', entityId: wid, diff });
    }
    if (body.defaultTheme !== undefined && body.defaultTheme !== before.defaultTheme) await this.publishTheme(auth, body.defaultTheme);
    return after;
  }

  async setTheme(auth: AuthContext, req: Request, mode: ThemeMode): Promise<Workspace> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const current = await db.workspace.findFirst({ select: { defaultTheme: true } });
    if (!current) throw notFound('Workspace');
    if (current.defaultTheme !== mode) {
      await db.workspace.update({ where: { id: wid }, data: { defaultTheme: mode } });
      await this.audit.record(auth, req, { action: 'workspace.theme', entityType: 'workspace', entityId: wid, diff: { defaultTheme: { from: current.defaultTheme, to: mode } } });
      await this.publishTheme(auth, mode);
    }
    return this.get(wid);
  }

  async setSupportAccess(auth: AuthContext, req: Request, body: { enabled: boolean; durationHours: number; includeContent: boolean }): Promise<Workspace> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const until = body.enabled ? new Date(Date.now() + body.durationHours * 3_600_000) : null;
    const includeContent = body.enabled ? body.includeContent : false;
    await db.workspace.update({ where: { id: wid }, data: { supportAccessUntil: until, supportAccessContent: includeContent } });

    if (!body.enabled) {
      // Turning support access off ends any live "View as company" session right away.
      const live = await db.impersonationSession.findMany({ where: { endedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (live.length) {
        await db.impersonationSession.updateMany({ where: { id: { in: live.map((s) => s.id) } }, data: { endedAt: new Date(), endedReason: 'support_access_disabled' } });
        await this.status.invalidateImpersonation(live.map((s) => s.id));
      }
    }
    await this.audit.record(auth, req, {
      action: body.enabled ? 'support_access.enable' : 'support_access.disable',
      entityType: 'workspace',
      entityId: wid,
      diff: { until: until?.toISOString() ?? null, includeContent },
    });
    return this.get(wid);
  }

  private async publishTheme(auth: AuthContext, mode: ThemeMode): Promise<void> {
    try {
      await this.events.publish('theme.changed', auth.workspaceId, { scope: 'workspace', userId: null, mode }, { actor: actorOf(auth) });
    } catch (err) {
      // The change is committed; a lost event only delays other tabs until their next fetch.
      this.logger.error(`theme.changed publish failed: ${(err as Error).message}`);
    }
  }
}
