'use client';

import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { TAP_ICON } from './touch';

export interface ReorderControls {
  index: number;
  count: number;
  /** Drag grip (pointer users). Decorative for assistive tech: the move buttons are the accessible path. */
  handle: ReactNode;
  /** "Move up" / "Move down" buttons (keyboard and touch alternative to dragging). */
  moveButtons: ReactNode;
  dragging: boolean;
}

interface ReorderListProps<T> {
  items: readonly T[];
  getId: (item: T) => string;
  getLabel: (item: T) => string;
  /** New order of ids. Called once per drop or move. */
  onReorder: (ids: string[]) => void;
  renderItem: (item: T, controls: ReorderControls) => ReactNode;
  /** Accessible name of the list ("Lead fields"). */
  label: string;
  disabled?: boolean;
  className?: string;
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Optimistic order while reorder requests are in flight: the list shows the new order at once and
 * falls back to server data after the LAST pending save settles (several quick moves stay smooth).
 */
export function useOptimisticOrder(save: (ids: string[]) => Promise<unknown>, onError: (e: unknown) => void) {
  const [order, setOrder] = useState<string[] | null>(null);
  const pending = useRef(0);
  // Saves run one after another so the last move always wins on the server.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const reorder = async (ids: string[]) => {
    setOrder(ids);
    pending.current += 1;
    const run = chain.current.then(() => save(ids));
    chain.current = run.catch(() => undefined);
    try {
      await run;
    } catch (e) {
      onError(e);
    } finally {
      pending.current -= 1;
      if (pending.current === 0) setOrder(null);
    }
  };
  return { order, reorder };
}

/**
 * Ordered list with two equal ways to reorder: drag a row (HTML drag and drop, drop line shows
 * where it lands) or use the up/down buttons (keyboard, touch, screen readers). Moves are announced
 * in a polite live region and focus follows the moved row.
 */
export function ReorderList<T>({ items, getId, getLabel, onReorder, renderItem, label, disabled, className }: ReorderListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<{ id: string; dir: 'up' | 'down'; n: number } | null>(null);
  const ids = items.map(getId);

  // Keep keyboard focus on the moved row's button (React re-inserts the row, which drops focus).
  useEffect(() => {
    if (!focusRequest) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-reorder-id="${CSS.escape(focusRequest.id)}"]`);
    const wanted = row?.querySelector<HTMLButtonElement>(`[data-move="${focusRequest.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(`[data-move="${focusRequest.dir === 'up' ? 'down' : 'up'}"]`);
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [focusRequest]);

  const commit = (from: number, to: number, opts: { focus?: 'up' | 'down' } = {}) => {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = move(ids, from, to);
    const item = items[from]!;
    onReorder(next);
    setAnnouncement(`${getLabel(item)} moved to position ${to + 1} of ${items.length}.`);
    if (opts.focus) setFocusRequest((r) => ({ id: getId(item), dir: opts.focus!, n: (r?.n ?? 0) + 1 }));
  };

  const onDragOver = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setOver((o) => (o?.id === id && o.after === after ? o : { id, after }));
  };

  const onDrop = (e: DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (!dragId || !over) return reset();
    const from = ids.indexOf(dragId);
    let to = ids.indexOf(over.id) + (over.after ? 1 : 0);
    if (from < to) to -= 1;
    reset();
    commit(from, to);
  };

  const reset = () => {
    setDragId(null);
    setOver(null);
  };

  return (
    <>
      <ul ref={listRef} aria-label={label} className={cn('flex flex-col gap-2', className)}>
        {items.map((item, index) => {
          const id = getId(item);
          const name = getLabel(item);
          const dragging = dragId === id;
          const showLine = over?.id === id && dragId !== id;
          const handle = (
            <span
              aria-hidden
              title={disabled ? undefined : 'Drag to reorder'}
              className={cn('hidden shrink-0 text-muted sm:inline-flex', !disabled && 'cursor-grab active:cursor-grabbing')}
            >
              <GripVertical className="size-4" />
            </span>
          );
          const moveButtons = (
            <span className="flex shrink-0 items-center">
              <Button
                variant="ghost"
                size="icon-sm"
                className={TAP_ICON}
                data-move="up"
                aria-label={`Move ${name} up`}
                disabled={disabled || index === 0}
                onClick={() => commit(index, index - 1, { focus: 'up' })}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={TAP_ICON}
                data-move="down"
                aria-label={`Move ${name} down`}
                disabled={disabled || index === items.length - 1}
                onClick={() => commit(index, index + 1, { focus: 'down' })}
              >
                <ArrowDown aria-hidden />
              </Button>
            </span>
          );
          return (
            <li
              key={id}
              data-reorder-id={id}
              draggable={!disabled}
              onDragStart={(e) => {
                if (disabled) return;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
                setDragId(id);
              }}
              onDragOver={(e) => onDragOver(e, id)}
              onDrop={onDrop}
              onDragEnd={reset}
              className={cn(
                'relative rounded-lg transition-[opacity,box-shadow] duration-150 ease-standard',
                dragging && 'opacity-50',
                showLine && over && (over.after ? 'after:absolute after:inset-x-2 after:-bottom-1.5 after:h-0.5 after:rounded-full after:bg-accent' : 'before:absolute before:inset-x-2 before:-top-1.5 before:h-0.5 before:rounded-full before:bg-accent'),
              )}
            >
              {renderItem(item, { index, count: items.length, handle, moveButtons, dragging })}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
