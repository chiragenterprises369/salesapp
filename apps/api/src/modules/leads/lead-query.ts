import type { LeadFilters, LeadListQuery } from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import type { ScopeService } from '../../common/auth/scope.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { decodeCursor, encodeCursor, invalidCursor, isUuid } from './lib/cursor.js';

export type LeadSort = LeadListQuery['sort'];
export type SortDir = LeadListQuery['dir'];

/**
 * Prisma `where` for LeadFiltersSchema + the caller's data scope + "not deleted".
 * Shared by the lead list, export, board columns and board aggregates so their numbers always agree.
 */
export async function buildLeadWhere(auth: AuthContext, scope: ScopeService, f: Partial<LeadFilters>): Promise<Prisma.LeadWhereInput> {
  const and: Prisma.LeadWhereInput[] = [{ deletedAt: null }];
  const scoped = await scope.where(auth, 'ownerId');
  if (Object.keys(scoped).length) and.push(scoped as Prisma.LeadWhereInput);

  const q = f.q?.trim();
  if (q) {
    const contains = { contains: q, mode: 'insensitive' as const };
    const or: Prisma.LeadWhereInput[] = [
      { name: contains },
      { companyName: contains },
      { email: contains },
      { requirement: contains },
      { phone: { contains: q } },
    ];
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3 && digits !== q) or.push({ phone: { contains: digits } });
    and.push({ OR: or });
  }
  if (f.source?.length) and.push({ source: { in: f.source } });
  if (f.stageId?.length) and.push({ stageId: { in: f.stageId } });
  if (f.ownerId?.length) {
    const ids = [...new Set(f.ownerId.map((v) => (v === 'me' ? auth.userId : v)).filter((v): v is string => !!v && v !== 'unassigned'))];
    const or: Prisma.LeadWhereInput[] = [];
    if (ids.length) or.push({ ownerId: { in: ids } });
    if (f.ownerId.includes('unassigned')) or.push({ ownerId: null });
    and.push(or.length ? { OR: or } : { id: { in: [] } });
  }
  if (f.tag?.length) and.push({ tags: { hasSome: f.tag } });
  if (f.temperature?.length) and.push({ temperature: { in: f.temperature } });
  if (f.scoreMin !== undefined || f.scoreMax !== undefined) {
    and.push({ score: { ...(f.scoreMin !== undefined ? { gte: f.scoreMin } : {}), ...(f.scoreMax !== undefined ? { lte: f.scoreMax } : {}) } });
  }
  if (f.createdFrom || f.createdTo) {
    and.push({
      createdAt: { ...(f.createdFrom ? { gte: new Date(f.createdFrom) } : {}), ...(f.createdTo ? { lte: new Date(f.createdTo) } : {}) },
    });
  }
  return { AND: and };
}

const NULLABLE_SORTS = new Set<LeadSort>(['nextFollowUpAt', 'lastActivityAt']);
const DATE_SORTS = new Set<LeadSort>(['createdAt', 'updatedAt', 'nextFollowUpAt', 'lastActivityAt']);

/** ORDER BY (sort, id); nulls always last so keyset paging stays simple in both directions. */
export function leadOrderBy(sort: LeadSort, dir: SortDir): Prisma.LeadOrderByWithRelationInput[] {
  const primary = NULLABLE_SORTS.has(sort) ? { [sort]: { sort: dir, nulls: 'last' } } : { [sort]: dir };
  return [primary as Prisma.LeadOrderByWithRelationInput, { id: dir }];
}

interface ListCursor extends Record<string, unknown> {
  s: LeadSort;
  d: SortDir;
  v: string | number | null;
  id: string;
}

const isListCursor = (c: Record<string, unknown>): c is ListCursor =>
  typeof c.s === 'string' && (c.d === 'asc' || c.d === 'desc') && isUuid(c.id) && (c.v === null || typeof c.v === 'string' || typeof c.v === 'number');

/** `where` fragment selecting rows after the cursor in (sort, id) order. */
export function leadCursorWhere(cursor: string | undefined, sort: LeadSort, dir: SortDir): Prisma.LeadWhereInput | null {
  if (!cursor) return null;
  const c = decodeCursor(cursor, isListCursor);
  if (c.s !== sort || c.d !== dir) throw invalidCursor(); // sort changed: the cursor no longer applies
  const op = dir === 'asc' ? 'gt' : 'lt';
  const nullable = NULLABLE_SORTS.has(sort);
  if (c.v === null) {
    if (!nullable) throw invalidCursor();
    return { [sort]: null, id: { [op]: c.id } } as Prisma.LeadWhereInput;
  }
  const value = DATE_SORTS.has(sort) ? new Date(String(c.v)) : c.v;
  const or: Prisma.LeadWhereInput[] = [{ [sort]: { [op]: value } }, { [sort]: value, id: { [op]: c.id } }] as Prisma.LeadWhereInput[];
  if (nullable) or.push({ [sort]: null } as Prisma.LeadWhereInput);
  return { OR: or };
}

export function leadNextCursor(row: Record<string, unknown> & { id: string }, sort: LeadSort, dir: SortDir): string {
  const raw = row[sort];
  const v = raw instanceof Date ? raw.toISOString() : raw === null || raw === undefined ? null : (raw as string | number);
  return encodeCursor({ s: sort, d: dir, v, id: row.id });
}
