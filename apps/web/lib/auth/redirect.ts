import { canEnterPanel, homePathFor, type Panel, type Principal } from '@vistar/shared';

export const LOGIN_PATH = '/login';
export const SUPER_LOGIN_PATH = '/super-admin/login';

/** Panel a path belongs to, or null for public pages (auth screens, dev routes). */
export function panelForPath(path: string): Panel | null {
  const pathname = path.split(/[?#]/)[0] ?? '';
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (under(SUPER_LOGIN_PATH)) return null;
  if (under('/super-admin')) return 'super-admin';
  if (under('/app')) return 'company';
  if (under('/me')) return 'employee';
  return null;
}

/**
 * Where to go after sign-in. `next` is honoured only if it is a same-origin path inside a panel the
 * principal may enter (no open redirects, no bouncing into a guard); otherwise the role's home.
 */
export function safeNextPath(next: string | null | undefined, principal: Principal): string {
  const home = homePathFor(principal);
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return home;
  const panel = panelForPath(next);
  return panel && canEnterPanel(principal, panel) ? next : home;
}

export function loginPathFor(panel: Panel, next?: string): string {
  const base = panel === 'super-admin' ? SUPER_LOGIN_PATH : LOGIN_PATH;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}
