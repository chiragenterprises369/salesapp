'use client';

import {
  msUntilNextThemeSwitch,
  resolveTheme,
  THEME_ATTRIBUTE,
  THEME_MODE_ATTRIBUTE,
  ThemePreferenceSchema,
  type ResolvedTheme,
  type ThemePreference,
} from '@vistar/shared';
import { useCallback, useEffect, type ReactNode } from 'react';
import { toast } from '@/components/ui/toast';
import { useMe, useSessionActions, useSessionStatus, useSessionStore } from '@/lib/session/session';
import { readThemeCookie, writeThemeCookie } from './cookie';
import { DEFAULT_TIME_ZONE, useThemeStore, type ReducedMotionSetting } from './theme-store';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const REDUCED_MOTION_ATTRIBUTE = 'data-reduced-motion';

/**
 * Latest locally requested values that the session has not caught up with yet. While set, older
 * session values (from earlier, slower saves) are ignored so quick consecutive changes never flicker.
 */
const pending: { theme: ThemePreference | null; motion: ReducedMotionSetting | null } = { theme: null, motion: null };

const samePreference = (a: ThemePreference, b: ThemePreference) =>
  a.mode === b.mode && a.darkFrom === b.darkFrom && a.darkTo === b.darkTo;

/** Switch themes without every element animating its colours (same trick as next-themes). */
function withoutTransitions(fn: () => void) {
  const style = document.createElement('style');
  style.appendChild(document.createTextNode('*,*::before,*::after{transition:none!important}'));
  document.head.appendChild(style);
  fn();
  // Force a style flush before re-enabling transitions.
  void window.getComputedStyle(document.body).opacity;
  requestAnimationFrame(() => style.remove());
}

function paint(resolved: ResolvedTheme, mode: ThemePreference['mode']) {
  const root = document.documentElement;
  const change = () => {
    root.setAttribute(THEME_ATTRIBUTE, resolved);
    root.setAttribute(THEME_MODE_ATTRIBUTE, mode);
    root.style.colorScheme = resolved;
  };
  if (root.getAttribute(THEME_ATTRIBUTE) !== resolved) withoutTransitions(change);
  else change();
}

/**
 * Theme system. Source of the preference:
 * - signed in to a workspace: `me.settings.theme` (persisted with updateSettings) and the workspace timezone;
 * - otherwise (signed out, Super Admin): the `vistar_theme` cookie.
 * Writes data-theme / data-theme-mode / color-scheme, mirrors the cookie for the boot script, keeps a
 * live prefers-color-scheme listener (System) and a timer for the next flip (Scheduled).
 * Also writes data-reduced-motion from settings.reducedMotion ("system" removes the attribute).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const status = useSessionStatus();
  const preference = useThemeStore((s) => s.preference);
  const timeZone = useThemeStore((s) => s.timeZone);
  const reducedMotion = useThemeStore((s) => s.reducedMotion);

  // Signed out or platform session: start from the cookie the boot script already applied.
  useEffect(() => {
    if (status === 'loading' || me) return;
    const cookie = readThemeCookie();
    useThemeStore.setState({
      preference: cookie ? { mode: cookie.mode, darkFrom: cookie.darkFrom, darkTo: cookie.darkTo } : useThemeStore.getState().preference,
      timeZone: cookie?.tz ?? DEFAULT_TIME_ZONE,
      reducedMotion: 'system',
    });
  }, [status, me]);

  // Signed in to a workspace: the server-side setting wins.
  const mode = me?.settings.theme.mode;
  const darkFrom = me?.settings.theme.darkFrom;
  const darkTo = me?.settings.theme.darkTo;
  const workspaceTz = me?.workspace.timezone;
  const motionSetting = me?.settings.reducedMotion;
  useEffect(() => {
    if (!mode || !darkFrom || !darkTo) return;
    const fromSession: ThemePreference = { mode, darkFrom, darkTo };
    const next: Partial<{ preference: ThemePreference; timeZone: string; reducedMotion: ReducedMotionSetting }> = {
      timeZone: workspaceTz ?? DEFAULT_TIME_ZONE,
    };
    if (!pending.theme || samePreference(pending.theme, fromSession)) {
      pending.theme = null;
      next.preference = fromSession;
    }
    const motion = motionSetting ?? 'system';
    if (pending.motion === null || pending.motion === motion) {
      pending.motion = null;
      next.reducedMotion = motion;
    }
    useThemeStore.setState(next);
  }, [mode, darkFrom, darkTo, workspaceTz, motionSetting]);

  // Paint, persist the cookie, and keep it live.
  useEffect(() => {
    const mql = window.matchMedia(DARK_QUERY);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const apply = () => {
      const resolved = resolveTheme({ preference, prefersDark: mql.matches, now: new Date(), timeZone });
      paint(resolved, preference.mode);
      useThemeStore.setState({ resolved });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      const ms = msUntilNextThemeSwitch(preference, new Date(), timeZone);
      if (ms === null) return;
      // Land just after the boundary minute; re-arm after each flip.
      timer = setTimeout(() => {
        apply();
        schedule();
      }, Math.max(1_000, ms + 500));
    };
    // Timers are throttled in background tabs and paused during sleep: re-check on return.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      apply();
      schedule();
    };

    apply();
    schedule();
    writeThemeCookie({ ...preference, tz: timeZone });
    if (preference.mode === 'system') mql.addEventListener('change', apply);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      mql.removeEventListener('change', apply);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [preference, timeZone]);

  useEffect(() => {
    const root = document.documentElement;
    if (reducedMotion === 'system') root.removeAttribute(REDUCED_MOTION_ATTRIBUTE);
    else root.setAttribute(REDUCED_MOTION_ATTRIBUTE, reducedMotion);
  }, [reducedMotion]);

  return <>{children}</>;
}

/**
 * Read and change the theme. Changes apply instantly; when signed in to a workspace they are saved with
 * updateSettings (PATCH /me/settings in Wave 3) and rolled back with a toast if saving fails.
 */
export function useTheme() {
  const preference = useThemeStore((s) => s.preference);
  const resolved = useThemeStore((s) => s.resolved);
  const timeZone = useThemeStore((s) => s.timeZone);
  const { updateSettings } = useSessionActions();

  const setPreference = useCallback(
    async (patch: Partial<ThemePreference>) => {
      const prev = useThemeStore.getState().preference;
      const next = ThemePreferenceSchema.parse({ ...prev, ...patch });
      useThemeStore.setState({ preference: next });
      const session = useSessionStore.getState().session;
      if (session?.audience !== 'workspace') return;
      pending.theme = samePreference(next, session.me.settings.theme) ? null : next;
      try {
        await updateSettings({ theme: patch });
      } catch {
        pending.theme = null;
        useThemeStore.setState({ preference: prev });
        toast.error('Theme not saved. Check your connection and try again.');
      }
    },
    [updateSettings],
  );

  return { preference, resolved, timeZone, setPreference };
}

/** Change the reduced-motion setting (instant, saved like the theme). */
export function useReducedMotionSetting() {
  const reducedMotion = useThemeStore((s) => s.reducedMotion);
  const { updateSettings } = useSessionActions();
  const setReducedMotion = useCallback(
    async (value: ReducedMotionSetting) => {
      const prev = useThemeStore.getState().reducedMotion;
      useThemeStore.setState({ reducedMotion: value });
      const session = useSessionStore.getState().session;
      if (session?.audience !== 'workspace') return;
      pending.motion = session.me.settings.reducedMotion === value ? null : value;
      try {
        await updateSettings({ reducedMotion: value });
      } catch {
        pending.motion = null;
        useThemeStore.setState({ reducedMotion: prev });
        toast.error('Motion setting not saved. Check your connection and try again.');
      }
    },
    [updateSettings],
  );
  return { reducedMotion, setReducedMotion };
}
