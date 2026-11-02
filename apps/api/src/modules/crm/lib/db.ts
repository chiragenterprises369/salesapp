import { Prisma } from '../../../generated/prisma/client.js';

export const isUniqueViolation = (err: unknown): boolean => !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002';

/** Nullable Json column input: null -> DbNull. */
export const jsonOrNull = (v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/** orderBy for a sort key plus the id tiebreaker; nullable columns sort their nulls last. */
export function sortBy<T>(field: string, dir: 'asc' | 'desc', nullable: readonly string[] = []): T {
  const first = nullable.includes(field) ? { [field]: { sort: dir, nulls: 'last' } } : { [field]: dir };
  return [first, { id: dir }] as unknown as T;
}
