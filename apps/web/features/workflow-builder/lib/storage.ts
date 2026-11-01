import type { WorkflowGraph } from '@vistar/shared';
import type { LocalVersion } from '../store/builder-store';

/** Wave 1 mock persistence (localStorage). Wave 3 replaces with the workflows API. */
const FLAT_KEY = 'vistar.builder.flatMode';
const versionsKey = (id: string) => `vistar.builder.${id}.versions`;
const metaKey = (id: string) => `vistar.builder.${id}.meta`;
const DUPLICATES_KEY = 'vistar.builder.duplicates';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep working in memory */
  }
}

const flatListeners = new Set<() => void>();

export function loadFlatMode(): boolean {
  return read<boolean>(FLAT_KEY) === true;
}

export function saveFlatMode(on: boolean) {
  write(FLAT_KEY, on);
  flatListeners.forEach((l) => l());
}

/** useSyncExternalStore subscription for the flat-mode preference (also across tabs). */
export function subscribeFlatMode(listener: () => void) {
  flatListeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === FLAT_KEY && listener();
  window.addEventListener('storage', onStorage);
  return () => {
    flatListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export interface WorkflowMeta {
  status: 'draft' | 'active';
  activeVersion: number | null;
}

export function loadMeta(id: string): WorkflowMeta | null {
  return read<WorkflowMeta>(metaKey(id));
}

export function saveMeta(id: string, meta: WorkflowMeta) {
  write(metaKey(id), meta);
}

export function loadVersions(id: string): LocalVersion[] {
  const list = read<LocalVersion[]>(versionsKey(id));
  return Array.isArray(list) ? list : [];
}

export function saveVersions(id: string, versions: LocalVersion[]) {
  write(versionsKey(id), versions.slice(0, 30));
}

export function saveDuplicate(entry: { id: string; name: string; graph: WorkflowGraph }) {
  const list = read<Array<typeof entry & { createdAt: string }>>(DUPLICATES_KEY) ?? [];
  write(DUPLICATES_KEY, [{ ...entry, createdAt: new Date().toISOString() }, ...list].slice(0, 20));
}
