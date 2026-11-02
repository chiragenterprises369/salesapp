import type { AuthContext } from '../../../common/auth/auth-context.js';
import type { ScopeService } from '../../../common/auth/scope.service.js';
import { decodeCursor, encodeCursor } from '../../leads/lib/cursor.js';

/**
 * Offset cursors for the CRM lists (contacts, accounts, deals, products, documents): opaque
 * base64url({ o }) like the keyset cursors elsewhere, so clients treat them the same way.
 */
interface OffsetCursor extends Record<string, unknown> {
  o: number;
}
const isOffsetCursor = (v: Record<string, unknown>): v is OffsetCursor => typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0 && v.o < 1_000_000;

export function pageArgs(cursor: string | undefined, limit: number): { skip: number; take: number } {
  const skip = cursor ? decodeCursor(cursor, isOffsetCursor).o : 0;
  return { skip, take: limit + 1 };
}

export function pageOut<T>(rows: T[], skip: number, limit: number): { rows: T[]; nextCursor: string | null } {
  return { rows: rows.slice(0, limit), nextCursor: rows.length > limit ? encodeCursor({ o: skip + limit }) : null };
}

/** `ownerId` filter values: ids, 'me', 'unassigned'. */
export function ownerFilter(auth: AuthContext, values: readonly string[] | undefined): Record<string, unknown> | null {
  if (!values?.length) return null;
  const ids = values.map((v) => (v === 'me' ? auth.userId : v)).filter((v): v is string => !!v && v !== 'unassigned');
  const unassigned = values.includes('unassigned');
  const or: Array<Record<string, unknown>> = [];
  if (ids.length) or.push({ ownerId: { in: ids } });
  if (unassigned) or.push({ ownerId: null });
  return or.length === 1 ? or[0]! : { OR: or.length ? or : [{ ownerId: '00000000-0000-7000-8000-000000000000' }] };
}

/**
 * Contacts and accounts: visible to the owner's data scope OR through a visible lead (D-068).
 * Returns null for scope all.
 */
export async function partyScope(scope: ScopeService, auth: AuthContext): Promise<Record<string, unknown> | null> {
  const ids = await scope.visibleUserIds(auth);
  if (ids === null) return null;
  const owner = ids.length === 1 ? ids[0] : { in: ids };
  return { OR: [{ ownerId: owner }, { leads: { some: { ownerId: owner, deletedAt: null } } }] };
}

/** Owner-scoped records (deals, quotations, invoices). Returns null for scope all. */
export async function ownerScope(scope: ScopeService, auth: AuthContext): Promise<Record<string, unknown> | null> {
  const ids = await scope.visibleUserIds(auth);
  if (ids === null) return null;
  return { ownerId: ids.length === 1 ? ids[0] : { in: ids } };
}

/** AND of optional fragments. */
export function and<T>(...parts: Array<Record<string, unknown> | null | undefined | false>): T {
  const list = parts.filter((p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0);
  return (list.length ? { AND: list } : {}) as T;
}
