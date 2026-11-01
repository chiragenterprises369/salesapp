'use client';

import './board.css';
import type { Board, LeadListItem } from '@vistar/shared';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { QualityMonitor, resolveMotionProfile, useQuality, useTimeScale } from '@/features/shared/physics';
import { cn } from '@/lib/cn';
import { useLabels } from '@/lib/customization';
import { applyMoveToBoard, useLeadsBoard, useMoveLead } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useCan } from '@/lib/session/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { ActionsSheet } from './actions-sheet';
import { BoardColumn } from './board-column';
import { useBoardPhysics } from './board-physics.config';
import { BoardError, BoardSkeleton } from './board-states';
import { BoardToolbar } from './board-toolbar';
import { DragLayer } from './drag-layer';
import { BoardController } from './drag/controller';
import { BoardControllerProvider } from './drag/context';
import type { CommitMove } from './drag/types';
import { throttle, useCoarsePointer, useIsMobile, useNow } from './hooks';
import type { LeadsBoardViewProps } from './index';
import { setBoardFlatMode, useBoardFlatMode } from './motion-prefs';
import { boardWordsFrom, BoardWordsProvider } from './words';

interface PendingMove extends CommitMove {
  token: number;
}

/** First-load entrance plays once per page load (not on every view switch). */
let entrancePlayed = false;

/** Has the optimistic update in the query cache caught up with a pending move? */
function isReflected(board: Board, p: PendingMove): boolean {
  const target = board.columns.find((c) => c.stage.id === p.toStageId);
  if (!target) return true;
  const idx = target.leads.findIndex((l) => l.id === p.lead.id);
  if (idx < 0) return false;
  if (p.fromStageId !== p.toStageId) return true;
  const prevOk = !p.beforeLeadId || target.leads[idx - 1]?.id === p.beforeLeadId;
  const nextOk = !p.afterLeadId || target.leads[idx + 1]?.id === p.afterLeadId;
  return prevOk && nextOk;
}

export interface BoardViewProps extends LeadsBoardViewProps {
  /**
   * Dev harness only (/dev/board-physics stress data that the mock source does not know): apply
   * moves locally. The product path always goes through useMoveLead.
   */
  devCommit?: (move: CommitMove) => Promise<unknown>;
  /** Dev harness: share a quality monitor with the demo page (readout, forced tiers). */
  quality?: QualityMonitor;
}

/**
 * Leads Board (kanban). Renders purely from the shared query cache (useLeadsBoard), so realtime
 * patches to that cache show up here with the same animations as local moves (arc flights for
 * moved cards, a drop from above for new leads).
 *
 * Moves: the drop is rendered in the same frame through local pending moves (the data layer's
 * optimistic update lands a few ms later, after it cancels in-flight queries), then
 * useMoveLead takes over: optimistic cache update, per-lead rollback and the error toast.
 */
export function BoardView({ pipelineId, density = 'default', devCommit, quality: sharedQuality }: BoardViewProps) {
  const filters = useLeadsViewState((s) => s.filters);
  const selectMode = useLeadsViewState((s) => s.boardSelectMode);
  const setBoardScroll = useLeadsViewState((s) => s.setBoardScroll);
  const query = useLeadsBoard(pipelineId, filters);
  const { mutateAsync: moveLead } = useMoveLead(pipelineId);
  const isMobile = useIsMobile();
  const coarsePointer = useCoarsePointer();
  const compact = density === 'compact' || isMobile;
  const reducedMotion = useReducedMotion();
  const flat = useBoardFlatMode();
  const physics = useBoardPhysics();
  const timeScale = useTimeScale();
  const labels = useLabels();
  const words = useMemo(() => boardWordsFrom(labels), [labels]);
  const now = useNow();
  const canUpdate = useCan('leads.update');
  const canCreate = useCan('leads.create');
  const canSelect = useCan('leads.bulk');
  const canCall = useCan('calls.make');
  const canMessage = useCan('messages.send');
  const showQuick = canCall || canMessage;

  const [controller] = useState(() => new BoardController());
  const [ownQuality] = useState(() => new QualityMonitor({ fpsFloor: physics.fpsFloor }));
  const quality = sharedQuality ?? ownQuality;
  const { tier } = useQuality(quality);
  const profile = useMemo(() => resolveMotionProfile({ reducedMotion, flat, tier }), [reducedMotion, flat, tier]);

  const [pending, setPending] = useState<PendingMove[]>([]);
  const [sheet, setSheet] = useState<{ lead: LeadListItem; stageId: string } | null>(null);
  const [entrance, setEntrance] = useState(() => !entrancePlayed);
  const tokenRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const lastFilters = useRef<typeof filters | null>(null);
  const dragHelpId = useId();
  const selectHelpId = useId();

  const board = query.data;
  const display = useMemo(() => {
    if (!board) return board;
    let out = board;
    for (const p of pending) {
      if (isReflected(board, p)) continue;
      out = applyMoveToBoard(out, { lead: p.lead, fromStageId: p.fromStageId, toStageId: p.toStageId, beforeId: p.beforeLeadId, afterId: p.afterLeadId });
    }
    return out;
  }, [board, pending]);

  const meta = useMemo(() => {
    const columns = display?.columns ?? [];
    return {
      stageOrder: columns.map((c) => c.stage.id),
      stageNames: new Map(columns.map((c) => [c.stage.id, c.stage.name])),
      counts: new Map(columns.map((c) => [c.stage.id, c.count])),
      totalCount: columns.reduce((n, c) => n + c.count, 0),
      totalValue: columns.reduce((n, c) => n + c.totalValueInr, 0),
    };
  }, [display]);

  const commit = useCallback(
    (moves: CommitMove[]) => {
      const items = moves.map((m) => ({ ...m, token: ++tokenRef.current }));
      setPending((p) => [...p.filter((x) => !items.some((m) => m.lead.id === x.lead.id)), ...items]);
      for (const m of items) {
        const run = devCommit
          ? devCommit(m)
          : moveLead({ lead: m.lead, move: { stageId: m.toStageId, beforeLeadId: m.beforeLeadId, afterLeadId: m.afterLeadId } });
        void run
          // The data layer already rolled the card back and showed the toast; animate the return.
          .catch(() => controller.noteRollback(m.lead.id))
          .finally(() => setPending((p) => p.filter((x) => x.token !== m.token)));
      }
    },
    [moveLead, devCommit, controller],
  );

  const openActions = useCallback((lead: LeadListItem, stageId: string) => setSheet({ lead, stageId }), []);

  useLayoutEffect(() => {
    controller.configure({
      canDrag: canUpdate,
      selectMode,
      selectedIds: () => useLeadsViewState.getState().selectedIds,
      profile,
      physics,
      timeScale,
      gap: compact ? 6 : 8,
      stageOrder: meta.stageOrder,
      stageNames: meta.stageNames,
      counts: meta.counts,
      words: { lead: words.oneLower, leads: words.manyLower },
      commit,
      openActions,
      quality,
    });
  });

  useEffect(() => quality.configure({ fpsFloor: physics.fpsFloor }), [quality, physics.fpsFloor]);
  useEffect(() => () => ownQuality.dispose(), [ownQuality]);

  const hasBoard = !!display;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const live = liveRef.current;
    if (!scroller || !live) return;
    return controller.attachBoard(scroller, live);
  }, [controller, hasBoard]);

  // Drag phase on the root for styling and tests (no React render per phase change).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.dataset.boardPhase = controller.store.getState().phase;
    return controller.store.subscribe((s) => {
      root.dataset.boardPhase = s.phase;
    });
  }, [controller]);

  // After every board commit (all columns have run their layout pass): land drops, fly cards in.
  // New data for changed filters is a reflow (cards fade in), not a stream of new leads.
  const dataFilters = query.isPlaceholderData ? null : filters;
  useLayoutEffect(() => {
    if (dataFilters && lastFilters.current !== dataFilters) {
      if (lastFilters.current !== null) controller.beginReflow();
      lastFilters.current = dataFilters;
    }
    controller.afterCommit();
  }, [controller, display, dataFilters]);

  useEffect(() => () => controller.dispose(), [controller]);

  // Entrance once: drop the stagger props after it played so remounted cards never replay it.
  const columnCount = display?.columns.length ?? 0;
  useEffect(() => {
    if (!hasBoard || !entrance) return;
    entrancePlayed = true;
    const t = window.setTimeout(() => setEntrance(false), physics.entranceStaggerMs * (columnCount + 7) + 400);
    return () => window.clearTimeout(t);
  }, [hasBoard, entrance, physics.entranceStaggerMs, columnCount]);

  // Restore the horizontal scroll once the columns exist (view switches remount the board).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (restoredRef.current || !el || !hasBoard) return;
    restoredRef.current = true;
    el.scrollLeft = useLeadsViewState.getState().scroll.board.left;
  }, [hasBoard]);

  // Columns scroll on their own, so the board fills the viewport down to its bottom edge.
  // `max-h-full` keeps it inside a parent that has a definite height (the page shell).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.height = `${Math.max(360, window.innerHeight - top - 16)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const persistLeft = useMemo(() => throttle((left: number) => setBoardScroll({ left }), 150), [setBoardScroll]);

  const stages = display?.pipeline.stages ?? [];
  const instructionsId = selectMode ? selectHelpId : canUpdate ? dragHelpId : undefined;
  const retry = () => void query.refetch();
  const enterOn = entrance && profile.stagger;
  const rootStyle = {
    '--vb-perspective': `${physics.perspective}px`,
    '--vb-thickness': `${physics.cardThickness}px`,
    '--vb-neighbour-opacity': physics.neighbourOpacity,
    '--vb-sheen': physics.sheen,
    '--vb-hover-lift': `${physics.hoverLift}px`,
  } as CSSProperties;
  const depthAttrs = {
    'data-depth': profile.depth,
    'data-sheen': profile.sheen && physics.sheen > 0 ? 'on' : 'off',
    'data-motion': profile.mode,
  };

  return (
    <BoardWordsProvider value={words}>
      <BoardControllerProvider value={controller}>
        <div
          ref={rootRef}
          className="vb-depth flex max-h-full min-h-0 w-full min-w-0 flex-col"
          style={rootStyle}
          {...depthAttrs}
          data-quality={profile.tier}
          data-pending={pending.length}
          aria-busy={query.isFetching && query.isPlaceholderData}
        >
          {query.isPending ? (
            <BoardSkeleton />
          ) : !display ? (
            <BoardError onRetry={retry} retrying={query.isFetching} />
          ) : (
            <>
              <BoardToolbar
                totalCount={meta.totalCount}
                totalValue={meta.totalValue}
                updating={query.isFetching && query.isPlaceholderData}
                refreshFailed={query.isError}
                onRetry={retry}
                canSelect={canSelect}
                filtersActive={Object.keys(filters).length > 0}
                touch={compact || coarsePointer}
                flat={flat}
                onToggleFlat={() => setBoardFlatMode(!flat)}
              />
              <div
                ref={scrollerRef}
                role="region"
                aria-label={`${display.pipeline.name} pipeline`}
                data-dim={profile.dim ? 'on' : 'off'}
                onScroll={(e) => persistLeft(e.currentTarget.scrollLeft)}
                className={cn(
                  // `relative` keeps absolutely positioned descendants (sr-only text) inside the scroller.
                  'relative flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2',
                  'snap-x snap-mandatory md:snap-none data-[dragging=true]:snap-none',
                  // While a card is dragged, cards under the pointer must not react to hover.
                  'data-[dragging=true]:[&_li]:pointer-events-none',
                )}
              >
                {display.columns.map((column, i) => (
                  <BoardColumn
                    key={column.stage.id}
                    column={column}
                    pipelineId={pipelineId}
                    filters={filters}
                    compact={compact}
                    canDrag={canUpdate}
                    canMove={canUpdate && !selectMode}
                    canCreate={canCreate}
                    selectMode={selectMode}
                    showQuick={showQuick}
                    alwaysShowActions={compact || coarsePointer}
                    stages={stages}
                    now={now}
                    instructionsId={instructionsId}
                    valueShare={meta.totalValue > 0 ? column.totalValueInr / meta.totalValue : 0}
                    virtualizeOver={physics.virtualizeOver}
                    pulses={profile.pulses}
                    numberTickMs={physics.numberTickMs}
                    countPulseMs={physics.countPulseMs}
                    enter={enterOn ? { base: i * physics.entranceStaggerMs, step: physics.entranceStaggerMs } : undefined}
                  />
                ))}
              </div>
              <DragLayer compact={compact} now={now} rootStyle={rootStyle} depthAttrs={depthAttrs} />
              <ActionsSheet
                target={sheet}
                stages={stages}
                canMove={canUpdate}
                showQuick={showQuick}
                onClose={() => setSheet(null)}
                onMove={(lead, from, to) => controller.moveToStage(lead, from, to)}
              />
            </>
          )}
          <p id={dragHelpId} hidden>
            Press Space to pick up the {words.oneLower}. Then use the arrow keys to choose a stage and position, Space to drop, or Escape to cancel. The Move
            to stage button does the same.
          </p>
          <p id={selectHelpId} hidden>
            Press Space to select or clear this {words.oneLower}. Drag a selected card to move every selected {words.oneLower} together.
          </p>
          <div ref={liveRef} aria-live="assertive" aria-atomic="true" className="sr-only" data-board-live="" />
        </div>
      </BoardControllerProvider>
    </BoardWordsProvider>
  );
}
