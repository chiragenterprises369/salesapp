'use client';

import { formatInr, formatNumber, stageTone, type BoardColumn as BoardColumnData, type LeadFilters, type Stage } from '@vistar/shared';
import { Plus } from 'lucide-react';
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useLoadMoreColumn } from '@/lib/leads/data';
import { useLeadsViewState } from '@/lib/leads/state';
import { AnimatedNumber } from './animated-number';
import { StaticCardList, VirtualCardList, type CardListProps } from './card-list';
import { useBoardController, useDragState } from './drag/context';
import { pulseChip } from './drag/effects';
import { throttle } from './hooks';
import { QuickAdd } from './quick-add';
import { COLUMN_TINT, COUNT_BORDER, STAGE_DOT, stageColorVar } from './tones';
import { TOUCH_BUTTON, TOUCH_ICON } from './touch';
import { countOf, useBoardWords } from './words';

/** Start loading the next page when the column is this close to its end (px). */
const LOAD_MORE_THRESHOLD = 480;
const PAGE_SIZE = 50;
/** Hysteresis: a virtualised column switches back to a plain list only below threshold - this. */
const VIRTUAL_HYSTERESIS = 10;

const formatCount = (n: number) => formatNumber(n);
const formatTotal = (n: number) => formatInr(n, { compact: true });

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
  alwaysShowActions: boolean;
  stages: readonly Stage[];
  now: number;
  instructionsId?: string;
  /** Share of the pipeline's total value (0..1) for the header progress bar. */
  valueShare: number;
  /** Columns with more cards than this are virtualised. */
  virtualizeOver: number;
  /** Animate counts, totals and pulses. */
  pulses: boolean;
  numberTickMs: number;
  countPulseMs: number;
  /** First-load entrance: delays (ms) for this column and per card; undefined = none. */
  enter?: { base: number; step: number };
  /** Neon Space edge colour (CSS colour; skins/skin-model neonEdge). Used only by the Neon skin. */
  edge: string;
}

/** Count chip: ticks to the new count and pulses when a card enters or leaves, or a drag hovers. */
function CountChip({ count, isOver, tone, pulses, tickMs, pulseMs }: { count: number; isOver: boolean; tone: keyof typeof COUNT_BORDER; pulses: boolean; tickMs: number; pulseMs: number }) {
  const words = useBoardWords();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef({ count, isOver });

  useLayoutEffect(() => {
    const p = prev.current;
    prev.current = { count, isOver };
    if (!pulses) return;
    if (p.count !== count || (isOver && !p.isOver)) pulseChip(ref.current, pulseMs);
  }, [count, isOver, pulses, pulseMs]);

  return (
    <span
      ref={ref}
      data-count={count}
      className={cn('inline-flex shrink-0 rounded-full border bg-surface px-1.5 text-2xs leading-4 font-semibold text-fg-secondary tabular', COUNT_BORDER[tone])}
    >
      <AnimatedNumber value={count} format={formatCount} durationMs={tickMs} animate={pulses} />
      <span className="sr-only"> {countOf(count, words)}</span>
    </span>
  );
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
  alwaysShowActions,
  stages,
  now,
  instructionsId,
  valueShare,
  virtualizeOver,
  pulses,
  numberTickMs,
  countPulseMs,
  enter,
  edge,
}: BoardColumnProps) {
  const ctrl = useBoardController();
  const words = useBoardWords();
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

  // Virtualise long columns, with hysteresis so a drop around the threshold does not remount the list.
  const [virtual, setVirtual] = useState(leads.length > virtualizeOver);
  const shouldVirtual = virtual ? leads.length > virtualizeOver - VIRTUAL_HYSTERESIS : leads.length > virtualizeOver;
  if (shouldVirtual !== virtual) setVirtual(shouldVirtual);

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
  }, [setAdding]);

  const listProps: CardListProps = {
    stageId: stage.id,
    stageName: stage.name,
    leads,
    compact,
    canDrag,
    canMove,
    selectMode,
    showQuick,
    alwaysShowActions,
    stages,
    now,
    instructionsId,
    enter: enter && { base: enter.base + enter.step, step: enter.step },
  };
  const remaining = Math.max(1, count - leads.length);
  const sharePct = Math.round(valueShare * 100);
  const style = { '--vb-stage': stageColorVar(stage, tone), '--vn-edge': edge, ...(enter ? { animationDelay: `${enter.base}ms` } : {}) } as CSSProperties;

  return (
    <section
      ref={frameRef}
      aria-labelledby={titleId}
      data-over={isOver || undefined}
      data-stage-id={stage.id}
      data-stage-key={stage.key}
      style={style}
      className={cn(
        'vb-column relative flex w-[85vw] max-w-[320px] shrink-0 snap-start flex-col rounded-lg border md:w-[288px]',
        'transition-[box-shadow,background-color] duration-150 ease-standard',
        COLUMN_TINT[tone],
        enter && 'vb-enter',
        // Soft target highlight; the dashed slot placeholder marks the exact drop position.
        isOver && 'ring-2 ring-accent/50',
      )}
    >
      <header className={cn('flex flex-col gap-1 pr-1.5 pl-3', compact ? 'pt-1 pb-1' : 'pt-2 pb-1.5')}>
        <div className="flex items-center gap-2">
          <span aria-hidden className={cn('vb-dot size-2 shrink-0 rounded-full', STAGE_DOT[tone])} />
          <h3 id={titleId} className="min-w-0 truncate text-sm font-semibold text-fg">
            {stage.name}
          </h3>
          <CountChip count={count} isOver={isOver} tone={tone} pulses={pulses} tickMs={numberTickMs} pulseMs={countPulseMs} />
          <span
            data-column-total=""
            className="ml-auto shrink-0 text-xs font-medium text-muted-strong tabular"
            title={`${formatInr(totalValueInr)} · ${sharePct}% of pipeline value`}
          >
            <span className="sr-only">Total value </span>
            <AnimatedNumber value={totalValueInr} format={formatTotal} durationMs={numberTickMs} animate={pulses} />
            <span className="sr-only">, {sharePct}% of pipeline value</span>
          </span>
          {canCreate ? (
            <Button
              ref={addRef}
              size={compact ? 'icon-touch' : 'icon-sm'}
              className={cn(compact && TOUCH_ICON)}
              variant="ghost"
              aria-label={`Add ${words.oneLower} to ${stage.name}`}
              aria-expanded={adding}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden />
            </Button>
          ) : (
            <span aria-hidden className="w-1.5" />
          )}
        </div>
        {/* Share of the pipeline's value (transform only). */}
        <div aria-hidden className="vb-share-track mr-1.5 h-0.5 overflow-hidden rounded-full">
          <div className="vb-share h-full rounded-full" style={{ transform: `scaleX(${valueShare})` }} />
        </div>
      </header>

      {adding && <QuickAdd stage={stage} touch={compact} onClose={closeQuickAdd} />}

      <div ref={scrollRef} onScroll={onScroll} className="vb-list min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-3">
        {virtual ? (
          <VirtualCardList {...listProps} scrollRef={scrollRef} initialOffset={() => scrollRef.current?.scrollTop ?? initialTop} />
        ) : (
          <StaticCardList {...listProps} />
        )}

        {leads.length === 0 && !nextCursor && !isOver && (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <p className="text-xs text-muted-strong">
              No {words.manyLower} in {stage.name}
            </p>
            {canCreate && !adding && (
              <Button size={compact ? 'touch' : 'sm'} variant="ghost" className={cn(compact && TOUCH_BUTTON)} onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                Add {words.oneLower}
              </Button>
            )}
          </div>
        )}

        {nextCursor && (
          <div className="pt-2">
            {loadMoreFailed && !loadingMore ? (
              <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
                <span className="text-xs text-danger-text">Could not load more {words.manyLower}.</span>
                <Button size={compact ? 'touch' : 'sm'} variant="ghost" className={cn(compact && TOUCH_BUTTON)} onClick={requestMore}>
                  Retry
                </Button>
              </div>
            ) : (
              <Button size={compact ? 'touch' : 'sm'} variant="ghost" className={cn('w-full', compact && TOUCH_BUTTON)} loading={loadingMore} onClick={requestMore}>
                Show {formatNumber(Math.min(PAGE_SIZE, remaining))} more
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
});
