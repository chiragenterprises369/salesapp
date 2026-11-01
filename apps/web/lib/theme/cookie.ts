import {
  encodeThemeCookie,
  THEME_COOKIE,
  ThemeCookieSchema,
  type ThemeCookie,
} from '@vistar/shared';

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
