import { Injectable } from '@nestjs/common';
import {
  BoardSkinSchema,
  ComponentStyleSchema,
  DEFAULT_USER_SETTINGS,
  InterfaceStyleSchema,
  LeadsViewModeSchema,
  SETTING_KEYS,
  UserSettingsSchema,
  type BoardSkin,
  type ComponentStyle,
  type InterfaceStyle,
  type LeadsViewMode,
  type UserSettings,
  type UserSettingsUpdate,
} from '@vistar/shared';
import { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { TenantPrisma } from '../../infra/prisma/tenant.js';

type UserSettingField = keyof typeof SETTING_KEYS.user;
const USER_FIELDS = Object.keys(SETTING_KEYS.user) as UserSettingField[];
const USER_KEY_VALUES: string[] = Object.values(SETTING_KEYS.user);

/** Workspace-level values that are Setting rows (not Workspace columns). */
export interface WorkspaceSettingValues {
  defaultLeadsViewMode: LeadsViewMode | null;
  showEmployeeRank: boolean;
  defaultInterfaceStyle: InterfaceStyle;
  defaultBoardSkin: BoardSkin;
  componentStyle: ComponentStyle;
}
const WORKSPACE_DEFAULTS: WorkspaceSettingValues = {
  defaultLeadsViewMode: null,
  showEmployeeRank: true,
  defaultInterfaceStyle: 'classic',
  defaultBoardSkin: 'depth',
  componentStyle: 'standard',
};

function settingWhere(workspaceId: string, scope: 'user' | 'workspace', scopeId: string, key: string) {
  return { workspaceId_scope_scopeId_key: { workspaceId, scope, scopeId, key } } as const;
}

/**
 * Setting rows (one per key):
 * - user scope (scopeId = userId): SETTING_KEYS.user, merged over DEFAULT_USER_SETTINGS.
 * - workspace scope (scopeId = workspaceId): SETTING_KEYS.workspace for non-column Workspace fields.
 * Invalid stored values fall back to the default for that key, so responses always match the contract.
 */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserSettings(workspaceId: string, userId: string): Promise<UserSettings> {
    const rows = await this.prisma
      .forTenant(workspaceId)
      .setting.findMany({ where: { scope: 'user', scopeId: userId, key: { in: USER_KEY_VALUES } }, select: { key: true, value: true } });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const out = { ...DEFAULT_USER_SETTINGS } as Record<UserSettingField, unknown>;
    for (const field of USER_FIELDS) {
      const key = SETTING_KEYS.user[field];
      if (!byKey.has(key)) continue;
      const parsed = (UserSettingsSchema.shape[field] as z.ZodType).safeParse(byKey.get(key));
      if (parsed.success) out[field] = parsed.data;
    }
    return out as UserSettings;
  }

  /**
   * PATCH semantics: only fields present in the patch change; `theme` and `notifications` are
   * deep-merged. Returns the full settings and the list of fields that actually changed.
   */
  async updateUserSettings(workspaceId: string, userId: string, patch: UserSettingsUpdate): Promise<{ settings: UserSettings; changed: UserSettingField[] }> {
    const db = this.prisma.forTenant(workspaceId);
    const current = await this.getUserSettings(workspaceId, userId);
    const next: UserSettings = {
      ...current,
      ...(patch.theme ? { theme: { ...current.theme, ...patch.theme } } : {}),
      ...(patch.notifications ? { notifications: { ...current.notifications, ...patch.notifications } } : {}),
      ...(patch.teamFloorMode !== undefined ? { teamFloorMode: patch.teamFloorMode } : {}),
      ...(patch.reducedMotion !== undefined ? { reducedMotion: patch.reducedMotion } : {}),
      ...(patch.leadsViewMode !== undefined ? { leadsViewMode: patch.leadsViewMode } : {}),
      ...(patch.interfaceStyle !== undefined ? { interfaceStyle: patch.interfaceStyle } : {}),
      ...(patch.motionIntensity !== undefined ? { motionIntensity: patch.motionIntensity } : {}),
      ...(patch.boardSkin !== undefined ? { boardSkin: patch.boardSkin } : {}),
      ...(patch.celebrations !== undefined ? { celebrations: patch.celebrations } : {}),
    };
    const settings = UserSettingsSchema.parse(next);
    const changed = USER_FIELDS.filter((f) => patch[f] !== undefined && JSON.stringify(current[f]) !== JSON.stringify(settings[f]));
    if (changed.length) {
      await db.$transaction(
        changed.map((field) => {
          const key = SETTING_KEYS.user[field];
          const value = settings[field];
          // null (leadsViewMode, interfaceStyle, boardSkin, celebrations) = back to the default: drop the row.
          if (value === null) return db.setting.deleteMany({ where: { scope: 'user', scopeId: userId, key } });
          return db.setting.upsert({
            where: settingWhere(workspaceId, 'user', userId, key),
            create: { workspaceId, scope: 'user', scopeId: userId, key, value: value as Prisma.InputJsonValue },
            update: { value: value as Prisma.InputJsonValue },
          });
        }),
      );
    }
    return { settings, changed };
  }

  async getWorkspaceSettings(db: TenantPrisma, workspaceId: string): Promise<WorkspaceSettingValues> {
    const keys = [
      SETTING_KEYS.workspace.defaultLeadsViewMode,
      SETTING_KEYS.workspace.showEmployeeRank,
      SETTING_KEYS.workspace.defaultInterfaceStyle,
      SETTING_KEYS.workspace.defaultBoardSkin,
      SETTING_KEYS.workspace.componentStyle,
    ];
    const rows = await db.setting.findMany({ where: { scope: 'workspace', scopeId: workspaceId, key: { in: keys } }, select: { key: true, value: true } });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const view = LeadsViewModeSchema.safeParse(byKey.get(SETTING_KEYS.workspace.defaultLeadsViewMode));
    const rank = z.boolean().safeParse(byKey.get(SETTING_KEYS.workspace.showEmployeeRank));
    const style = InterfaceStyleSchema.safeParse(byKey.get(SETTING_KEYS.workspace.defaultInterfaceStyle));
    const skin = BoardSkinSchema.safeParse(byKey.get(SETTING_KEYS.workspace.defaultBoardSkin));
    const componentStyle = ComponentStyleSchema.safeParse(byKey.get(SETTING_KEYS.workspace.componentStyle));
    return {
      defaultLeadsViewMode: view.success ? view.data : WORKSPACE_DEFAULTS.defaultLeadsViewMode,
      showEmployeeRank: rank.success ? rank.data : WORKSPACE_DEFAULTS.showEmployeeRank,
      defaultInterfaceStyle: style.success ? style.data : WORKSPACE_DEFAULTS.defaultInterfaceStyle,
      defaultBoardSkin: skin.success ? skin.data : WORKSPACE_DEFAULTS.defaultBoardSkin,
      componentStyle: componentStyle.success ? componentStyle.data : WORKSPACE_DEFAULTS.componentStyle,
    };
  }

  /** Write operations for workspace Setting rows (run inside the caller's batch transaction). */
  workspaceSettingWrites(db: TenantPrisma, workspaceId: string, values: Partial<WorkspaceSettingValues>) {
    const upsert = (key: string, value: Prisma.InputJsonValue) =>
      db.setting.upsert({
        where: settingWhere(workspaceId, 'workspace', workspaceId, key),
        create: { workspaceId, scope: 'workspace', scopeId: workspaceId, key, value },
        update: { value },
      });
    const ops = [];
    if (values.defaultLeadsViewMode !== undefined) {
      const key = SETTING_KEYS.workspace.defaultLeadsViewMode;
      ops.push(
        values.defaultLeadsViewMode === null
          ? db.setting.deleteMany({ where: { scope: 'workspace', scopeId: workspaceId, key } })
          : upsert(key, values.defaultLeadsViewMode),
      );
    }
    if (values.showEmployeeRank !== undefined) ops.push(upsert(SETTING_KEYS.workspace.showEmployeeRank, values.showEmployeeRank));
    if (values.defaultInterfaceStyle !== undefined) ops.push(upsert(SETTING_KEYS.workspace.defaultInterfaceStyle, values.defaultInterfaceStyle));
    if (values.defaultBoardSkin !== undefined) ops.push(upsert(SETTING_KEYS.workspace.defaultBoardSkin, values.defaultBoardSkin));
    if (values.componentStyle !== undefined) ops.push(upsert(SETTING_KEYS.workspace.componentStyle, values.componentStyle));
    return ops;
  }
}
