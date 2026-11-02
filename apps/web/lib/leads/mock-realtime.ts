'use client';

import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { Board, BoardColumn, LeadFilters, LeadListItem } from '@vistar/shared';
import { createEventSimulator } from '@vistar/shared/fixtures';
import { useEffect } from 'react';
import { applyMoveToBoard, getLeadsSource, leadKeys, patchListItem } from './data';
import { mockLeadsSource } from './mock-source';

/**
 * Mock realtime for the Leads page (mock data layer only). OWNER: orchestrator; written by
 * frontend-physics for SPEC 28.1 (granted).
 *
 * - createRealtimeSim(): "realtime" events from createEventSimulator applied to the board caches the
 *   way the realtime updaters will (stage.changed -> applyMoveToBoard, lead.created -> top of its
 *   column). `persist` writes through the mock leads source first, so later refetches agree; stress
 *   data (dev page) only patches the local cache. Used by /dev/board-physics and the live feed.
 * - useMockLiveLeads(): a gentle live feed on the Leads Board: a new lead every 20-40 s, a teammate
 *   stage move every 30-60 s (sometimes a quote sent, a won or a lost). Paused while the tab is
 *   hidden. Off under automation (navigator.webdriver) unless localStorage `vistar.mock.live=1`;
 *   `vistar.mock.live=0` turns it off for a user. `vistar.mock.live.fast=1` runs it 20x faster (tests).
 */

export type SimMoveKind = 'move' | 'quote' | 'won' | 'lost';

export interface RealtimeSim {
  /** A teammate moves a visible card to another open stage (top of the target column). */
  moveByTeammate: () => void;
  /** A new lead arrives in the first stage ("New"). */
  newLead: () => void;
  /** A teammate moves a visible open card to Quote sent, Won or Lost. */
  moveTo: (kind: SimMoveKind) => void;
  /** Several wins in quick succession (`count` cards, `gapMs` apart). */
  wonBurst: (count: number, gapMs?: number) => void;
  /** Several teammate moves at the same moment. */
  movesAtOnce: (count: number) => void;
}

const QUOTE_KEYS = new Set(['quote_sent', 'quote', 'proposal_sent', 'proposal']);

const filtersOf = (key: QueryKey): LeadFilters | null => (key[2] as { filters?: LeadFilters } | undefined)?.filters ?? null;
const unfiltered = (f: LeadFilters | null) => !f || Object.keys(f).length === 0;

export function insertTop(b: Board, lead: LeadListItem): Board {
  return {
    ...b,
    columns: b.columns.map((c) =>
      c.stage.id === lead.stageId && !c.leads.some((l) => l.id === lead.id)
        ? { ...c, leads: [lead, ...c.leads], count: c.count + 1, totalValueInr: c.totalValueInr + lead.valueInr }
        : c,
    ),
  };
}

function pickRandom<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

function targetColumn(board: Board, kind: SimMoveKind, from: BoardColumn | null): BoardColumn | undefined {
  const cols = board.columns;
  if (kind === 'won') return cols.find((c) => c.stage.type === 'won');
  if (kind === 'lost') return cols.find((c) => c.stage.type === 'lost');
  if (kind === 'quote') return cols.find((c) => QUOTE_KEYS.has(c.stage.key)) ?? cols.filter((c) => c.stage.type === 'open').at(-1);
  const open = cols.filter((c) => c.stage.type === 'open' && c.stage.id !== from?.stage.id && !QUOTE_KEYS.has(c.stage.key));
  // Mostly forward: the next open stage after the source.
  const next = from ? open.find((c) => c.stage.order > from.stage.order) : undefined;
  return next && Math.random() < 0.7 ? next : pickRandom(open);
}

/**
 * Realtime simulator bound to a query client. `persist` writes through the mock leads source and
 * patches the cache after the save (like an event published after commit); without it (stress
 * data) only the local cache changes.
 */
export function createRealtimeSim(client: QueryClient, pipelineId: string, persist: boolean): RealtimeSim {
  const sim = createEventSimulator({ seed: 2026 });
  const key = ['board', pipelineId] as const;
  /** Leads with a move in flight (a burst never moves the same card twice). */
  const busy = new Set<string>();

  const current = (): Board | undefined => {
    const entries = client.getQueriesData<Board>({ queryKey: key });
    return (entries.find(([k, b]) => !!b && unfiltered(filtersOf(k))) ?? entries.find(([, b]) => !!b))?.[1];
  };

  /** Patch every cached board of the pipeline; filtered boards refetch (the event may not match their filters). */
  const patchBoards = (fn: (b: Board) => Board) => {
    for (const [k, b] of client.getQueriesData<Board>({ queryKey: key })) {
      if (!b) continue;
      if (!persist || unfiltered(filtersOf(k))) client.setQueryData<Board>(k, fn(b));
      else void client.invalidateQueries({ queryKey: k, exact: true });
    }
  };

  const move = (lead: LeadListItem, from: BoardColumn, to: BoardColumn) => {
    const afterId = to.leads.find((l) => l.id !== lead.id)?.id ?? null;
    if (!persist) {
      patchBoards((b) => applyMoveToBoard(b, { lead, fromStageId: from.stage.id, toStageId: to.stage.id, beforeId: null, afterId }));
      busy.delete(lead.id);
      return;
    }
    busy.add(lead.id);
    void getLeadsSource()
      .move(lead.id, { stageId: to.stage.id, beforeLeadId: null, afterLeadId: afterId })
      .then((saved) => {
        patchBoards((b) => applyMoveToBoard(b, { lead: saved, fromStageId: from.stage.id, toStageId: to.stage.id, beforeId: null, afterId, position: saved.position }));
        patchListItem(client, saved);
      })
      // The teammate's save failed: for this tab nothing happened.
      .catch(() => undefined)
      .finally(() => busy.delete(lead.id));
  };

  /** A visible card (top of an open column) to move to `kind`, or null. */
  const pick = (board: Board, kind: SimMoveKind, exclude: ReadonlySet<string>) => {
    const fixedTarget = kind === 'move' ? null : targetColumn(board, kind, null);
    const sources = board.columns.filter(
      (c) => c.stage.type === 'open' && c.stage.id !== fixedTarget?.stage.id && c.leads.some((l) => !exclude.has(l.id) && !busy.has(l.id)),
    );
    const from = pickRandom(sources);
    if (!from) return null;
    const to = fixedTarget ?? targetColumn(board, 'move', from);
    if (!to || to.stage.id === from.stage.id) return null;
    const visible = from.leads.filter((l) => !exclude.has(l.id) && !busy.has(l.id)).slice(0, 4);
    const lead = pickRandom(visible);
    return lead ? { lead, from, to } : null;
  };

  const moveTo = (kind: SimMoveKind) => {
    const board = current();
    const m = board && pick(board, kind, new Set());
    if (m) move(m.lead, m.from, m.to);
  };

  return {
    moveByTeammate: () => moveTo('move'),
    moveTo,
    newLead() {
      const board = current();
      const first = board?.columns[0]?.stage;
      if (!board || !first) return;
      let created: LeadListItem | null = null;
      for (let i = 0; i < 60 && !created; i++) {
        for (const e of sim.next()) if (e.type === 'lead.created') created = (e.payload as { lead: LeadListItem }).lead;
      }
      if (!created) return;
      const now = new Date().toISOString();
      const lead: LeadListItem = { ...created, id: crypto.randomUUID(), stageId: first.id, pipelineId: board.pipeline.id, position: '0', createdAt: now, updatedAt: now };
      if (!persist) {
        patchBoards((b) => insertTop(b, lead));
        return;
      }
      void getLeadsSource()
        .create({ name: lead.name, companyName: lead.companyName ?? undefined, phone: lead.phone ?? undefined, city: lead.city ?? undefined, valueInr: lead.valueInr, stageId: first.id, source: lead.source, tags: lead.tags, customFields: {} })
        .then((saved) => {
          patchBoards((b) => insertTop(b, saved));
          void client.invalidateQueries({ queryKey: leadKeys.lists() });
        })
        .catch(() => undefined);
    },
    wonBurst(count, gapMs = 90) {
      const board = current();
      if (!board) return;
      const taken = new Set<string>();
      const moves: Array<{ lead: LeadListItem; from: BoardColumn; to: BoardColumn }> = [];
      for (let i = 0; i < count; i++) {
        const m = pick(board, 'won', taken);
        if (!m) break;
        taken.add(m.lead.id);
        // Reserved until its move runs, so moves picked meanwhile never take the same card.
        busy.add(m.lead.id);
        moves.push(m);
      }
      moves.forEach((m, i) => window.setTimeout(() => move(m.lead, m.from, m.to), i * gapMs));
    },
    movesAtOnce(count) {
      const board = current();
      if (!board) return;
      const taken = new Set<string>();
      for (let i = 0; i < count; i++) {
        const m = pick(board, 'move', taken);
        if (!m) break;
        taken.add(m.lead.id);
        move(m.lead, m.from, m.to);
      }
    },
  };
}

// ---------------------------------------------------------------- live feed

export const MOCK_LIVE_KEY = 'vistar.mock.live';
export const MOCK_LIVE_FAST_KEY = 'vistar.mock.live.fast';

export type MockLiveReason = 'on' | 'not-mock' | 'webdriver' | 'opted-out' | 'disabled';

/** Test and devtools hook: `window.__vistarMockLive`. */
export interface MockLiveHandle {
  active: boolean;
  reason: MockLiveReason;
  /** Events applied so far by the live feed. */
  events: number;
  /** Fire one event now (tests, devtools). */
  trigger: (kind: 'new' | SimMoveKind) => void;
}

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Should the live feed run in this tab? */
export function mockLiveReason(): MockLiveReason {
  if (getLeadsSource() !== mockLeadsSource) return 'not-mock';
  const flag = readFlag(MOCK_LIVE_KEY);
  if (flag === '0') return 'opted-out';
  if (flag === '1') return 'on';
  return navigator.webdriver ? 'webdriver' : 'on';
}

const randomIn = (min: number, max: number) => min + Math.random() * (max - min);

function publish(handle: MockLiveHandle | null) {
  (window as unknown as { __vistarMockLive?: MockLiveHandle | null }).__vistarMockLive = handle;
}

/** One live feed per tab, whatever number of boards is mounted. */
let liveOwner: symbol | null = null;

/** Gentle mock live feed for the Leads Board (see the file comment). */
export function useMockLiveLeads(pipelineId: string, opts: { enabled?: boolean } = {}) {
  const client = useQueryClient();
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    const reason: MockLiveReason = enabled ? mockLiveReason() : 'disabled';
    const idle: MockLiveHandle = { active: false, reason, events: 0, trigger: () => undefined };
    if (reason !== 'on' || liveOwner) {
      if (!liveOwner) publish(idle);
      return;
    }
    const me = Symbol('mock-live');
    liveOwner = me;
    const sim = createRealtimeSim(client, pipelineId, true);
    const scale = readFlag(MOCK_LIVE_FAST_KEY) === '1' ? 0.05 : 1;
    const handle: MockLiveHandle = {
      active: true,
      reason,
      events: 0,
      trigger: (kind) => {
        handle.events++;
        if (kind === 'new') sim.newLead();
        else sim.moveTo(kind);
      },
    };
    let leadTimer = 0;
    let moveTimer = 0;

    const nextLead = () => {
      leadTimer = window.setTimeout(() => {
        handle.trigger('new');
        nextLead();
      }, randomIn(20_000, 40_000) * scale);
    };
    const nextMove = () => {
      moveTimer = window.setTimeout(() => {
        const r = Math.random();
        handle.trigger(r < 0.6 ? 'move' : r < 0.78 ? 'quote' : r < 0.9 ? 'won' : 'lost');
        nextMove();
      }, randomIn(30_000, 60_000) * scale);
    };
    const stop = () => {
      window.clearTimeout(leadTimer);
      window.clearTimeout(moveTimer);
      leadTimer = 0;
      moveTimer = 0;
    };
    const start = () => {
      if (document.hidden || leadTimer || moveTimer) return;
      nextLead();
      nextMove();
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    document.addEventListener('visibilitychange', onVisibility);
    start();
    publish(handle);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      if (liveOwner === me) liveOwner = null;
      publish({ ...idle, reason: 'disabled' });
    };
  }, [client, pipelineId, enabled]);
}
