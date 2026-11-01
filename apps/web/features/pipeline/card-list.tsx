'use client';

import { animated, useSpringValue } from '@react-spring/web';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import type { LeadListItem, Stage } from '@vistar/shared';
import { useCallback, useLayoutEffect, useRef, type FocusEvent, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { SPRINGS } from './drag/controller';
import { useBoardController, useColumnLayout, useDragState } from './drag/context';
import type { CardHandle, ColumnGeometry, DragState } from './drag/types';
import { BoardCard } from './lead-card';

/** Columns with more cards than this render through @tanstack/react-virtual. */
export const VIRTUALIZE_OVER = 60;

export interface CardListProps {
  stageId: string;
  stageName: string;
  leads: readonly LeadListItem[];
  compact: boolean;
  canDrag: boolean;
  canMove: boolean;
  selectMode: boolean;
  showQuick: boolean;
  stages: readonly Stage[];
  now: number;
  instructionsId?: string;
  reducedMotion: boolean;
}

function gapOf(compact: boolean) {
  return compact ? 6 : 8;
}

/** Top of the hovered slot when this column shows a gap there, else null. */
function slotTopFor(s: DragState, stageId: string): number | null {
  const { phase, active, over } = s;
  if (phase !== 'dragging' || !active || !over || over.stageId !== stageId) return null;
  if (over.stageId === active.fromStageId && over.index === active.originIndex) return null;
  return over.top;
}

/** Dashed slot where the card will land; glides between slots. */
function SlotPlaceholder({ stageId, reducedMotion }: { stageId: string; reducedMotion: boolean }) {
  const top = useDragState((s) => slotTopFor(s, stageId));
  const height = useDragState((s) => s.active?.height ?? 0);
  const y = useSpringValue(0);
  const shown = useRef(false);

  useLayoutEffect(() => {
    if (top === null) {
      shown.current = false;
      return;
    }
    if (!shown.current || reducedMotion) y.set(top);
    else y.start(top, { config: SPRINGS.nudge });
    shown.current = true;
  }, [top, y, reducedMotion]);

  if (top === null) return null;
  return (
    <animated.li
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 rounded-lg border-2 border-dashed border-accent bg-accent-soft/50"
      style={{ y, height }}
    />
  );
}

function useLeadsRef(leads: readonly LeadListItem[]) {
  const ref = useRef(leads);
  useLayoutEffect(() => {
    ref.current = leads;
  }, [leads]);
  return ref;
}

/** Plain list (up to VIRTUALIZE_OVER cards): geometry from the DOM. */
export function StaticCardList({ stageId, stageName, leads, reducedMotion, ...cardProps }: CardListProps) {
  const ctrl = useBoardController();
  const listRef = useRef<HTMLUListElement>(null);
  const leadsRef = useLeadsRef(leads);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const geo: ColumnGeometry = {
      list,
      getLeads: () => leadsRef.current,
      slot: (id) => ctrl.cardSlot(id, list),
      refresh: () => ctrl.measureList(list),
      reveal: () => undefined,
    };
    ctrl.setGeometry(stageId, geo);
    return () => ctrl.clearGeometry(stageId, geo);
  }, [ctrl, stageId, leadsRef]);

  const measure = useCallback((h: CardHandle) => ({ top: h.li.offsetTop, height: h.li.offsetHeight }), []);
  useColumnLayout(stageId, leads, measure);

  return (
    <ul ref={listRef} aria-label={`${stageName} leads`} className={cn('relative flex flex-col', cardProps.compact ? 'gap-1.5' : 'gap-2')}>
      {leads.map((lead, i) => (
        <BoardCard key={lead.id} lead={lead} stageId={stageId} index={i} {...cardProps} />
      ))}
      <SlotPlaceholder stageId={stageId} reducedMotion={reducedMotion} />
    </ul>
  );
}

/** Long columns: only the visible window is mounted. Geometry comes from the virtualizer. */
export function VirtualCardList({
  stageId,
  stageName,
  leads,
  reducedMotion,
  scrollRef,
  initialOffset,
  ...cardProps
}: CardListProps & { scrollRef: RefObject<HTMLDivElement | null>; initialOffset: number | (() => number) }) {
  const ctrl = useBoardController();
  const listRef = useRef<HTMLUListElement>(null);
  const leadsRef = useLeadsRef(leads);
  const focusIndex = useRef(-1);
  const slotMap = useRef<{ src: unknown; map: Map<string, { top: number; height: number }> } | null>(null);

  // Keep the dragged card's origin and the focused card mounted while they scroll out of view.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const keep = new Set(defaultRangeExtractor(range));
      const a = ctrl.store.getState().active;
      if (a && a.fromStageId === stageId && a.originIndex < range.count) keep.add(a.originIndex);
      if (focusIndex.current >= 0 && focusIndex.current < range.count) keep.add(focusIndex.current);
      return [...keep].sort((x, y) => x - y);
    },
    [ctrl, stageId],
  );

  // Not memoised by the React Compiler (expected); geometry reads go through measurementsCache.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: leads.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (cardProps.compact ? 100 : 112),
    getItemKey: (i) => leads[i]?.id ?? i,
    gap: gapOf(cardProps.compact),
    overscan: 6,
    initialOffset,
    rangeExtractor,
  });

  const slotOf = useCallback(
    (id: string) => {
      const cache = virtualizer.measurementsCache;
      if (slotMap.current?.src !== cache) {
        const map = new Map<string, { top: number; height: number }>();
        for (const m of cache) map.set(String(m.key), { top: m.start, height: m.size });
        slotMap.current = { src: cache, map };
      }
      return slotMap.current.map.get(id) ?? null;
    },
    [virtualizer],
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const geo: ColumnGeometry = {
      list,
      getLeads: () => leadsRef.current,
      slot: slotOf,
      refresh: () => {
        slotMap.current = null;
      },
      reveal: (index) => virtualizer.scrollToIndex(index, { align: 'auto' }),
    };
    ctrl.setGeometry(stageId, geo);
    return () => ctrl.clearGeometry(stageId, geo);
  }, [ctrl, stageId, leadsRef, slotOf, virtualizer]);

  // measurementsCache is replaced whenever sizes or items change, so the identity check in slotOf
  // keeps the map fresh.
  const measure = useCallback((h: CardHandle) => slotOf(h.id), [slotOf]);
  useColumnLayout(stageId, leads, measure);

  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement).closest('li[data-index]');
    focusIndex.current = li ? Number(li.getAttribute('data-index')) : -1;
  };

  return (
    <ul ref={listRef} aria-label={`${stageName} leads`} onFocus={onFocus} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const lead = leads[item.index];
        if (!lead) return null;
        return (
          <BoardCard
            key={lead.id}
            lead={lead}
            stageId={stageId}
            index={item.index}
            virtualStart={item.start}
            measure={virtualizer.measureElement}
            setSize={leads.length}
            {...cardProps}
          />
        );
      })}
      <SlotPlaceholder stageId={stageId} reducedMotion={reducedMotion} />
    </ul>
  );
}
