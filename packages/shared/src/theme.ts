import { z } from 'zod';

/**
 * Theme contract.
 * - The <html> element carries `data-theme="light|dark"` (resolved) and `data-theme-mode="<mode>"`.
 * - CSS tokens switch on `[data-theme="dark"]`. `color-scheme` is set to match.
 * - The user's preference is stored on the server (UserSettings.theme) and mirrored into the
 *   `vistar_theme` cookie so the pre-paint boot script can apply it with no flash.
 * - "scheduled" uses the WORKSPACE timezone (cookie field `tz`).
 */
export const THEME_MODES = ['system', 'light', 'dark', 'scheduled'] as const;
export const ThemeModeSchema = z.enum(THEME_MODES);
export type ThemeMode = z.infer<typeof ThemeModeSchema>;
export type ResolvedTheme = 'light' | 'dark';

export const HhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Use 24h HH:MM' });

export const ThemePreferenceSchema = z.object({
  mode: ThemeModeSchema.default('light'),
  /** Start of dark period for "scheduled" mode, workspace timezone, 24h HH:MM. */
  darkFrom: HhMmSchema.default('19:00'),
  /** End of dark period for "scheduled" mode, workspace timezone, 24h HH:MM. */
  darkTo: HhMmSchema.default('07:00'),
});
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = { mode: 'light', darkFrom: '19:00', darkTo: '07:00' };

export const THEME_COOKIE = 'vistar_theme';
export const THEME_ATTRIBUTE = 'data-theme';
export const THEME_MODE_ATTRIBUTE = 'data-theme-mode';

/** Cookie value shape (JSON, URI-encoded). */
export const ThemeCookieSchema = ThemePreferenceSchema.extend({ tz: z.string().default('Asia/Kolkata') });
export type ThemeCookie = z.infer<typeof ThemeCookieSchema>;

export function encodeThemeCookie(value: ThemeCookie): string {
  return encodeURIComponent(JSON.stringify(value));
}

function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes since midnight in the given IANA timezone. */
export function minutesInTimeZone(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** True when `minute` falls in [from, to), handling windows that cross midnight. */
export function isInDarkWindow(minute: number, darkFrom: string, darkTo: string): boolean {
  const from = toMinutes(darkFrom);
  const to = toMinutes(darkTo);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

export interface ResolveThemeInput {
  preference: ThemePreference;
  /** Result of matchMedia('(prefers-color-scheme: dark)'). Server side: pass false. */
  prefersDark: boolean;
  now?: Date;
  /** Workspace timezone (IANA). */
  timeZone?: string;
}

/** Single source of truth for resolving a theme preference to light/dark. */
export function resolveTheme({ preference, prefersDark, now = new Date(), timeZone = 'Asia/Kolkata' }: ResolveThemeInput): ResolvedTheme {
  switch (preference.mode) {
    case 'light':
      return 'light';
    case 'dark':
      return 'dark';
    case 'scheduled':
      return isInDarkWindow(minutesInTimeZone(now, timeZone), preference.darkFrom, preference.darkTo) ? 'dark' : 'light';
    case 'system':
    default:
      return prefersDark ? 'dark' : 'light';
  }
}

/** Milliseconds until the next scheduled switch (for a client timer). Null if not scheduled. */
export function msUntilNextThemeSwitch(preference: ThemePreference, now: Date, timeZone: string): number | null {
  if (preference.mode !== 'scheduled') return null;
  const cur = minutesInTimeZone(now, timeZone);
  const targets = [toMinutes(preference.darkFrom), toMinutes(preference.darkTo)];
  const deltas = targets.map((t) => (t - cur + 1440) % 1440 || 1440);
  const minutes = Math.min(...deltas);
  return minutes * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds();
}

/**
 * Inline script for <head> that applies the theme before first paint (no flash).
 * Mirrors resolveTheme(); keep the two in sync. Usage in Next.js root layout:
 * <script dangerouslySetInnerHTML={{ __html: getThemeBootScript() }} />
 */
export function getThemeBootScript(): string {
  return `(function(){try{var d=document.documentElement,p={mode:'light',darkFrom:'19:00',darkTo:'07:00',tz:'Asia/Kolkata'};var c=document.cookie.split('; ').find(function(x){return x.indexOf('${THEME_COOKIE}=')===0});if(c){try{var v=JSON.parse(decodeURIComponent(c.split('=').slice(1).join('=')));for(var k in v){p[k]=v[k]}}catch(e){}}function mins(s){var a=s.split(':');return(+a[0])*60+(+a[1])}var t='light';if(p.mode==='light'){t='light'}else if(p.mode==='dark'){t='dark'}else if(p.mode==='scheduled'){var parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());var h=0,m=0;parts.forEach(function(x){if(x.type==='hour')h=+x.value;if(x.type==='minute')m=+x.value});var n=h*60+m,f=mins(p.darkFrom),to=mins(p.darkTo);t=(f===to)?'dark':(f<to?(n>=f&&n<to):(n>=f||n<to))?'dark':'light'}else if(p.mode==='system'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.setAttribute('${THEME_ATTRIBUTE}',t);d.setAttribute('${THEME_MODE_ATTRIBUTE}',p.mode);d.style.colorScheme=t}catch(e){}})();`;
}
