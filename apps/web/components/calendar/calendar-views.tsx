'use client';

import type { ChipTone } from '@vistar/shared';
import { CalendarClock, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { EmptyState } from '@/components/common/empty-state';
import { useNow } from '@/components/common/use-now';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { addDays, dayKeyIn, dayLabel, daysBetween, instantAt, minutesInDay, monthGrid, startOfWeek, timeLabel } from '@/lib/crm/tz';
import { dragStart, placeInLanes, snap } from './layout';
import { useClickGuard, useWindowDrag } from './use-window-drag';

export type CalendarViewMode = 'month' | 'week' | 'day' | 'agenda';

export interface CalendarItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  tone?: ChipTone;
  /** Second line (place, lead, attendees). */
  subtitle?: string;
  /** Drag to reschedule allowed (the caller checks permissions and status). */
  canMove?: boolean;
  /** Cancelled or declined: struck through. */
  muted?: boolean;
}

export interface CalendarViewsProps {
  mode: CalendarViewMode;
  /** Day key the view is built around. */
  anchor: string;
  timeZone: string;
  items: readonly CalendarItem[];
  loading?: boolean;
  onOpen: (item: CalendarItem) => void;
  /** Drag to reschedule (new start and end as ISO strings). */
  onMove?: (item: CalendarItem, startAt: string, endAt: string) => void;
  /** Click on an empty time slot (week/day) or the add button of a month cell. */
  onCreateAt?: (startAt: string) => void;
  /** Open one day (month "+N more", day headers). */
  onPickDay: (key: string) => void;
}

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;

const TONE_BLOCK: Record<ChipTone, string> = {
  neutral: 'border-l-muted-strong bg-surface-2 text-fg',
  indigo: 'border-l-status-indigo-fg bg-status-indigo-bg text-status-indigo-fg',
  blue: 'border-l-status-blue-fg bg-status-blue-bg text-status-blue-fg',
  green: 'border-l-status-green-fg bg-status-green-bg text-status-green-fg',
  amber: 'border-l-status-amber-fg bg-status-amber-bg text-status-amber-fg',
  grey: 'border-l-status-grey-fg bg-status-grey-bg text-status-grey-fg',
  red: 'border-l-status-red-fg bg-status-red-bg text-status-red-fg',
};

const DOT: Record<ChipTone, string> = {
  neutral: 'bg-muted-strong',
  indigo: 'bg-status-indigo-fg',
  blue: 'bg-status-blue-fg',
  green: 'bg-status-green-fg',
  amber: 'bg-status-amber-fg',
  grey: 'bg-status-grey-fg',
  red: 'bg-status-red-fg',
};

/** Date range the view shows (inclusive day keys) so the page fetches exactly that. */
export function viewRange(mode: CalendarViewMode, anchor: string): { from: string; to: string } {
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  if (mode === 'agenda') return { from: anchor, to: addDays(anchor, 29) };
  const grid = monthGrid(anchor);
  return { from: grid[0]![0]!, to: grid[5]![6]! };
}

function itemDays(item: CalendarItem, tz: string): { startKey: string; endKey: string } {
  const startMs = new Date(item.startAt).getTime();
  // An event ending exactly at midnight belongs to the previous day.
  const endMs = Math.max(startMs, new Date(item.endAt).getTime() - 1);
  return { startKey: dayKeyIn(startMs, tz), endKey: dayKeyIn(endMs, tz) };
}

const durationMin = (item: CalendarItem) => Math.max(15, Math.round((new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60_000));

function accessibleName(item: CalendarItem, tz: string): string {
  const day = dayLabel(dayKeyIn(item.startAt, tz));
  const when = item.allDay ? `${day}, all day` : `${day}, ${timeLabel(item.startAt, tz)} to ${timeLabel(item.endAt, tz)}`;
  return `${item.title}, ${when}${item.subtitle ? `, ${item.subtitle}` : ''}${item.muted ? ', cancelled' : ''}`;
}

const hourLabel = (h: number) => (h === 0 ? '' : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`);

/**
 * Month, week, day and agenda views over one list of items. Drag a block to reschedule (week/day:
 * 15-minute steps across days; month: to another day, same time); Esc cancels a drag. The keyboard
 * path is Enter on a block, which opens it (the caller's dialog has the reschedule fields).
 */
export function CalendarViews(props: CalendarViewsProps) {
  if (props.mode === 'month') return <MonthView {...props} />;
  if (props.mode === 'agenda') return <AgendaView {...props} />;
  return <TimeGridView {...props} />;
}

// ---------------------------------------------------------------- week and day

interface TimeDrag {
  id: string;
  pointerId: number;
  originX: number;
  originY: number;
  originDay: string;
  originStart: number;
  duration: number;
  day: string;
  start: number;
  moved: boolean;
}

function TimeGridView({ mode, anchor, timeZone, items, loading, onOpen, onMove, onCreateAt, onPickDay }: CalendarViewsProps) {
  const days = useMemo(() => (mode === 'day' ? [anchor] : daysBetween(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))), [mode, anchor]);
  const now = useNow(60_000);
  const todayKey = now ? dayKeyIn(now, timeZone) : null;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columns = useRef(new Map<string, HTMLElement>());
  const clickGuard = useClickGuard();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const { drag, start } = useWindowDrag<TimeDrag>({
    onMove: (e, d) => {
      const dx = e.clientX - d.originX;
      const dy = e.clientY - d.originY;
      if (!d.moved && Math.hypot(dx, dy) < 4) return d;
      let day = d.day;
      for (const [key, el] of columns.current) {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX < r.right) {
          day = key;
          break;
        }
      }
      const startMin = dragStart(d.originStart, dy / PX_PER_MIN, d.duration);
      return startMin !== d.start || day !== d.day || !d.moved ? { ...d, day, start: startMin, moved: true } : d;
    },
    onEnd: (d, cancelled) => {
      if (!d.moved) return;
      clickGuard.arm();
      if (cancelled || (d.day === d.originDay && d.start === d.originStart)) return;
      const item = byId.get(d.id);
      if (!item || !onMove) return;
      const startAt = instantAt(d.day, d.start, timeZone);
      onMove(item, startAt.toISOString(), new Date(startAt.getTime() + d.duration * 60_000).toISOString());
    },
  });
  const moving = drag?.moved ? drag : null;

  // Start the visible day at 8 am.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_PX - 8;
  }, []);

  const { allDay, timed } = useMemo(() => {
    const allDayItems: CalendarItem[] = [];
    const byDay = new Map<string, CalendarItem[]>();
    for (const it of items) {
      const { startKey, endKey } = itemDays(it, timeZone);
      if (it.allDay || startKey !== endKey) {
        if (days.some((d) => d >= startKey && d <= endKey)) allDayItems.push(it);
        continue;
      }
      if (!days.includes(startKey)) continue;
      const list = byDay.get(startKey) ?? [];
      list.push(it);
      byDay.set(startKey, list);
    }
    return { allDay: allDayItems, timed: byDay };
  }, [items, days, timeZone]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, item: CalendarItem, day: string) => {
    if (!item.canMove || !onMove || e.button !== 0) return;
    const s = minutesInDay(item.startAt, timeZone);
    start({ id: item.id, pointerId: e.pointerId, originX: e.clientX, originY: e.clientY, originDay: day, originStart: s, duration: durationMin(item), day, start: s, moved: false });
  };
  const open = (item: CalendarItem) => {
    if (!clickGuard.shouldSkip()) onOpen(item);
  };
  const slotClick = (day: string, e: ReactMouseEvent<HTMLDivElement>) => {
    if (!onCreateAt || e.target !== e.currentTarget || clickGuard.shouldSkip()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const minutes = Math.min(1440 - 30, Math.max(0, snap((e.clientY - r.top) / PX_PER_MIN, 30)));
    onCreateAt(instantAt(day, minutes, timeZone).toISOString());
  };
  const nowMin = now ? minutesInDay(now, timeZone) : null;
  const cols = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card', moving && 'select-none')} aria-busy={loading || undefined}>
      <div className="grid border-b border-border" style={cols}>
        <div aria-hidden />
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onPickDay(d)}
            className="focus-ring flex flex-col items-center gap-0.5 border-l border-border px-1 py-2 text-xs hover:bg-surface-2"
            aria-label={`Open ${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })}`}
            aria-current={d === todayKey ? 'date' : undefined}
          >
            <span className="font-medium text-muted-strong">{dayLabel(d, { weekday: 'short' })}</span>
            <span className={cn('inline-flex size-7 items-center justify-center rounded-full text-sm font-semibold', d === todayKey ? 'bg-accent text-accent-fg' : 'text-fg')}>{Number(d.slice(8))}</span>
          </button>
        ))}
      </div>
      {allDay.length > 0 && (
        <div className="grid border-b border-border" style={cols}>
          <div className="px-1 py-1.5 text-right text-2xs text-muted-strong">All day</div>
          <ul className="flex flex-col gap-1 border-l border-border p-1" style={{ gridColumn: `2 / span ${days.length}` }}>
            {allDay.map((it) => {
              const { startKey, endKey } = itemDays(it, timeZone);
              const from = Math.max(0, days.indexOf(startKey));
              const to = days.indexOf(endKey) === -1 ? days.length - 1 : days.indexOf(endKey);
              return (
                <li key={it.id} style={{ marginLeft: `${(from / days.length) * 100}%`, width: `${((to - from + 1) / days.length) * 100}%` }}>
                  <button
                    type="button"
                    onClick={() => onOpen(it)}
                    aria-label={accessibleName(it, timeZone)}
                    className={cn('focus-ring w-full truncate rounded-sm border-l-2 px-2 py-0.5 text-left text-xs font-medium', TONE_BLOCK[it.tone ?? 'indigo'], it.muted && 'line-through opacity-70')}
                  >
                    {it.title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div ref={scrollRef} className="relative max-h-[calc(100dvh-15rem)] min-h-96 overflow-y-auto">
        <div className="grid" style={cols}>
          <div aria-hidden className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-2xs text-muted-strong tabular-nums" style={{ top: h * HOUR_PX }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const list = (timed.get(d) ?? []).filter((it) => it.id !== moving?.id);
            const placed = placeInLanes(
              list.map((it) => {
                const s = minutesInDay(it.startAt, timeZone);
                return { id: it.id, start: s, end: Math.min(1440, s + durationMin(it)) };
              }),
            );
            const dragged = moving && moving.day === d ? byId.get(moving.id) : undefined;
            return (
              <div
                key={d}
                ref={(el) => {
                  if (el) columns.current.set(d, el);
                  else columns.current.delete(d);
                }}
                onClick={(e) => slotClick(d, e)}
                className={cn('relative border-l border-border', onCreateAt && 'cursor-cell', d === todayKey && 'bg-accent-soft/40')}
                style={{ height: 24 * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${HOUR_PX}px)` }}
              >
                {d === todayKey && nowMin !== null && (
                  <span aria-hidden className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-danger" style={{ top: nowMin * PX_PER_MIN }}>
                    <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
                  </span>
                )}
                {placed.map((p) => {
                  const it = byId.get(p.id)!;
                  return (
                    <EventBlock
                      key={it.id}
                      item={it}
                      timeZone={timeZone}
                      start={new Date(it.startAt)}
                      style={{ top: p.start * PX_PER_MIN, height: Math.max(18, (p.end - p.start) * PX_PER_MIN - 2), left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`, width: `calc(${100 / p.lanes}% - 4px)` }}
                      onPointerDown={(e) => onPointerDown(e, it, d)}
                      onClick={() => open(it)}
                    />
                  );
                })}
                {dragged && moving && (
                  <EventBlock
                    item={dragged}
                    timeZone={timeZone}
                    start={instantAt(moving.day, moving.start, timeZone)}
                    style={{ top: moving.start * PX_PER_MIN, height: Math.max(18, moving.duration * PX_PER_MIN - 2), left: 2, right: 2 }}
                    dragging
                    onPointerDown={() => undefined}
                    onClick={() => open(dragged)}
                  />
                )}
              </div>
            );
          })}
        </div>
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span role="status" className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted-strong shadow-raised">
              Loading meetings…
            </span>
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {moving ? `Moving to ${dayLabel(moving.day)}, ${timeLabel(instantAt(moving.day, moving.start, timeZone), timeZone)}. Release to save, Esc to cancel.` : ''}
      </p>
    </div>
  );
}

function EventBlock({
  item,
  timeZone,
  start,
  style,
  dragging,
  onPointerDown,
  onClick,
}: {
  item: CalendarItem;
  timeZone: string;
  start: Date;
  style: CSSProperties;
  dragging?: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onClick: () => void;
}) {
  const minutes = durationMin(item);
  const end = new Date(start.getTime() + minutes * 60_000);
  const short = minutes < 45;
  return (
    <button
      type="button"
      aria-label={accessibleName(item, timeZone)}
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={style}
      className={cn(
        'focus-ring absolute z-10 flex flex-col overflow-hidden rounded-sm border-l-2 px-1.5 py-0.5 text-left text-xs shadow-card',
        TONE_BLOCK[item.tone ?? 'indigo'],
        item.canMove && 'cursor-grab touch-none',
        dragging && 'z-30 cursor-grabbing shadow-lift ring-2 ring-ring',
        item.muted && 'line-through opacity-70',
      )}
    >
      <span className="truncate font-medium leading-tight">
        {item.title}
        {short && <span className="font-normal"> · {timeLabel(start, timeZone)}</span>}
      </span>
      {!short && (
        <span className="truncate opacity-90">
          {timeLabel(start, timeZone)} – {timeLabel(end, timeZone)}
        </span>
      )}
      {!short && item.subtitle && <span className="truncate opacity-80">{item.subtitle}</span>}
    </button>
  );
}

// ---------------------------------------------------------------- month

interface MonthDrag {
  id: string;
  pointerId: number;
  originX: number;
  originY: number;
  originDay: string;
  day: string;
  moved: boolean;
}

function MonthView({ anchor, timeZone, items, loading, onOpen, onMove, onCreateAt, onPickDay }: CalendarViewsProps) {
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const month = anchor.slice(0, 7);
  const now = useNow(60_000);
  const todayKey = now ? dayKeyIn(now, timeZone) : null;
  const cells = useRef(new Map<string, HTMLElement>());
  const clickGuard = useClickGuard();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const { drag, start } = useWindowDrag<MonthDrag>({
    onMove: (e, d) => {
      if (!d.moved && Math.hypot(e.clientX - d.originX, e.clientY - d.originY) < 4) return d;
      let day = d.day;
      for (const [key, el] of cells.current) {
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) {
          day = key;
          break;
        }
      }
      return day !== d.day || !d.moved ? { ...d, day, moved: true } : d;
    },
    onEnd: (d, cancelled) => {
      if (!d.moved) return;
      clickGuard.arm();
      const item = byId.get(d.id);
      if (cancelled || !item || !onMove || d.day === d.originDay) return;
      // Same wall-clock time on the new day (workspace zone), same duration.
      const startAt = instantAt(d.day, minutesInDay(item.startAt, timeZone), timeZone);
      const duration = new Date(item.endAt).getTime() - new Date(item.startAt).getTime();
      onMove(item, startAt.toISOString(), new Date(startAt.getTime() + duration).toISOString());
    },
  });
  const moving = drag?.moved ? drag : null;

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    const first = grid[0]![0]!;
    const last = grid[5]![6]!;
    for (const it of items) {
      const { startKey, endKey } = itemDays(it, timeZone);
      for (const k of daysBetween(startKey < first ? first : startKey, endKey > last ? last : endKey)) {
        const list = m.get(k) ?? [];
        list.push(it);
        m.set(k, list);
      }
    }
    for (const list of m.values()) list.sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.startAt.localeCompare(b.startAt));
    return m;
  }, [items, grid, timeZone]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, item: CalendarItem, day: string) => {
    if (!item.canMove || !onMove || e.button !== 0) return;
    start({ id: item.id, pointerId: e.pointerId, originX: e.clientX, originY: e.clientY, originDay: day, day, moved: false });
  };
  const open = (item: CalendarItem) => {
    if (!clickGuard.shouldSkip()) onOpen(item);
  };
  const weekdays = grid[0]!.map((k) => dayLabel(k, { weekday: 'short' }));

  return (
    <div className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-card', moving && 'select-none')} aria-busy={loading || undefined}>
      <div className="grid grid-cols-7 border-b border-border" aria-hidden>
        {weekdays.map((w) => (
          <div key={w} className="px-2 py-1.5 text-xs font-medium text-muted-strong">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.flat().map((k) => {
          const list = byDay.get(k) ?? [];
          const inMonth = k.slice(0, 7) === month;
          const visible = list.slice(0, 3);
          const isTarget = !!moving && moving.day === k && moving.originDay !== k;
          return (
            <div
              key={k}
              ref={(el) => {
                if (el) cells.current.set(k, el);
                else cells.current.delete(k);
              }}
              className={cn(
                'group/cell flex min-h-24 min-w-0 flex-col gap-0.5 border-r border-b border-border p-1 lg:min-h-28 [&:nth-child(7n)]:border-r-0',
                !inMonth && 'bg-surface-2',
                isTarget && 'bg-accent-soft ring-2 ring-ring ring-inset',
              )}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onPickDay(k)}
                  aria-label={`${dayLabel(k, { weekday: 'long', day: 'numeric', month: 'long' })}, ${list.length} ${list.length === 1 ? 'meeting' : 'meetings'}`}
                  aria-current={k === todayKey ? 'date' : undefined}
                  className={cn(
                    'focus-ring inline-flex size-6 items-center justify-center rounded-full text-xs font-medium',
                    k === todayKey ? 'bg-accent text-accent-fg' : inMonth ? 'text-fg hover:bg-surface-3' : 'text-muted-strong hover:bg-surface-3',
                  )}
                >
                  {Number(k.slice(8))}
                </button>
                {onCreateAt && (
                  <button
                    type="button"
                    aria-label={`New meeting on ${dayLabel(k, { day: 'numeric', month: 'long' })}`}
                    onClick={() => onCreateAt(instantAt(k, 10 * 60, timeZone).toISOString())}
                    className="focus-ring inline-flex size-6 items-center justify-center rounded-sm text-muted-strong opacity-0 group-hover/cell:opacity-100 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100"
                  >
                    <Plus aria-hidden className="size-3.5" />
                  </button>
                )}
              </div>
              {loading && !list.length && k === grid[1]![2] && <Skeleton className="h-4 w-full" />}
              <ul className="flex min-w-0 flex-col gap-0.5">
                {visible.map((it) => (
                  <li key={it.id} className="min-w-0">
                    <button
                      type="button"
                      aria-label={accessibleName(it, timeZone)}
                      onPointerDown={(e) => onPointerDown(e, it, k)}
                      onClick={() => open(it)}
                      className={cn(
                        'focus-ring flex w-full min-w-0 items-center gap-1 rounded-sm border-l-2 px-1 py-0.5 text-left text-2xs font-medium',
                        TONE_BLOCK[it.tone ?? 'indigo'],
                        it.canMove && 'cursor-grab touch-none',
                        moving?.id === it.id && 'opacity-60 ring-2 ring-ring',
                        it.muted && 'line-through opacity-70',
                      )}
                    >
                      {!it.allDay && <span className="hidden shrink-0 tabular-nums opacity-90 sm:inline">{timeLabel(it.startAt, timeZone).replace(' ', '')}</span>}
                      <span className="truncate">{it.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {list.length > visible.length && (
                <button type="button" onClick={() => onPickDay(k)} className="focus-ring w-max rounded-sm px-1 text-2xs font-medium text-muted-strong hover:text-fg">
                  +{list.length - visible.length} more
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {moving ? `Moving to ${dayLabel(moving.day, { weekday: 'long', day: 'numeric', month: 'long' })}. Release to save, Esc to cancel.` : ''}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- agenda

function AgendaView({ anchor, timeZone, items, loading, onOpen, onCreateAt }: CalendarViewsProps) {
  const range = viewRange('agenda', anchor);
  const groups = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of [...items].sort((a, b) => a.startAt.localeCompare(b.startAt))) {
      const { startKey } = itemDays(it, timeZone);
      if (startKey < range.from || startKey > range.to) continue;
      const list = m.get(startKey) ?? [];
      list.push(it);
      m.set(startKey, list);
    }
    return [...m.entries()];
  }, [items, timeZone, range.from, range.to]);

  if (loading && !items.length) {
    return (
      <div role="status" aria-label="Loading meetings" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-card">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (!groups.length) {
    return (
      <EmptyState
        icon={<CalendarClock />}
        title="No meetings in the next 30 days"
        description="Schedule a meeting here or from a lead, contact or deal."
        action={
          onCreateAt && (
            <Button variant="primary" onClick={() => onCreateAt(instantAt(anchor, 11 * 60, timeZone).toISOString())}>
              <Plus aria-hidden />
              New meeting
            </Button>
          )
        }
      />
    );
  }
  return (
    <ol className="flex flex-col gap-3" aria-label="Agenda">
      {groups.map(([day, list]) => (
        <li key={day} className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <h3 data-slot="panel-head" className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold text-fg-secondary">
            {dayLabel(day, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <ul className="divide-y divide-border">
            {list.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => onOpen(it)} className="focus-ring flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-2">
                  <span className="w-36 shrink-0 text-xs text-muted-strong tabular-nums">{it.allDay ? 'All day' : `${timeLabel(it.startAt, timeZone)} – ${timeLabel(it.endAt, timeZone)}`}</span>
                  <span className={cn('mt-1 size-2 shrink-0 rounded-full', DOT[it.tone ?? 'indigo'])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium text-fg', it.muted && 'line-through')}>{it.title}</span>
                    {it.subtitle && <span className="block truncate text-xs text-muted">{it.subtitle}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
