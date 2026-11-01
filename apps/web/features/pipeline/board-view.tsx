'use client';

import type { Board } from '@vistar/shared';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { applyMoveToBoard, useLeadsBoard, useMoveLead } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { useCan } from '@/lib/session/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { BoardColumn } from './board-column';
import { BoardError, BoardSkeleton } from './board-states';
import { BoardToolbar } from './board-toolbar';
import { DragLayer } from './drag-layer';
import { BoardController } from './drag/controller';
import { BoardControllerProvider } from './drag/context';
import type { CommitMove } from './drag/types';
import { throttle, useIsMobile, useNow } from './hooks';
import type { LeadsBoardViewProps } from './index';

interface PendingMove extends CommitMove {
  token: number;
}

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

/**
 * Leads Board (kanban). Renders purely from the shared query cache (useLeadsBoard), so realtime
 * patches to that cache show up here with the same FLIP animations as local moves.
 *
 * Moves: the drop is rendered in the same frame through a local pending move (the data layer's
 * optimistic update lands a few ms later, after it cancels in-flight queries), then
 * useMoveLead takes over: optimistic cache update, per-lead rollback and the error toast.
 */
export function BoardView({ pipelineId, density = 'default' }: LeadsBoardViewProps) {
  const filters = useLeadsViewState((s) => s.filters);
  const selectMode = useLeadsViewState((s) => s.boardSelectMode);
  const setBoardScroll = useLeadsViewState((s) => s.setBoardScroll);
  const query = useLeadsBoard(pipelineId, filters);
  const { mutateAsync: moveLead } = useMoveLead(pipelineId);
  const isMobile = useIsMobile();
  const compact = density === 'compact' || isMobile;
  const reducedMotion = useReducedMotion();
  const now = useNow();
  const canUpdate = useCan('leads.update');
  const canCreate = useCan('leads.create');
  const canSelect = useCan('leads.bulk');
  const canCall = useCan('calls.make');
  const canMessage = useCan('messages.send');
  const showQuick = canCall || canMessage;
  const canDrag = canUpdate && !selectMode;

  const [controller] = useState(() => new BoardController());
  const [pending, setPending] = useState<PendingMove | null>(null);
  const tokenRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const dragHelpId = useId();
  const selectHelpId = useId();

  const board = query.data;
  const display = useMemo(() => {
    if (!board || !pending || isReflected(board, pending)) return board;
    return applyMoveToBoard(board, {
      lead: pending.lead,
      fromStageId: pending.fromStageId,
      toStageId: pending.toStageId,
      beforeId: pending.beforeLeadId,
      afterId: pending.afterLeadId,
    });
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
    (m: CommitMove) => {
      const token = ++tokenRef.current;
      setPending({ ...m, token });
      moveLead({ lead: m.lead, move: { stageId: m.toStageId, beforeLeadId: m.beforeLeadId, afterLeadId: m.afterLeadId } })
        // The data layer already rolled the card back and showed the toast.
        .catch(() => undefined)
        .finally(() => setPending((p) => (p?.token === token ? null : p)));
    },
    [moveLead],
  );

  useLayoutEffect(() => {
    controller.configure({
      canDrag,
      reducedMotion,
      gap: compact ? 6 : 8,
      stageOrder: meta.stageOrder,
      stageNames: meta.stageNames,
      counts: meta.counts,
      commit,
    });
  });

  const hasBoard = !!display;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const live = liveRef.current;
    if (!scroller || !live) return;
    return controller.attachBoard(scroller, live);
  }, [controller, hasBoard]);

  // After every board commit (all columns have run their layout pass): land drops, fly cards in.
  useLayoutEffect(() => {
    controller.afterCommit();
  }, [controller, display]);

  useEffect(() => () => controller.dispose(), [controller]);

  // Restore the horizontal scroll once the columns exist (view switches remount the board).
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (restoredRef.current || !el || !hasBoard) return;
    restoredRef.current = true;
    el.scrollLeft = useLeadsViewState.getState().scroll.board.left;
  }, [hasBoard]);

  // Columns scroll on their own: cap the board at the viewport bottom when the parent is unbounded.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxHeight = `${Math.max(360, window.innerHeight - top - 16)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const persistLeft = useMemo(() => throttle((left: number) => setBoardScroll({ left }), 150), [setBoardScroll]);

  const stages = display?.pipeline.stages ?? [];
  const instructionsId = selectMode ? selectHelpId : canUpdate ? dragHelpId : undefined;
  const retry = () => void query.refetch();

  return (
    <BoardControllerProvider value={controller}>
      <div ref={rootRef} className="flex h-full min-h-0 w-full min-w-0 flex-col" aria-busy={query.isFetching && query.isPlaceholderData}>
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
            />
            <div
              ref={scrollerRef}
              role="region"
              aria-label={`${display.pipeline.name} pipeline`}
              onScroll={(e) => persistLeft(e.currentTarget.scrollLeft)}
              className={cn(
                'flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2',
                'snap-x snap-mandatory md:snap-none data-[dragging=true]:snap-none',
              )}
            >
              {display.columns.map((column) => (
                <BoardColumn
                  key={column.stage.id}
                  column={column}
                  pipelineId={pipelineId}
                  filters={filters}
                  compact={compact}
                  canDrag={canDrag}
                  canMove={canUpdate && !selectMode}
                  canCreate={canCreate}
                  selectMode={selectMode}
                  showQuick={showQuick}
                  stages={stages}
                  now={now}
                  instructionsId={instructionsId}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>
            <DragLayer compact={compact} now={now} reducedMotion={reducedMotion} />
          </>
        )}
        <p id={dragHelpId} hidden>
          Press Space to pick up the lead. Then use the arrow keys to choose a stage and position, Enter to drop, or Escape to cancel. The Move to stage button
          does the same.
        </p>
        <p id={selectHelpId} hidden>
          Press Space to select or clear this lead.
        </p>
        <div ref={liveRef} aria-live="assertive" aria-atomic="true" className="sr-only" />
      </div>
    </BoardControllerProvider>
  );
}
