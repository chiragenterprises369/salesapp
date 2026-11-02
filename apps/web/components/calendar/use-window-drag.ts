'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Pointer drag tracked on the window (the dragged block may re-render in another column, so element
 * pointer capture would be lost). Esc cancels. `onMove` returns the next drag state (or the same one).
 */
export function useWindowDrag<T extends { pointerId: number }>(handlers: { onMove: (e: PointerEvent, drag: T) => T; onEnd: (drag: T, cancelled: boolean) => void }) {
  const [drag, setDrag] = useState<T | null>(null);
  const current = useRef<T | null>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const active = drag !== null;

  useEffect(() => {
    if (!active) return;
    const finish = (cancelled: boolean) => {
      const d = current.current;
      if (!d) return;
      current.current = null;
      setDrag(null);
      latest.current.onEnd(d, cancelled);
    };
    const move = (e: PointerEvent) => {
      const d = current.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const next = latest.current.onMove(e, d);
      if (next !== d) {
        current.current = next;
        setDrag(next);
      }
    };
    const up = (e: PointerEvent) => {
      if (current.current && e.pointerId === current.current.pointerId) finish(false);
    };
    const cancel = (e: PointerEvent) => {
      if (current.current && e.pointerId === current.current.pointerId) finish(true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
  }, [active]);

  const start = (d: T) => {
    current.current = d;
    setDrag(d);
  };
  return { drag, start };
}

/** Swallow the click that follows a drag (cleared on the next tick if no click comes). */
export function useClickGuard() {
  const guard = useRef(false);
  return {
    arm: () => {
      guard.current = true;
      setTimeout(() => {
        guard.current = false;
      }, 0);
    },
    shouldSkip: () => {
      if (!guard.current) return false;
      guard.current = false;
      return true;
    },
  };
}
