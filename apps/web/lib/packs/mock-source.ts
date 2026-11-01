import {
  BUILTIN_PACK_MANIFESTS,
  buildPackRuntime,
  conflictsOf,
  CorePackError,
  defaultModes,
  describeOp,
  isEntitled,
  manifestSummary,
  packEntitlement,
  PLANS,
  planPackInstall,
  planPackUninstall,
  runtimeForPermissions,
  summarizeOps,
  writeOps,
  applyPlanToState,
  type PackAction,
  type PackCompanyUsage,
  type PackInstallLog,
  type PackInstallResult,
  type PackListItem,
  type PackManifest,
  type PackOp,
  type Plan,
  type WorkspacePackState,
} from '@vistar/shared';
import { COMPANY_FIXTURES, MOCK_WORKSPACE_ID } from '@vistar/shared/fixtures';
import { ApiRequestError } from '../api-error';
import { mockLeadCountByStage } from '../leads/mock-source';
import { mockId, readMockDb, updateMockDb, type MockDbData, type MockPackRow } from '../mock-db';
import { useSessionStore } from '../session/session';
import { DEMO_PACK_MANIFEST } from './demo-pack';
import type { PacksSource } from './source';

/** Built-in packs plus the mock-only demo pack. One version per pack in the mock. */
const MANIFESTS: Readonly<Record<string, PackManifest>> = { ...BUILTIN_PACK_MANIFESTS, [DEMO_PACK_MANIFEST.key]: DEMO_PACK_MANIFEST };
const DEMO_DEFAULT_PLANS: Plan[] = ['growth', 'enterprise'];
const MOCK_CHECKSUM = 'mock';
const VERSION_CREATED = '2026-10-01T09:00:00.000Z';

const delay = (ms = 120 + Math.random() * 160) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function workspaceCaller() {
  const s = useSessionStore.getState().session;
  if (!s || s.audience !== 'workspace') throw new ApiRequestError('AUTH_UNAUTHENTICATED', 'Sign in again');
  return s.me;
}
function requireSettings() {
  if (!workspaceCaller().permissions.includes('settings.manage')) throw new ApiRequestError('FORBIDDEN', 'Only company admins can manage industry packs');
}
function requirePlatform() {
  const s = useSessionStore.getState().session;
  if (!s || s.audience !== 'platform' || !s.admin.permissions.includes('platform.packs.manage')) throw new ApiRequestError('FORBIDDEN', 'You do not have permission to manage packs');
}

const manifestOf = (key: string) => {
  const m = MANIFESTS[key];
  if (!m) throw new ApiRequestError('NOT_FOUND', 'Pack not found');
  return m;
};
const rowOf = (db: MockDbData, key: string): MockPackRow =>
  db.packs.find((p) => p.key === key) ?? { key, status: 'not_installed', installedVersion: null, modes: [], installedAt: null, lastError: null, override: null };
const plansOf = (db: MockDbData, m: PackManifest): Plan[] => (m.core ? [...PLANS] : (db.registry[m.key]?.plans ?? DEMO_DEFAULT_PLANS));
const workspacePlan = (): Plan => {
  const s = useSessionStore.getState().session;
  return s?.audience === 'workspace' ? s.me.workspace.plan : 'growth';
};
const entitlementOf = (db: MockDbData, m: PackManifest, plan: Plan) => packEntitlement({ core: m.core, plan, plans: plansOf(db, m), override: rowOf(db, m.key).override });

/** Planner input with live lead counts (stages holding leads are never archived). */
function stateForPlanning(db: MockDbData): WorkspacePackState {
  const counts = mockLeadCountByStage();
  const s = structuredClone(db.state);
  for (const p of s.pipelines) for (const st of p.stages) st.leadCount = counts.get(st.id) ?? 0;
  return s;
}

function listItem(db: MockDbData, m: PackManifest, plan: Plan): PackListItem {
  const row = rowOf(db, m.key);
  const entitlement = entitlementOf(db, m, plan);
  const status: PackListItem['status'] = row.status === 'not_installed' ? (isEntitled(entitlement) ? 'available' : 'locked') : row.status;
  return {
    key: m.key,
    name: m.name,
    description: m.description,
    industry: m.industry,
    icon: m.icon,
    core: m.core,
    latestVersion: m.version,
    installedVersion: row.installedVersion,
    status,
    entitlement,
    modes: m.modes,
    enabledModes: row.modes,
    upgradeAvailable: !!row.installedVersion && row.installedVersion !== m.version,
    summary: manifestSummary(m),
    lastError: row.lastError,
    installedAt: row.installedAt,
  };
}

function resolveModes(m: PackManifest, row: MockPackRow, requested?: string[]): string[] {
  const modes = requested ?? (row.status === 'active' ? row.modes : defaultModes(m));
  const known = new Set(m.modes.map((x) => x.key));
  const unknown = modes.filter((x) => !known.has(x));
  if (unknown.length) throw new ApiRequestError('VALIDATION_FAILED', `Unknown mode "${unknown[0]}"`, [{ path: 'modes', message: 'Choose from the listed modes' }]);
  if (m.modes.length && !modes.length) throw new ApiRequestError('VALIDATION_FAILED', 'Choose at least one mode', [{ path: 'modes', message: 'Choose at least one mode' }]);
  return [...new Set(modes)];
}

function planFor(db: MockDbData, m: PackManifest, action: 'install' | 'upgrade' | 'uninstall', requestedModes?: string[]) {
  const row = rowOf(db, m.key);
  const state = stateForPlanning(db);
  if (action === 'uninstall') {
    try {
      return { ops: planPackUninstall(state, m), modes: row.modes, row };
    } catch (e) {
      if (e instanceof CorePackError) throw new ApiRequestError('PACK_CORE_LOCKED', e.message);
      throw e;
    }
  }
  const modes = resolveModes(m, row, requestedModes);
  const installed = row.installedVersion !== null;
  // Mock registry keeps one version per pack, so the installed manifest is the current one.
  const ops = planPackInstall(state, m, { modes, previous: installed ? m : null, previousModes: row.modes, reinstall: row.status === 'uninstalled' });
  return { ops, modes, row };
}

function execute(key: string, action: PackAction, requestedModes?: string[]): PackInstallResult {
  const me = workspaceCaller();
  const m = manifestOf(key);
  let result: PackInstallResult | null = null;
  updateMockDb((db) => {
    if (action !== 'uninstall' && !isEntitled(entitlementOf(db, m, me.workspace.plan))) {
      throw new ApiRequestError('PACK_NOT_ENTITLED', 'Your plan does not include this pack. Ask Vistar support to enable it.');
    }
    const { ops, modes, row } = planFor(db, m, action === 'uninstall' ? 'uninstall' : action === 'upgrade' ? 'upgrade' : 'install', requestedModes);
    const writes = writeOps(ops);
    db.state = applyPlanToState(db.state, ops, key, mockId);
    const next: MockPackRow =
      action === 'uninstall'
        ? { ...row, status: 'uninstalled', modes: row.modes }
        : { ...row, status: 'active', installedVersion: m.version, modes, installedAt: row.status === 'active' ? row.installedAt : nowIso(), lastError: null };
    db.packs = [...db.packs.filter((p) => p.key !== key), next];
    const log: PackInstallLog = {
      id: mockId(),
      packKey: key,
      action,
      fromVersion: row.installedVersion,
      toVersion: action === 'uninstall' ? null : m.version,
      modes: next.modes,
      status: writes.length ? 'success' : 'noop',
      summary: summarizeOps(ops),
      conflicts: conflictsOf(ops),
      error: null,
      actorName: me.user.name,
      createdAt: nowIso(),
    };
    db.logs.unshift(log);
    result = { pack: listItem(db, m, me.workspace.plan), summary: log.summary, conflicts: log.conflicts, noop: writes.length === 0, logId: log.id };
  });
  return result!;
}

const changesOf = (ops: readonly PackOp[]) => ops.filter((o) => o.op !== 'conflict').map((o) => ({ op: o.op, label: describeOp(o) }));

export const mockPacksSource: PacksSource = {
  async list() {
    await delay();
    requireSettings();
    const db = readMockDb();
    const plan = workspacePlan();
    return Object.values(MANIFESTS).map((m) => listItem(db, m, plan));
  },

  async runtime() {
    await delay(60);
    const me = workspaceCaller();
    const db = readMockDb();
    const packs = db.packs
      .filter((p) => p.status === 'active' && MANIFESTS[p.key] && isEntitled(entitlementOf(db, MANIFESTS[p.key]!, me.workspace.plan)))
      .map((p) => ({ manifest: MANIFESTS[p.key]!, modes: p.modes }));
    const objects = db.state.objects
      .filter((o) => !o.archived)
      .map((o) => ({ key: o.key, labelSingular: o.labelSingular, labelPlural: o.labelPlural, icon: o.icon, showInNav: o.showInNav, packKey: o.packKey }));
    return runtimeForPermissions(buildPackRuntime({ packs, labelOverrides: db.state.labelOverrides, objects }), me.permissions);
  },

  async plan(key, action, modes) {
    await delay();
    requireSettings();
    const m = manifestOf(key);
    const db = readMockDb();
    const { ops, modes: resolved, row } = planFor(db, m, action, modes);
    return {
      packKey: key,
      action,
      fromVersion: row.installedVersion,
      toVersion: action === 'uninstall' ? null : m.version,
      modes: resolved,
      summary: summarizeOps(ops),
      changes: changesOf(ops),
      conflicts: conflictsOf(ops),
      noop: writeOps(ops).length === 0,
    };
  },

  async install(key, body = {}) {
    await delay(400);
    requireSettings();
    return execute(key, 'install', body.modes);
  },

  async upgrade(key) {
    await delay(400);
    requireSettings();
    return execute(key, 'upgrade');
  },

  async uninstall(key) {
    await delay(400);
    requireSettings();
    return execute(key, 'uninstall');
  },

  async log(key) {
    await delay(60);
    requireSettings();
    return readMockDb().logs.filter((l) => l.packKey === key);
  },

  super: {
    async list() {
      await delay();
      requirePlatform();
      const db = readMockDb();
      return Object.values(MANIFESTS).map((m) => {
        const row = rowOf(db, m.key);
        return {
          key: m.key,
          name: m.name,
          description: m.description,
          industry: m.industry,
          icon: m.icon,
          core: m.core,
          latestVersion: m.version,
          versions: [{ version: m.version, checksum: MOCK_CHECKSUM, createdAt: VERSION_CREATED }],
          plans: plansOf(db, m),
          priceInrMonthly: db.registry[m.key]?.priceInrMonthly ?? null,
          installs: { active: row.status === 'active' ? 1 : 0, total: row.installedVersion ? 1 : 0 },
          summary: manifestSummary(m),
        };
      });
    },

    async version(key, version) {
      await delay(60);
      requirePlatform();
      const m = manifestOf(key);
      if (m.version !== version) throw new ApiRequestError('NOT_FOUND', 'Version not found');
      return { key, version, checksum: MOCK_CHECKSUM, createdAt: VERSION_CREATED, manifest: m, summary: manifestSummary(m) };
    },

    async setPlans(key, body) {
      await delay();
      requirePlatform();
      const m = manifestOf(key);
      if (m.core) throw new ApiRequestError('PACK_CORE_LOCKED', 'Core packs are included in every plan');
      updateMockDb((db) => {
        const cur = db.registry[key] ?? { plans: DEMO_DEFAULT_PLANS, priceInrMonthly: null };
        db.registry[key] = { plans: [...new Set(body.plans)], priceInrMonthly: body.priceInrMonthly === undefined ? cur.priceInrMonthly : body.priceInrMonthly };
      });
      return (await this.list()).find((p) => p.key === key)!;
    },

    async setCompany(key, workspaceId, body) {
      await delay();
      requirePlatform();
      const m = manifestOf(key);
      if (m.core) throw new ApiRequestError('PACK_CORE_LOCKED', 'Core packs cannot be granted or revoked');
      if (body.reason.trim().length < 5) throw new ApiRequestError('VALIDATION_FAILED', 'Give a reason (at least 5 characters)', [{ path: 'reason', message: 'At least 5 characters' }]);
      if (workspaceId !== MOCK_WORKSPACE_ID) throw new ApiRequestError('NOT_FOUND', 'Only the demo company has mock data');
      updateMockDb((db) => {
        db.packs = [...db.packs.filter((p) => p.key !== key), { ...rowOf(db, key), override: body.override }];
      });
      return (await this.usage(key)).companies.find((c) => c.workspaceId === workspaceId)!;
    },

    async usage(key) {
      await delay();
      requirePlatform();
      const m = manifestOf(key);
      const db = readMockDb();
      const objectKeys = new Set(db.state.objects.filter((o) => o.packKey === key).map((o) => o.key));
      const companies = COMPANY_FIXTURES.map((c, i) => {
        const isMock = i === 0;
        const row = isMock ? rowOf(db, key) : null;
        const override = row?.override ?? null;
        const entitlement = packEntitlement({ core: m.core, plan: c.plan, plans: plansOf(db, m), override });
        return {
          workspaceId: isMock ? MOCK_WORKSPACE_ID : `0190f5a0-0000-7000-8000-90000000000${i}`,
          name: c.name,
          plan: c.plan,
          override,
          entitlement,
          status: (row?.status ?? (m.core ? 'active' : 'not_installed')) as PackCompanyUsage['status'],
          installedVersion: row?.installedVersion ?? (m.core ? m.version : null),
          modes: row?.modes ?? [],
          recordCount: isMock ? db.records.filter((r) => objectKeys.has(r.objectKey)).length : 0,
        };
      });
      return {
        key,
        totals: {
          entitled: companies.filter((c) => isEntitled(c.entitlement)).length,
          active: companies.filter((c) => c.status === 'active').length,
          records: companies.reduce((n, c) => n + c.recordCount, 0),
        },
        companies,
      };
    },
  },
};
