import { DEFAULT_THEME_PREFERENCE, type ResolvedTheme, type ThemePreference, type UserSettings } from '@vistar/shared';
import { create } from 'zustand';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export type ReducedMotionSetting = UserSettings['reducedMotion'];

interface ThemeState {
  /** Effective preference: session settings when signed in to a workspace, else the cookie. */
  preference: ThemePreference;
  /** Workspace timezone used by Scheduled mode. */
  timeZone: string;
  reducedMotion: ReducedMotionSetting;
  /** What is painted right now (`<html data-theme>`). */
  resolved: ResolvedTheme;
  /** True once preference and reducedMotion come from the session (or the cookie when signed out). */
  synced: boolean;
}

/** Theme state shared by the provider, the top-bar toggle and the preferences pages. */
export const useThemeStore = create<ThemeState>()(() => ({
  preference: DEFAULT_THEME_PREFERENCE,
  timeZone: DEFAULT_TIME_ZONE,
  reducedMotion: 'system',
  resolved: 'light',
  synced: false,
}));
