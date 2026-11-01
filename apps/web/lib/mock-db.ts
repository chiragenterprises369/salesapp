'use client';

import {
  applyPlanToState,
  emptyPackState,
  GENERIC_SALES_MANIFEST,
  planPackInstall,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  ROLE_KIND_LABELS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  type CustomRecord,
  type PackInstallLog,
  type PackOverride,
  type Plan,
  type WorkspacePackState,
  type WorkspacePackStatus,
} from '@vistar/shared';
import { mockPipeline, WHATSAPP_TEMPLATE_FIXTURES } from '@vistar/shared/fixtures';

/**
 * Shared in-browser mock database for the flexible data layer and Industry Packs (Wave 1 mocks).
 * OWNER: orchestrator. One store so Settings edits (fields, stages, labels, packs) show up on the
 * Board, lead detail, records pages and navigation. Persisted in localStorage (`vistar.mock.db.v1`).
 * The state shape IS the pack planner's WorkspacePackState, so mock installs use the real planner.
 */
export interface MockPackRow {
  key: string;
  status: WorkspacePackStatus | 'not_installed';
  installedVersion: string | null;
  modes: string[];
  installedAt: string | null;
  lastError: string | null;
  override: PackOverride | null;
}

export interface MockDbData {
  v: 1;
  state: WorkspacePackState;
  /** createdAt / archivedAt per row id (fields, objects, pipelines, stages, roles). */
  meta: Record<string, { createdAt: string; archivedAt: string | null }>;
  records: CustomRecord[];
  packs: MockPackRow[];
  logs: PackInstallLog[];
  /** Super Admin registry mock: plans per pack + add-on price. */
  registry: Record<string, { plans: Plan[]; priceInrMonthly: number | null }>;
}

const KEY = 'vistar.mock.db.v1';
const CREATED = '2026-10-01T09:00:00.000Z';

export const mockId = () => crypto.randomUUID();

function seed(): MockDbData {
  const p = mockPipeline();
  const state = emptyPackState();
  state.pipelines.push({
    id: p.id,
    key: p.key,
    name: p.name,
    isDefault: true,
    packKey: p.packKey,
    archived: false,
    stages: p.stages.map((s) => ({ id: s.id, key: s.key, name: s.name, type: s.type, probability: s.probability, color: s.color, order: s.order, archived: false, leadCount: 0 })),
  });
  state.templates.push(...WHATSAPP_TEMPLATE_FIXTURES.map((t, i) => ({ id: `0190f5a0-0000-7000-8000-7000000000${String(i).padStart(2, '0')}`, name: t.name, language: 'en', packKey: GENERIC_SALES_MANIFEST.key })));
  state.roles.push(
    ...ROLE_KINDS.map((kind, i) => ({
      id: `0190f5a0-0000-7000-8000-3000000000${String(i).padStart(2, '0')}`,
      key: SYSTEM_ROLE_KEYS[kind],
      name: ROLE_KIND_LABELS[kind],
      kind,
      dataScope: DEFAULT_ROLE_SCOPE[kind],
      permissions: [...DEFAULT_ROLE_PERMISSIONS[kind]],
      isSystem: true,
      packKey: null,
      archived: false,
    })),
  );
  // Same path as an existing workspace after migration + `pnpm packs:sync`.
  const ops = planPackInstall(state, GENERIC_SALES_MANIFEST, { modes: [] });
  const installed = applyPlanToState(state, ops, GENERIC_SALES_MANIFEST.key, mockId);
  const db: MockDbData = {
    v: 1,
    state: installed,
    meta: {},
    records: [],
    packs: [{ key: GENERIC_SALES_MANIFEST.key, status: 'active', installedVersion: GENERIC_SALES_MANIFEST.version, modes: [], installedAt: CREATED, lastError: null, override: null }],
    logs: [],
    registry: { [GENERIC_SALES_MANIFEST.key]: { plans: ['free', 'starter', 'growth', 'enterprise'], priceInrMonthly: null } },
  };
  return syncMeta(db, CREATED);
}

/** Keep createdAt / archivedAt in step with the planner's `archived` flags. */
function syncMeta(db: MockDbData, now = new Date().toISOString()): MockDbData {
  const rows: Array<{ id: string; archived: boolean }> = [
    ...db.state.objects,
    ...db.state.fields,
    ...db.state.roles,
    ...db.state.pipelines,
    ...db.state.pipelines.flatMap((p) => p.stages),
  ];
  for (const r of rows) {
    const m = db.meta[r.id] ?? { createdAt: now, archivedAt: null };
    m.archivedAt = r.archived ? (m.archivedAt ?? now) : null;
    db.meta[r.id] = m;
  }
  return db;
}

let cache: MockDbData | null = null;
const listeners = new Set<() => void>();

export function readMockDb(): MockDbData {
  if (cache) return cache;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as MockDbData;
        if (parsed?.v === 1) return (cache = parsed);
      }
    } catch {
      // corrupted storage: fall back to the seed
    }
  }
  return (cache = seed());
}

/** Apply a change (on a deep copy), persist, notify subscribers. Returns the new data. */
export function updateMockDb(fn: (db: MockDbData) => void): MockDbData {
  const next = structuredClone(readMockDb());
  fn(next);
  cache = syncMeta(next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // quota exceeded: keep in memory
    }
  }
  for (const l of listeners) l();
  return cache;
}

export function subscribeMockDb(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Back to the seed (dev tools, tests). */
export function resetMockDb(): void {
  cache = null;
  if (typeof window !== 'undefined') window.localStorage.removeItem(KEY);
  updateMockDb(() => undefined);
}
