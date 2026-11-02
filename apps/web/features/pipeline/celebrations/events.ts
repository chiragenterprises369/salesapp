import type { Board, LeadListItem, Stage } from '@vistar/shared';

/**
 * Board events for celebrations, detected from real data: a diff of two board renders (the same
 * query cache that realtime events, local moves and the mock live feed patch). Pure, no DOM.
 */

export const CELEBRATION_KINDS = ['new-lead', 'stage-move', 'quote-sent', 'won', 'lost'] as const;
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

export interface BoardEvent {
  kind: CelebrationKind;
  lead: LeadListItem;
  /** Null for a new lead, or when the card came from a column page that was not loaded. */
  fromStageId: string | null;
  toStageId: string;
  /** Target column INR total before and after (Won count-up). */
  totalBefore: number;
  totalAfter: number;
}

/** Stage keys that mean "a quote went out" (default pipeline: quote_sent). */
const QUOTE_KEYS = new Set(['quote_sent', 'quote', 'proposal_sent', 'proposal']);

export function isQuoteStage(stage: Pick<Stage, 'key'>): boolean {
  return QUOTE_KEYS.has(stage.key);
}

/** What entering this stage celebrates. */
export function kindForStage(stage: Pick<Stage, 'key' | 'type'>): Exclude<CelebrationKind, 'new-lead'> {
  if (stage.type === 'won') return 'won';
  if (stage.type === 'lost') return 'lost';
  if (isQuoteStage(stage)) return 'quote-sent';
  return 'stage-move';
}

export interface BoardSnapshot {
  pipelineId: string;
  stageOf: Map<string, string>;
  counts: Map<string, number>;
  totals: Map<string, number>;
  totalCount: number;
}

export function snapshotBoard(board: Board): BoardSnapshot {
  const stageOf = new Map<string, string>();
  const counts = new Map<string, number>();
  const totals = new Map<string, number>();
  let totalCount = 0;
  for (const c of board.columns) {
    counts.set(c.stage.id, c.count);
    totals.set(c.stage.id, c.totalValueInr);
    totalCount += c.count;
    for (const l of c.leads) stageOf.set(l.id, c.stage.id);
  }
  return { pipelineId: board.pipeline.id, stageOf, counts, totals, totalCount };
}

/** A new card counts as a new lead only near the top of its column (D-037: new leads go to the top). */
const NEW_LEAD_MAX_INDEX = 2;
/** More changes than this in one render is a bulk change or a resync: no celebrations. */
export const MAX_EVENTS_PER_DIFF = 12;

export interface BoardDiff {
  events: BoardEvent[];
  /** Too many changes at once (bulk stage change, import, resync): events were dropped. */
  bulk: boolean;
}

/**
 * Events between two renders of the same pipeline and filters. Moves within a column, page loads
 * (cards appended below) and removals are not events.
 */
export function diffBoards(prev: BoardSnapshot, next: Board): BoardDiff {
  if (prev.pipelineId !== next.pipeline.id) return { events: [], bulk: false };
  const events: BoardEvent[] = [];
  let nextTotalCount = 0;
  for (const c of next.columns) nextTotalCount += c.count;
  const grew = nextTotalCount > prev.totalCount;
  // Columns that lost cards (origin of a move whose card was not loaded there).
  const shrunk = next.columns.filter((c) => c.count < (prev.counts.get(c.stage.id) ?? c.count)).map((c) => c.stage.id);

  for (const c of next.columns) {
    const id = c.stage.id;
    const before = prev.counts.get(id);
    const common = { toStageId: id, totalBefore: prev.totals.get(id) ?? c.totalValueInr, totalAfter: c.totalValueInr };
    for (let i = 0; i < c.leads.length; i++) {
      const lead = c.leads[i]!;
      const was = prev.stageOf.get(lead.id);
      if (was === id) continue;
      if (was !== undefined) {
        events.push({ kind: kindForStage(c.stage), lead, fromStageId: was, ...common });
        continue;
      }
      // Unknown card: new (top of the column, the column and the board grew) or a move from an unloaded page.
      if (i > NEW_LEAD_MAX_INDEX || before === undefined || c.count <= before) continue;
      if (grew) events.push({ kind: 'new-lead', lead, fromStageId: null, ...common });
      else events.push({ kind: kindForStage(c.stage), lead, fromStageId: shrunk.length === 1 ? shrunk[0]! : null, ...common });
    }
  }
  if (events.length > MAX_EVENTS_PER_DIFF) return { events: [], bulk: true };
  return { events, bulk: false };
}
