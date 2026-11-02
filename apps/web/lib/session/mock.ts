import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  DEFAULT_USER_SETTINGS,
  EMPTY_BRANDING,
  FEATURE_FLAGS,
  GENERIC_SALES_MANIFEST,
  GENERIC_SALES_PACK_KEY,
  PLATFORM_PERMISSIONS,
  resolveLabels,
  ROLE_KIND_LABELS,
  SYSTEM_ROLE_KEYS,
  type ActivePack,
  type FeatureFlags,
  type LabelOverrides,
  type MeResponse,
  type PlatformAdmin,
  type RoleKind,
  type UserSettings,
  type Workspace,
} from '@vistar/shared';
import { COMPANY_FIXTURES, EMPLOYEE_FIXTURES, MOCK_WORKSPACE_ID, mockUsers, SEED_WORKSPACE, SUPER_ADMIN_FIXTURE } from '@vistar/shared/fixtures';

/**
 * Wave 1 mock identities built from the Shakti seed fixtures. Ids match mockUsers()/mockLeads()
 * owners, so "own" and "team" scopes line up with mock data. Replaced by the real API in Wave 3.
 */
export const MOCK_PERSONAS = ['company_admin', 'manager', 'employee', 'viewer', 'super_admin'] as const;
export type MockPersona = (typeof MOCK_PERSONAS)[number];

const PERSONA_FIXTURE_KEY: Record<RoleKind, string> = {
  company_admin: 'admin',
  manager: 'manager',
  employee: 'rep1',
  viewer: 'viewer',
};

/** Growth-plan flags. The AI node is off by default on every plan (D-038). */
const ALL_FLAGS = Object.fromEntries(FEATURE_FLAGS.map((f) => [f, f !== 'ai_node'])) as FeatureFlags;
const CREATED = '2026-01-15T04:30:00.000Z';

export function mockWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: MOCK_WORKSPACE_ID,
    name: SEED_WORKSPACE.name,
    slug: SEED_WORKSPACE.slug,
    status: 'active',
    timezone: SEED_WORKSPACE.timezone,
    currency: 'INR',
    businessHours: DEFAULT_BUSINESS_HOURS,
    holidays: [{ date: '2026-11-08', name: 'Diwali' }],
    plan: 'growth',
    logoUrl: null,
    accentColor: null,
    defaultTheme: 'system',
    defaultLeadsViewMode: null,
    showEmployeeRank: true,
    defaultInterfaceStyle: 'classic',
    defaultBoardSkin: 'depth',
    componentStyle: 'standard',
    branding: EMPTY_BRANDING,
    supportAccess: { until: null, includeContent: false },
    features: ALL_FLAGS,
    createdAt: CREATED,
    ...overrides,
  };
}

const roleId = (kind: RoleKind) => `0190f5a0-0000-7000-8000-30000000000${['company_admin', 'manager', 'employee', 'viewer'].indexOf(kind)}`;

export function mockMe(kind: RoleKind, opts: { settings?: UserSettings; workspace?: Partial<Workspace>; impersonating?: boolean; labels?: LabelOverrides | null; packs?: ActivePack[] } = {}): MeResponse {
  const users = mockUsers();
  const idx = EMPLOYEE_FIXTURES.findIndex((e) => e.key === PERSONA_FIXTURE_KEY[kind]);
  const fx = EMPLOYEE_FIXTURES[idx]!;
  const summary = users[idx]!;
  const idByKey = new Map(EMPLOYEE_FIXTURES.map((e, i) => [e.key, users[i]!.id]));
  const team = COMPANY_FIXTURES[0]!.teams.find((t) => t.managerKey === fx.key || t.memberKeys.includes(fx.key));
  const teamMemberIds =
    kind === 'manager' && team ? [team.managerKey, ...team.memberKeys].map((k) => idByKey.get(k)).filter((x): x is string => !!x) : [];

  return {
    user: {
      ...summary,
      workspaceId: MOCK_WORKSPACE_ID,
      email: fx.email,
      phone: fx.phone,
      title: fx.title,
      roleId: roleId(kind),
      roleName: ROLE_KIND_LABELS[kind],
      teamId: team ? `0190f5a0-0000-7000-8000-4000000000${COMPANY_FIXTURES[0]!.teams.indexOf(team)}0` : null,
      isActive: true,
      isFieldStaff: false,
      workingHours: null,
      statusChangedAt: CREATED,
      lastSeenAt: new Date().toISOString(),
      createdAt: CREATED,
    },
    role: {
      id: roleId(kind),
      key: SYSTEM_ROLE_KEYS[kind],
      name: ROLE_KIND_LABELS[kind],
      kind,
      dataScope: DEFAULT_ROLE_SCOPE[kind],
      permissions: DEFAULT_ROLE_PERMISSIONS[kind],
      isSystem: true,
      memberCount: EMPLOYEE_FIXTURES.filter((e) => e.role === kind).length,
    },
    workspace: mockWorkspace(opts.workspace),
    permissions: DEFAULT_ROLE_PERMISSIONS[kind],
    teamMemberIds,
    settings: opts.settings ?? DEFAULT_USER_SETTINGS,
    impersonation: opts.impersonating
      ? {
          sessionId: '0190f5a0-0000-7000-8000-500000000001',
          adminName: SUPER_ADMIN_FIXTURE.name,
          reason: 'Customer asked for help configuring lead routing',
          readOnly: true,
          contentAccess: false,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        }
      : null,
    labels: resolveLabels(opts.labels),
    packs: opts.packs ?? [{ key: GENERIC_SALES_PACK_KEY, version: GENERIC_SALES_MANIFEST.version, modes: [] }],
  };
}

export function mockPlatformAdmin(): PlatformAdmin {
  return {
    id: '0190f5a0-0000-7000-8000-600000000001',
    email: SUPER_ADMIN_FIXTURE.email,
    name: SUPER_ADMIN_FIXTURE.name,
    permissions: [...PLATFORM_PERMISSIONS],
    mfaEnabled: true,
    ipAllowlist: [],
    isActive: true,
    lastLoginAt: new Date().toISOString(),
    createdAt: CREATED,
  };
}
