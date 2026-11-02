'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useSession, useSessionStatus } from '@/lib/session/session';
import { writeInterfaceCookie } from './cookie';
import { useDeviceCapabilities } from './device';
import { INTERFACE_STYLE_ATTRIBUTE, MOTION_ATTRIBUTE, REDUCED_MOTION_ATTRIBUTE } from './interface-boot';
import { loadInterfaceSettings, useInterfaceSettings, useInterfaceSettingsStore } from './interface-settings';
import {
  DEFAULT_INTERFACE_STYLE,
  DEFAULT_MOTION_INTENSITY,
  describeOverride,
  panelForPath,
  resolveInterface,
  stylesForPanel,
  type InterfacePanel,
  type ResolvedInterface,
} from './interface-style';
import { useThemeStore, type ReducedMotionSetting } from './theme-store';

const INITIAL: ResolvedInterface = {
  requestedStyle: DEFAULT_INTERFACE_STYLE,
  style: DEFAULT_INTERFACE_STYLE,
  requestedMotion: DEFAULT_MOTION_INTENSITY,
  motion: DEFAULT_MOTION_INTENSITY,
  reasons: [],
};

interface InterfaceState {
  /** What is painted on <html>. Classic until the provider has resolved the session's settings. */
  resolved: ResolvedInterface;
  panel: InterfacePanel;
  ready: boolean;
}

/** Resolved interface style and motion, for the shell (backdrop, transitions) and the settings UI. */
export const useInterfaceStore = create<InterfaceState>()(() => ({ resolved: INITIAL, panel: 'other', ready: false }));

function paint(r: ResolvedInterface, reducedMotion: ReducedMotionSetting) {
  const root = document.documentElement;
  if (root.getAttribute(INTERFACE_STYLE_ATTRIBUTE) !== r.style) root.setAttribute(INTERFACE_STYLE_ATTRIBUTE, r.style);
  if (root.getAttribute(MOTION_ATTRIBUTE) !== r.motion) root.setAttribute(MOTION_ATTRIBUTE, r.motion);
  // Motion intensity Off also stops the existing animations that read data-reduced-motion (useReducedMotion).
  const rm = reducedMotion === 'on' || r.motion === 'off' ? 'on' : reducedMotion === 'off' ? 'off' : null;
  if (rm) root.setAttribute(REDUCED_MOTION_ATTRIBUTE, rm);
  else root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
}

/**
 * Interface style and motion system (SPEC 28.2). Mounted once in app/layout.tsx inside ThemeProvider.
 * Loads the D-052 settings for the session (adapter), resolves them with the device fallbacks and
 * writes `data-interface-style`, `data-motion` and `data-reduced-motion` on <html>, then mirrors the
 * inputs into the `vistar_ui` cookie for the boot script. Renders nothing.
 */
export function InterfaceProvider() {
  const status = useSessionStatus();
  const session = useSession();
  const pathname = usePathname();
  const device = useDeviceCapabilities();
  const reducedMotion = useThemeStore((s) => s.reducedMotion);
  const themeSynced = useThemeStore((s) => s.synced);
  const loaded = useInterfaceSettingsStore((s) => s.loaded);
  const { interfaceStyle, motionIntensity, defaultInterfaceStyle } = useInterfaceSettings();

  const userId = session?.audience === 'workspace' ? session.me.user.id : session?.audience === 'platform' ? `platform-${session.admin.id}` : null;
  const workspaceId = session?.audience === 'workspace' ? session.me.workspace.id : null;
  const panel = panelForPath(pathname);

  useEffect(() => {
    if (status === 'loading') return;
    const identity = { userId, workspaceId };
    loadInterfaceSettings(identity);
    // Other tabs changed a value (adapter storage): follow them.
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('vistar.ui.')) loadInterfaceSettings(identity);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [status, userId, workspaceId]);

  const resolved = useMemo(
    () => resolveInterface({ interfaceStyle, defaultInterfaceStyle, motionIntensity, reducedMotion, device, panel }),
    [interfaceStyle, defaultInterfaceStyle, motionIntensity, reducedMotion, device, panel],
  );

  useEffect(() => {
    // Until both the settings and the reduced-motion preference are known, keep what the boot script painted.
    if (!loaded || !themeSynced) return;
    paint(resolved, reducedMotion);
    useInterfaceStore.setState({ resolved, panel, ready: true });
    writeInterfaceCookie({ s: interfaceStyle, d: defaultInterfaceStyle, m: motionIntensity, rm: reducedMotion });
  }, [loaded, themeSynced, resolved, panel, reducedMotion, interfaceStyle, defaultInterfaceStyle, motionIntensity]);

  return null;
}

/**
 * Everything the preferences UI needs: the saved choices (adapter), the setters, what is painted and a
 * sentence explaining an automatic override ("Classic is used on this device because ...").
 */
export function useInterface() {
  const settings = useInterfaceSettings();
  const resolved = useInterfaceStore((s) => s.resolved);
  const panel = useInterfaceStore((s) => s.panel);
  const ready = useInterfaceStore((s) => s.ready);
  return { ...settings, resolved, ready, panel, availableStyles: stylesForPanel(panel), override: ready ? describeOverride(resolved) : null };
}
