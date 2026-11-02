'use client';

import { useMemo } from 'react';
import { useMe } from '@/lib/session/session';
import { emptyPrefs, resolveVisibleColumns, tablePrefsKey, useCrmTablePrefs } from './table-prefs';

type ColumnMeta = { id: string; label: string; hideable?: boolean; defaultHidden?: boolean };

/** Column visibility + saved sets for one list, wired for ColumnSetsMenu and CrmTable. */
export function useColumnPrefs(entity: string, columns: readonly ColumnMeta[]) {
  const me = useMe();
  const key = tablePrefsKey(me?.user.id, entity);
  const prefs = useCrmTablePrefs((s) => s.byKey[key]) ?? emptyPrefs();
  const setVisible = useCrmTablePrefs((s) => s.setVisible);
  const saveSet = useCrmTablePrefs((s) => s.saveSet);
  const applySet = useCrmTablePrefs((s) => s.applySet);
  const deleteSet = useCrmTablePrefs((s) => s.deleteSet);
  const visible = useMemo(() => resolveVisibleColumns(columns, prefs.visible), [columns, prefs.visible]);

  return {
    visible,
    menu: {
      columns,
      visible,
      sets: prefs.sets,
      activeSetId: prefs.activeSetId,
      onToggle: (id: string, on: boolean) => setVisible(key, on ? [...visible, id] : visible.filter((v) => v !== id)),
      onReset: () => setVisible(key, null),
      onSaveSet: (name: string) => saveSet(key, name, visible),
      onApplySet: (id: string) => applySet(key, id),
      onDeleteSet: (id: string) => deleteSet(key, id),
    },
  };
}
