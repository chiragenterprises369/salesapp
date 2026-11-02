'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Column visibility and saved column sets for the CRM list pages (contacts, accounts, deals,
 * products, quotations, invoices). Kept on this device per signed-in user and list (key
 * `<userId>:<entity>`), like the Leads table preferences (`vistar.leads.table`). The server has no
 * saved-view route for these entities yet (requests-19b #9); when it ships, these sets move there.
 */
export interface ColumnSet {
  id: string;
  name: string;
  /** Visible column ids in display order. */
  columns: string[];
}

export interface EntityTablePrefs {
  /** Visible column ids; null = the list's defaults. */
  visible: string[] | null;
  sets: ColumnSet[];
  activeSetId: string | null;
}

const EMPTY: EntityTablePrefs = { visible: null, sets: [], activeSetId: null };

interface TablePrefsState {
  byKey: Record<string, EntityTablePrefs>;
  setVisible: (key: string, visible: string[] | null) => void;
  saveSet: (key: string, name: string, columns: string[]) => ColumnSet;
  applySet: (key: string, id: string) => void;
  deleteSet: (key: string, id: string) => void;
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCrmTablePrefs = create<TablePrefsState>()(
  persist(
    (set, get) => ({
      byKey: {},
      setVisible: (key, visible) =>
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...(s.byKey[key] ?? EMPTY), visible, activeSetId: null } } })),
      saveSet: (key, name, columns) => {
        const prefs = get().byKey[key] ?? EMPTY;
        const existing = prefs.sets.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
        const saved: ColumnSet = { id: existing?.id ?? newId(), name: name.trim(), columns: [...columns] };
        const sets = existing ? prefs.sets.map((x) => (x.id === existing.id ? saved : x)) : [...prefs.sets, saved];
        set((s) => ({ byKey: { ...s.byKey, [key]: { visible: [...columns], sets, activeSetId: saved.id } } }));
        return saved;
      },
      applySet: (key, id) => {
        const prefs = get().byKey[key] ?? EMPTY;
        const hit = prefs.sets.find((x) => x.id === id);
        if (!hit) return;
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...prefs, visible: [...hit.columns], activeSetId: id } } }));
      },
      deleteSet: (key, id) => {
        const prefs = get().byKey[key] ?? EMPTY;
        set((s) => ({
          byKey: {
            ...s.byKey,
            [key]: { ...prefs, sets: prefs.sets.filter((x) => x.id !== id), activeSetId: prefs.activeSetId === id ? null : prefs.activeSetId },
          },
        }));
      },
    }),
    { name: 'vistar.crm.tables', storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

/**
 * Visible column ids for a list: the stored choice (unknown ids dropped, columns that cannot be
 * hidden always kept) or the defaults. The order is always the list's declared order.
 */
export function resolveVisibleColumns(
  all: ReadonlyArray<{ id: string; hideable?: boolean; defaultHidden?: boolean }>,
  stored: readonly string[] | null,
): string[] {
  if (!stored) return all.filter((c) => c.hideable === false || !c.defaultHidden).map((c) => c.id);
  const chosen = new Set(stored);
  return all.filter((c) => c.hideable === false || chosen.has(c.id)).map((c) => c.id);
}

export const tablePrefsKey = (userId: string | null | undefined, entity: string) => `${userId ?? 'anon'}:${entity}`;

export function emptyPrefs(): EntityTablePrefs {
  return EMPTY;
}
