'use client';

import { animated, to, useSpringValue } from '@react-spring/web';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { SPRINGS } from './drag/controller';
import { useBoardController, useDragState } from './drag/context';
import type { Flight } from './drag/types';
import { cardSurface, LeadCardBody } from './lead-card';

/**
 * Fixed overlay above the page: the lifted card while dragging and cards flying back after a
 * rollback. Pointer events pass through; all motion is transform-only.
 */
export function DragLayer({ compact, now, reducedMotion }: { compact: boolean; now: number; reducedMotion: boolean }) {
  const ctrl = useBoardController();
  const active = useDragState((s) => s.active);
  const flights = useDragState((s) => s.flights);
  const x = useSpringValue(0);
  const y = useSpringValue(0);
  const rot = useSpringValue(0);
  const scale = useSpringValue(1);

  useLayoutEffect(() => ctrl.attachOverlay({ x, y, rot, scale }), [ctrl, x, y, rot, scale]);
  const onFlightDone = useCallback((key: string) => ctrl.flightDone(key), [ctrl]);

  if (!active && flights.length === 0) return null;

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {flights.map((f) => (
        <FlightGhost key={f.key} flight={f} compact={compact} now={now} reducedMotion={reducedMotion} onDone={onFlightDone} />
      ))}
      {active && (
        <animated.div
          className={cn(cardSurface(compact), 'absolute top-0 left-0 shadow-lift', active.mode === 'keyboard' && 'ring-2 ring-ring')}
          style={{
            width: active.width,
            transformOrigin: `${active.grabX}px ${active.grabY}px`,
            transform: to([x, y, rot, scale], (tx, ty, r, s) => `translate3d(${tx}px, ${ty}px, 0) rotate(${r}deg) scale(${s})`),
          }}
        >
          <LeadCardBody lead={active.lead} compact={compact} now={now} />
        </animated.div>
      )}
    </div>,
    document.body,
  );
}

function FlightGhost({
  flight,
  compact,
  now,
  reducedMotion,
  onDone,
}: {
  flight: Flight;
  compact: boolean;
  now: number;
  reducedMotion: boolean;
  onDone: (key: string) => void;
}) {
  const { key, from, to: dest } = flight;
  const x = useSpringValue(from.x);
  const y = useSpringValue(from.y);
  const s = useSpringValue(1.02);

  useEffect(() => {
    if (reducedMotion) {
      onDone(key);
      return;
    }
    let live = true;
    void Promise.all([
      x.start(dest.x, { config: SPRINGS.flight }),
      y.start(dest.y, { config: SPRINGS.flight }),
      s.start(1, { config: SPRINGS.settle }),
    ]).then(() => {
      if (live) onDone(key);
    });
    const timer = window.setTimeout(() => live && onDone(key), 1200);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, dest.x, dest.y, x, y, s, reducedMotion, onDone]);

  return (
    <animated.div
      className={cn(cardSurface(compact), 'absolute top-0 left-0 shadow-raised')}
      style={{ width: from.width, transform: to([x, y, s], (tx, ty, sc) => `translate3d(${tx}px, ${ty}px, 0) scale(${sc})`) }}
    >
      <LeadCardBody lead={flight.lead} compact={compact} now={now} />
    </animated.div>
  );
}
