'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@/lib/cn';

/**
 * Vertical splitter on the inner edge of a side panel (WAI-ARIA window splitter). Drag with the pointer,
 * or focus it and use Left / Right (Shift = larger steps), Home (narrowest) / End (widest); double-click
 * or Enter resets the width.
 */
export function ResizeHandle({
  value,
  min,
  max,
  onChange,
  onReset,
  controls,
  grow = 'left',
  label = 'Resize panel',
  className,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onReset: () => void;
  /** id of the panel it resizes. */
  controls: string;
  /** Pointer direction that makes the panel wider: 'right' for a panel anchored on the left. */
  grow?: 'left' | 'right';
  label?: string;
  className?: string;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const clamp = (w: number) => Math.max(min, Math.min(max, w));
  const sign = grow === 'right' ? 1 : -1;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: value };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    onChange(clamp(d.w + sign * (e.clientX - d.x)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 120 : 32;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = value + sign * step;
    else if (e.key === 'ArrowLeft') next = value - sign * step;
    else if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key === 'Enter') {
      e.preventDefault();
      onReset();
      return;
    }
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuetext={`${Math.round(value)} pixels wide`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title="Drag to resize. Double-click to reset."
      className={cn(
        'group focus-ring relative z-10 flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center rounded-sm outline-none select-none',
        className,
      )}
    >
      <span aria-hidden className="h-10 w-1 rounded-full bg-border-strong transition-colors duration-150 ease-standard group-hover:bg-accent group-focus-visible:bg-accent" />
    </div>
  );
}
