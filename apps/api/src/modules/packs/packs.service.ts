import { Injectable, Logger } from '@nestjs/common';
import {
  buildPackRuntime,
  compareSemver,
  conflictsOf,
  CorePackError,
  describeOp,
  isEntitled,
  manifestSummary,
  PackActionSchema,
  PackConflictSchema,
  planPackInstall,
  planPackUninstall,
  runtimeForPermissions,
  summarizeOps,
  writeOps,
  type EventActor,
  type PackInstallLog,
  type PackInstallResult,
  type PackListItem,
  type PackOp,
  type PackPlanResponse,
  type PackRuntime,
} from '@vistar/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, conflict, notFound } from '../../common/errors/app-exception.js';
import { iso } from '../../common/mappers/user.mapper.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { readLabelOverrides } from '../customization/labels.store.js';
import { publishSafe, requestActor } from '../leads/lib/context.js';
import { workspacePackEntries, type WorkspacePackEntry } from './pack-entitlement.js';
import { installInput, installPack, loadPackState, packContext, uninstallPack, type PackActor, type PackRunResult } from './pack-installer.js';
import { loadManifest } from './pack-registry.js';

const INSTALLED_STATUSES = new Set(['active', 'uninstalled', 'failed']);
const LOG_LIMIT = 100;

/** Company admin side of Industry Packs (Settings > Industry) and the runtime extension points. */
@Injectable()
export class PacksService {
  private readonly logger = new Logger(PacksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** One registry pack as the company admin sees it. */
  async toListItem(entry: WorkspacePackEntry): Promise<PackListItem> {
    const { def, row, entitlement } = entry;
    const latest = await loadManifest(this.prisma, def.key, def.latestVersion);
    const installed = row && INSTALLED_STATUSES.has(row.status) ? (row.status as PackListItem['status']) : null;
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      industry: def.industry,
      icon: def.icon,
      core: def.core,
      latestVersion: def.latestVersion,
      installedVersion: row?.installedVersion ?? null,
      status: installed ?? (isEntitled(entitlement) ? 'available' : 'locked'),
      entitlement,
      modes: latest.modes,
      enabledModes: row?.installedVersion ? [...row.modes] : [],
      upgradeAvailable: row?.status === 'active' && !!row.installedVersion && compareSemver(def.latestVersion, row.installedVersion) > 0,
      summary: manifestSummary(latest),
      lastError: row?.lastError ?? null,
      installedAt: iso(row?.installedAt),
    };
  }

  async list(auth: AuthContext): Promise<{ items: PackListItem[] }> {
    const entries = await workspacePackEntries(this.prisma, auth.workspaceId);
    return { items: await Promise.all(entries.map((e) => this.toListItem(e))) };
  }

  private async item(workspaceId: string, key: string): Promise<PackListItem> {
    const entry = (await workspacePackEntries(this.prisma, workspaceId)).find((e) => e.def.key === key);
    if (!entry) throw notFound('Pack');
    return this.toListItem(entry);
  }

  /** Runtime extension points of ACTIVE and ENTITLED packs, filtered by the caller's permissions. */
  async runtime(auth: AuthContext): Promise<PackRuntime> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const entries = (await workspacePackEntries(this.prisma, wid)).filter((e) => e.row?.status === 'active' && !!e.row.installedVersion && isEntitled(e.entitlement));
    const [packs, labelOverrides, objects] = await Promise.all([
      Promise.all(entries.map(async (e) => ({ manifest: await loadManifest(this.prisma, e.def.key, e.row!.installedVersion!), modes: [...e.row!.modes] }))),
      readLabelOverrides(db, wid),
      db.customObject.findMany({ where: { archivedAt: null }, orderBy: [{ labelPlural: 'asc' }, { key: 'asc' }] }),
    ]);
    const rt = buildPackRuntime({
      packs,
      labelOverrides,
      objects: objects.map((o) => ({ key: o.key, labelSingular: o.labelSingular, labelPlural: o.labelPlural, icon: o.icon, showInNav: o.showInNav, packKey: o.packKey })),
    });
    return runtimeForPermissions(rt, auth.permissions);
  }

  /** Dry run: nothing is written. */
  async plan(auth: AuthContext, key: string, q: { action: 'install' | 'upgrade' | 'uninstall'; modes?: string[] }): Promise<PackPlanResponse> {
    const ctx = await packContext(this.prisma, auth.workspaceId, key);
    const state = await loadPackState(ctx.db);
    const row = ctx.row;
    let ops: PackOp[];
    let fromVersion = row?.installedVersion ?? null;
    let toVersion: string | null;
    let modes: string[];
    let unchanged: boolean;
    if (q.action === 'uninstall') {
      if (ctx.def.core) throw new AppException('PACK_CORE_LOCKED', `${ctx.def.name} is a core pack and cannot be uninstalled`);
      const manifest = await loadManifest(this.prisma, key, row?.installedVersion ?? ctx.def.latestVersion);
      try {
        ops = planPackUninstall(state, manifest);
      } catch (err) {
        if (err instanceof CorePackError) throw new AppException('PACK_CORE_LOCKED', `${ctx.def.name} is a core pack and cannot be uninstalled`);
        throw err;
      }
      toVersion = null;
      modes = row ? [...row.modes] : [];
      unchanged = row?.status === 'uninstalled' || !row?.installedVersion;
    } else {
      if (q.action === 'upgrade' && !row?.installedVersion) throw conflict('Install the pack before upgrading it');
      const input = await installInput(this.prisma, ctx, { action: q.action, modes: q.modes });
      ops = planPackInstall(state, input.manifest, { modes: input.modes, previous: input.previous, previousModes: input.previousModes, reinstall: input.reinstall });
      fromVersion = row?.installedVersion ?? null;
      toVersion = input.manifest.version;
      modes = input.modes;
      unchanged = row?.status === 'active' && row.installedVersion === toVersion && row.modes.length === modes.length && row.modes.every((m) => modes.includes(m));
    }
    const writes = writeOps(ops);
    return {
      packKey: key,
      action: q.action,
      fromVersion,
      toVersion,
      modes,
      summary: summarizeOps(ops),
      changes: writes.map((op) => ({ op: op.op, label: describeOp(op) })),
      conflicts: conflictsOf(ops),
      noop: writes.length === 0 && unchanged,
    };
  }

  private async actors(auth: AuthContext): Promise<{ pack: PackActor; event: EventActor; name: string | null }> {
    const actor = await requestActor(this.prisma.forTenant(auth.workspaceId), auth);
    const type = auth.impersonation ? 'super_admin' : auth.via === 'api_key' ? 'api_key' : 'user';
    const name = actor.summary?.name ?? null;
    return { pack: { type, id: auth.userId, name }, event: actor.event, name };
  }

  /** Audit + events after commit (only when something changed). */
  private async after(auth: AuthContext, req: Request, result: PackRunResult, actor: { event: EventActor; name: string | null }): Promise<PackInstallResult> {
    const wid = auth.workspaceId;
    if (!result.noop) {
      await this.audit.record(
        auth,
        req,
        { action: `pack.${result.action}`, entityType: 'pack', entityId: result.packKey, diff: { fromVersion: result.fromVersion, toVersion: result.toVersion, modes: result.modes, summary: result.summary } },
        actor.name,
      );
      if (result.action === 'uninstall') {
        await publishSafe(this.events, this.logger, 'pack.uninstalled', wid, { packKey: result.packKey, version: result.fromVersion }, { actor: actor.event });
      } else {
        const action = result.action === 'upgrade' || result.action === 'sync' ? result.action : 'install';
        await publishSafe(
          this.events,
          this.logger,
          'pack.installed',
          wid,
          { packKey: result.packKey, version: result.toVersion ?? '', modes: result.modes, action, summary: result.summary },
          { actor: actor.event },
        );
      }
      await publishSafe(this.events, this.logger, 'customization.changed', wid, { scope: 'packs', target: result.packKey }, { actor: actor.event });
    }
    return { pack: await this.item(wid, result.packKey), summary: result.summary, conflicts: result.conflicts, noop: result.noop, logId: result.logId };
  }

  private readonly onError = (message: string) => this.logger.error(message);

  async install(auth: AuthContext, req: Request, key: string, body: { modes?: string[] }): Promise<PackInstallResult> {
    const actor = await this.actors(auth);
    const result = await installPack(this.prisma, auth.workspaceId, key, { action: 'install', modes: body.modes, actor: actor.pack, onError: this.onError });
    return this.after(auth, req, result, actor);
  }

  async upgrade(auth: AuthContext, req: Request, key: string): Promise<PackInstallResult> {
    const ctx = await packContext(this.prisma, auth.workspaceId, key);
    if (ctx.row?.status !== 'active' || !ctx.row.installedVersion) throw conflict('Install the pack before upgrading it');
    const actor = await this.actors(auth);
    const result = await installPack(this.prisma, auth.workspaceId, key, { action: 'upgrade', actor: actor.pack, onError: this.onError });
    return this.after(auth, req, result, actor);
  }

  async uninstall(auth: AuthContext, req: Request, key: string): Promise<PackInstallResult> {
    const actor = await this.actors(auth);
    const result = await uninstallPack(this.prisma, auth.workspaceId, key, { actor: actor.pack, onError: this.onError });
    return this.after(auth, req, result, actor);
  }

  async log(auth: AuthContext, key: string): Promise<{ items: PackInstallLog[] }> {
    if (!(await this.prisma.packDefinition.count({ where: { key } }))) throw notFound('Pack');
    const rows = await this.prisma.forTenant(auth.workspaceId).packInstallLog.findMany({ where: { packKey: key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LOG_LIMIT });
    const counts = z.record(z.string(), z.number().int());
    const conflicts = z.array(PackConflictSchema);
    return {
      items: rows.map((r) => {
        const summary = counts.safeParse(r.summary);
        const c = conflicts.safeParse(r.conflicts);
        const action = PackActionSchema.safeParse(r.action);
        return {
          id: r.id,
          packKey: r.packKey,
          action: action.success ? action.data : 'install',
          fromVersion: r.fromVersion,
          toVersion: r.toVersion,
          modes: r.modes,
          status: r.status === 'success' || r.status === 'noop' ? r.status : 'failed',
          summary: summary.success ? summary.data : {},
          conflicts: c.success ? c.data : [],
          error: r.error,
          actorName: r.actorName,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    };
  }
}
