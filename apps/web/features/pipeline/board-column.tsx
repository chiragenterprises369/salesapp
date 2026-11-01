'use client';

import { formatInr, formatNumber, stageTone, type BoardColumn as BoardColumnData, type LeadFilters, type Stage } from '@vistar/shared';
import { Plus } from 'lucide-react';
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLoadMoreColumn } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { StaticCardList, VIRTUALIZE_OVER, VirtualCardList } from './card-list';
import { useBoardController, useDragState } from './drag/context';
import { throttle } from './hooks';
import { QuickAdd } from './quick-add';
import { COLUMN_TINT, COUNT_BORDER, STAGE_DOT } from './tones';

/** Start loading the next page when the column is this close to its end (px). */
const LOAD_MORE_THRESHOLD = 480;
const PAGE_SIZE = 50;

export interface BoardColumnProps {
  column: BoardColumnData;
  pipelineId: string;
  filters: LeadFilters;
  compact: boolean;
  canDrag: boolean;
  canMove: boolean;
  canCreate: boolean;
  selectMode: boolean;
  showQuick: boolean;
  stages: readonly Stage[];
  now: number;
  instructionsId?: string;
  reducedMotion: boolean;
}

export const BoardColumn = memo(function BoardColumn({
  column,
  pipelineId,
  filters,
  compact,
  canDrag,
  canMove,
  canCreate,
  selectMode,
  showQuick,
  stages,
  now,
  instructionsId,
  reducedMotion,
}: BoardColumnProps) {
  const ctrl = useBoardController();
  const { stage, leads, count, totalValueInr, nextCursor } = column;
  const tone = stageTone(stage);
  const isOver = useDragState((s) => s.phase === 'dragging' && s.over?.stageId === stage.id);
  const [adding, setAdding] = useState(false);
  const frameRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const setColumnScroll = useLeadsViewState((s) => s.setBoardColumnScroll);
  // Saved scroll position (view switches remount the board). Read once.
  const [initialTop] = useState(() => useLeadsViewState.getState().scroll.board.columns[stage.id] ?? 0);
  const { mutate: loadMore, isPending: loadingMore, isError: loadMoreFailed } = useLoadMoreColumn(pipelineId, filters);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const scroll = scrollRef.current;
    if (!frame || !scroll) return;
    const handle = { stageId: stage.id, frame, scroll };
    ctrl.registerColumn(handle);
    return () => ctrl.unregisterColumn(handle);
  }, [ctrl, stage.id]);

  useLayoutEffect(() => {
    if (initialTop && scrollRef.current) scrollRef.current.scrollTop = initialTop;
  }, [initialTop]);

  const persistScroll = useMemo(() => throttle((top: number) => setColumnScroll(stage.id, top), 150), [setColumnScroll, stage.id]);

  const requestMore = useCallback(() => {
    if (nextCursor && !loadingMore) loadMore({ stageId: stage.id, cursor: nextCursor });
  }, [loadMore, loadingMore, nextCursor, stage.id]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    persistScroll(el.scrollTop);
    if (nextCursor && !loadMoreFailed && el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD) requestMore();
  };

  const closeQuickAdd = useCallback(() => {
    setAdding(false);
    addRef.current?.focus();
  }, []);

  const listProps = {
    stageId: stage.id,
    stageName: stage.name,
    leads,
    compact,
    canDrag,
    canMove,
    selectMode,
    showQuick,
    stages,
    now,
    instructionsId,
    reducedMotion,
  };
  const remaining = Math.max(1, count - leads.length);

  return (
    <section
      ref={frameRef}
      aria-labelledby={titleId}
      data-over={isOver || undefined}
      className={cn(
        'flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-lg border md:w-72',
        'transition-shadow duration-150 ease-standard',
        COLUMN_TINT[tone],
        isOver && 'ring-2 ring-accent',
      )}
    >
      <header className={cn('flex items-center gap-2 pr-1.5 pl-3', compact ? 'py-1' : 'pt-2 pb-1.5')}>
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STAGE_DOT[tone])} />
        <h3 id={titleId} className="min-w-0 truncate text-sm font-semibold text-fg">
          {stage.name}
        </h3>
        <span className={cn('shrink-0 rounded-full border bg-surface px-1.5 text-2xs leading-4 font-semibold text-fg-secondary tabular', COUNT_BORDER[tone])}>
          {formatNumber(count)}
          <span className="sr-only"> leads</span>
        </span>
        <span className="ml-auto shrink-0 text-xs font-medium text-muted-strong tabular" title={formatInr(totalValueInr)}>
          <span className="sr-only">Total value </span>
          {formatInr(totalValueInr, { compact: true })}
        </span>
        {canCreate ? (
          <Button
            ref={addRef}
            size={compact ? 'icon-touch' : 'icon-sm'}
            variant="ghost"
            aria-label={`Add lead to ${stage.name}`}
            aria-expanded={adding}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden />
          </Button>
        ) : (
          <span aria-hidden className="w-1.5" />
        )}
      </header>

      {adding && <QuickAdd stage={stage} touch={compact} onClose={closeQuickAdd} />}

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-2">
        {leads.length > VIRTUALIZE_OVER ? (
          <VirtualCardList {...listProps} scrollRef={scrollRef} initialOffset={initialTop} />
        ) : (
          <StaticCardList {...listProps} />
        )}

        {leads.length === 0 && !nextCursor && !isOver && (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <p className="text-xs text-muted-strong">No leads in {stage.name}</p>
            {canCreate && !adding && (
              <Button size={compact ? 'touch' : 'sm'} variant="ghost" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add lead
              </Button>
            )}
          </div>
        )}

        {nextCursor && (
          <div className="pt-2">
            {loadMoreFailed && !loadingMore ? (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
                <span className="text-xs text-danger-text">Could not load more leads.</span>
                <Button size="sm" variant="ghost" onClick={requestMore}>
                  Retry
                </Button>
              </div>
            ) : (
              <Button size={compact ? 'touch' : 'sm'} variant="ghost" className="w-full" loading={loadingMore} onClick={requestMore}>
                Show {formatNumber(Math.min(PAGE_SIZE, remaining))} more
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
