import { AppException } from '../../../common/errors/app-exception.js';

/**
 * Opaque keyset cursors: base64url(JSON). Each list encodes the sort key of the last row plus its id,
 * so the next page continues after (sortValue, id) even if rows were inserted in between.
 */
export function encodeCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string, check: (value: Record<string, unknown>) => value is T): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !check(parsed as Record<string, unknown>)) throw invalidCursor();
  return parsed as T;
}

export const invalidCursor = () =>
  new AppException('VALIDATION_FAILED', 'This page link has expired. Reload the list.', { details: [{ path: 'cursor', message: 'Invalid cursor' }] });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Cursor over (createdAt desc, id desc), used by timelines and notification lists. */
export interface TimeCursor extends Record<string, unknown> {
  t: string;
  id: string;
}
export const isTimeCursor = (v: Record<string, unknown>): v is TimeCursor => typeof v.t === 'string' && !Number.isNaN(Date.parse(v.t)) && isUuid(v.id);

/** Prisma `where` fragment for rows strictly after a (createdAt desc, id desc) cursor. */
export function afterTimeCursor(cursor: string | undefined, field = 'createdAt'): Record<string, unknown> {
  if (!cursor) return {};
  const c = decodeCursor(cursor, isTimeCursor);
  const t = new Date(c.t);
  return { OR: [{ [field]: { lt: t } }, { [field]: t, id: { lt: c.id } }] };
}

export function nextTimeCursor<R extends { id: string; createdAt: Date }>(rows: R[], limit: number): string | null {
  if (rows.length <= limit) return null;
  const last = rows[limit - 1]!;
  return encodeCursor({ t: last.createdAt.toISOString(), id: last.id });
}
