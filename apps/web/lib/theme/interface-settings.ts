'use client';

import { useCallback } from 'react';
import { create } from 'zustand';
import { readInterfaceCookie } from './cookie';
import {
  DEFAULT_INTERFACE_STYLE,
  DEFAULT_MOTION_INTENSITY,
  isInterfaceStyle,
  isMotionIntensity,
  type InterfaceStyle,
  type MotionIntensity,
} from './interface-style';

/**
 * TEMPORARY ADAPTER for the D-052 settings until backend-core ships them (docs/REQUESTS.md #1).
 *
 *   user      ui.interfaceStyle         InterfaceStyle | null   (null = follow the workspace default)
 *   user      ui.motionIntensity        MotionIntensity          (default full)
 *   workspace ui.defaultInterfaceStyle  InterfaceStyle           (default classic)
 *
 * Now: localStorage per user (`vistar.ui.user.<userId>`) and per workspace (`vistar.ui.workspace.<id>`).
 * TODO(D-052): swap the bodies of `loadInterfaceSettings` and the three setters to session settings:
 *   read  me.settings.interfaceStyle / me.settings.motionIntensity / me.workspace.defaultInterfaceStyle
 *   write useSessionActions().updateSettings({ interfaceStyle | motionIntensity }) and
 *         updateWorkspace({ defaultInterfaceStyle })  (optimistic, roll back with a toast like useTheme)
 * Callers (InterfaceProvider, preferences, Settings > Theme default, user menu) do not change.
 */

export interface InterfaceSettings {
  interfaceStyle: InterfaceStyle | null;
  motionIntensity: MotionIntensity;
  defaultInterfaceStyle: InterfaceStyle;
}

interface InterfaceSettingsState extends InterfaceSettings {
  /** Who the values belong to; null when signed out. */
  userId: string | null;
  workspaceId: string | null;
  /** False until the provider has loaded values for the current session. */
  loaded: boolean;
}

const userKey = (id: string) => `vistar.ui.user.${id}`;
const workspaceKey = (id: string) => `vistar.ui.workspace.${id}`;

function readJson(key: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: object) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the in-memory value still applies for this tab */
  }
}

export const useInterfaceSettingsStore = create<InterfaceSettingsState>()(() => ({
  userId: null,
  workspaceId: null,
  loaded: false,
  interfaceStyle: null,
  motionIntensity: DEFAULT_MOTION_INTENSITY,
  defaultInterfaceStyle: DEFAULT_INTERFACE_STYLE,
}));

/**
 * Load the values for a session. Signed out (both ids null): the `vistar_ui` cookie, i.e. the last
 * values used on this device, so auth pages keep the boot script's choice.
 */
export function loadInterfaceSettings({ userId, workspaceId }: { userId: string | null; workspaceId: string | null }) {
  if (!userId && !workspaceId) {
    const c = readInterfaceCookie();
    useInterfaceSettingsStore.setState({
      userId: null,
      workspaceId: null,
      loaded: true,
      interfaceStyle: c?.s ?? null,
      motionIntensity: c?.m ?? DEFAULT_MOTION_INTENSITY,
      defaultInterfaceStyle: c?.d ?? DEFAULT_INTERFACE_STYLE,
    });
    return;
  }
  const user = userId ? readJson(userKey(userId)) : null;
  const ws = workspaceId ? readJson(workspaceKey(workspaceId)) : null;
  useInterfaceSettingsStore.setState({
    userId,
    workspaceId,
    loaded: true,
    interfaceStyle: isInterfaceStyle(user?.interfaceStyle) ? user.interfaceStyle : null,
    motionIntensity: isMotionIntensity(user?.motionIntensity) ? user.motionIntensity : DEFAULT_MOTION_INTENSITY,
    defaultInterfaceStyle: isInterfaceStyle(ws?.defaultInterfaceStyle) ? ws.defaultInterfaceStyle : DEFAULT_INTERFACE_STYLE,
  });
}

function saveUser(patch: Partial<Pick<InterfaceSettings, 'interfaceStyle' | 'motionIntensity'>>) {
  useInterfaceSettingsStore.setState(patch);
  const { userId, interfaceStyle, motionIntensity } = useInterfaceSettingsStore.getState();
  if (userId) writeJson(userKey(userId), { interfaceStyle, motionIntensity });
}

/** Read and change the D-052 interface settings. Changes apply instantly. */
export function useInterfaceSettings() {
  const interfaceStyle = useInterfaceSettingsStore((s) => s.interfaceStyle);
  const motionIntensity = useInterfaceSettingsStore((s) => s.motionIntensity);
  const defaultInterfaceStyle = useInterfaceSettingsStore((s) => s.defaultInterfaceStyle);

  const setInterfaceStyle = useCallback((value: InterfaceStyle | null) => saveUser({ interfaceStyle: value }), []);
  const setMotionIntensity = useCallback((value: MotionIntensity) => saveUser({ motionIntensity: value }), []);
  /** Workspace default (Settings > Theme default, needs settings.manage). */
  const setDefaultInterfaceStyle = useCallback((value: InterfaceStyle) => {
    useInterfaceSettingsStore.setState({ defaultInterfaceStyle: value });
    const { workspaceId } = useInterfaceSettingsStore.getState();
    if (workspaceId) writeJson(workspaceKey(workspaceId), { defaultInterfaceStyle: value });
  }, []);

  return { interfaceStyle, motionIntensity, defaultInterfaceStyle, setInterfaceStyle, setMotionIntensity, setDefaultInterfaceStyle };
}
