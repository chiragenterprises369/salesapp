import {
  encodeThemeCookie,
  THEME_COOKIE,
  ThemeCookieSchema,
  type ThemeCookie,
} from '@vistar/shared';
import { INTERFACE_COOKIE, type InterfaceCookie } from './interface-boot';
import { DEFAULT_INTERFACE_STYLE, DEFAULT_MOTION_INTENSITY, isInterfaceStyle, isMotionIntensity } from './interface-style';

const ONE_YEAR_SEC = 60 * 60 * 24 * 365;

/** Reads the `vistar_theme` cookie (the same value the boot script uses). Null when absent or invalid. */
export function readThemeCookie(): ThemeCookie | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${THEME_COOKIE}=`));
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw.slice(THEME_COOKIE.length + 1)));
    const parsed = ThemeCookieSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Mirrors the preference into the cookie so the boot script paints the right theme on the next load. */
export function writeThemeCookie(value: ThemeCookie): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${THEME_COOKIE}=${encodeThemeCookie(value)}; Path=/; Max-Age=${ONE_YEAR_SEC}; SameSite=Lax${secure}`;
}

/** Reads the `vistar_ui` cookie (interface style, motion). Invalid fields fall back to defaults. */
export function readInterfaceCookie(): InterfaceCookie | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie.split('; ').find((c) => c.startsWith(`${INTERFACE_COOKIE}=`));
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw.slice(INTERFACE_COOKIE.length + 1))) as Partial<Record<keyof InterfaceCookie, unknown>>;
    return {
      s: isInterfaceStyle(v.s) ? v.s : null,
      d: isInterfaceStyle(v.d) ? v.d : DEFAULT_INTERFACE_STYLE,
      m: isMotionIntensity(v.m) ? v.m : DEFAULT_MOTION_INTENSITY,
      rm: v.rm === 'on' || v.rm === 'off' ? v.rm : 'system',
    };
  } catch {
    return null;
  }
}

/** Mirrors the interface preferences for the boot script (same lifetime and flags as the theme cookie). */
export function writeInterfaceCookie(value: InterfaceCookie): void {
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${INTERFACE_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Max-Age=${ONE_YEAR_SEC}; SameSite=Lax${secure}`;
}
