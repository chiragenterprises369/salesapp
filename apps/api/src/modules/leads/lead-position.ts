import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import type { TenantDb } from './lib/context.js';

/**
 * Fractional-index positions within a stage column (lexicographic order, ties broken by id).
 * NOTE: ordering relies on byte-wise comparison of `Lead.position` (see CONTRACT-REQUEST for COLLATE "C").
 */
function between(a: string | null, b: string | null): string {
  try {
    return generateKeyBetween(a, b);
  } catch {
    // Corrupt or equal neighbour keys: fall back to the closest valid bound.
    try {
      return generateKeyBetween(a, null);
    } catch {
      return generateKeyBetween(null, b === null ? null : safeKey(b));
    }
  }
}

function safeKey(k: string): string | null {
  try {
    generateKeyBetween(k, null);
    return k;
  } catch {
    return null;
  }
}

async function lastPosition(db: TenantDb, stageId: string, excludeLeadId?: string): Promise<string | null> {
  const last = await db.lead.findFirst({
    where: { stageId, position: { not: '' }, ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}) },
    orderBy: [{ position: 'desc' }, { id: 'desc' }],
    select: { position: true },
  });
  return last ? safeKey(last.position) : null;
}

/** Position at the end of a column (after every lead, including soft-deleted ones, so keys stay unique). */
export async function endOfColumn(db: TenantDb, stageId: string, excludeLeadId?: string): Promise<string> {
  return between(await lastPosition(db, stageId, excludeLeadId), null);
}

/** `n` ascending positions appended to the end of a column. */
export async function endOfColumnKeys(db: TenantDb, stageId: string, n: number, after?: string | null): Promise<string[]> {
  if (n <= 0) return [];
  const start = after !== undefined ? after : await lastPosition(db, stageId);
  return generateNKeysBetween(start, null, n);
}

/** Current top position of a column (null when empty). */
export async function firstPosition(db: TenantDb, stageId: string): Promise<string | null> {
  const first = await db.lead.findFirst({
    where: { stageId, position: { not: '' } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { position: true },
  });
  return first ? safeKey(first.position) : null;
}

/** Position at the top of a column. New leads (create, quick add, import, webhooks) go here (D-037). */
export async function topOfColumn(db: TenantDb, stageId: string): Promise<string> {
  return between(null, await firstPosition(db, stageId));
}

/**
 * `n` ascending positions above every card in a column (index 0 = topmost).
 * `before` lets a batch continue above its previous chunk.
 */
export async function topOfColumnKeys(db: TenantDb, stageId: string, n: number, before?: string | null): Promise<string[]> {
  if (n <= 0) return [];
  const end = before !== undefined ? before : await firstPosition(db, stageId);
  return generateNKeysBetween(null, end, n);
}

/**
 * Position for a card dropped between two neighbours of the target column.
 * `beforeLeadId` = card directly above, `afterLeadId` = card directly below. No neighbours = end of column.
 * Stale neighbours (moved to another column meanwhile) are ignored.
 */
export async function positionBetween(
  db: TenantDb,
  stageId: string,
  movedLeadId: string,
  beforeLeadId?: string | null,
  afterLeadId?: string | null,
): Promise<string> {
  const neighbour = (id: string | null | undefined) =>
    id && id !== movedLeadId ? db.lead.findFirst({ where: { id, stageId, deletedAt: null }, select: { id: true, position: true } }) : null;
  // Sequential on purpose: this runs inside interactive transactions (one connection).
  const before = await neighbour(beforeLeadId);
  const after = await neighbour(afterLeadId);

  if (before && after && before.position < after.position) return between(before.position, after.position);
  if (before) {
    const next = await db.lead.findFirst({
      where: { stageId, deletedAt: null, id: { not: movedLeadId }, position: { gt: before.position } },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      select: { position: true },
    });
    return between(before.position, next?.position ?? null);
  }
  if (after) {
    const prev = await db.lead.findFirst({
      where: { stageId, deletedAt: null, id: { not: movedLeadId }, position: { lt: after.position, not: '' } },
      orderBy: [{ position: 'desc' }, { id: 'desc' }],
      select: { position: true },
    });
    return between(prev?.position ?? null, after.position);
  }
  return endOfColumn(db, stageId, movedLeadId);
}
