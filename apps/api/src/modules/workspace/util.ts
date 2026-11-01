import type { EventActor } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';

/** Lowercase ASCII slug. `sep` joins words ("-" for workspace slugs, "_" for role keys). */
export function slugify(input: string, sep: '-' | '_' = '-', maxLength = 48): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .slice(0, maxLength);
  return slug.split(sep).filter(Boolean).join(sep);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz: string, path = 'timezone'): void {
  if (!isValidTimeZone(tz)) {
    throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path, message: 'Use an IANA timezone, e.g. Asia/Kolkata' }] });
  }
}

/** Event actor for the caller. */
export function actorOf(auth: AuthContext, name: string | null = null): EventActor {
  if (auth.via === 'api_key') return { type: 'api_key', id: auth.apiKeyId, name: null };
  return { type: 'user', id: auth.userId, name };
}

/** Field-level diff of changed keys: { key: { from, to } }. */
export function diffOf<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(after)) {
    if (to === undefined) continue;
    const from = before[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[k] = { from: from ?? null, to };
  }
  return out;
}
