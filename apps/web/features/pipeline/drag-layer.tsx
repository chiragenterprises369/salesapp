'use client';

import { animated, to, useSpringValue } from '@react-spring/web';
import { formatNumber, type Stage } from '@vistar/shared';
import { useCallback, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { DragOverlayPortal, springConfig } from '@/features/shared/physics';
import { cn } from '@/lib/cn';
import { useBoardController, useDragState } from './drag/context';
import type { Flight } from './drag/types';
import { cardSurface, LeadCardBody } from './lead-card';
import { getTavolaTheme } from './tones';

/**
 * Fixed overlay above the page: the lifted card while dragging (depth, tilt, moving shadow, sheen
 * that shifts with tilt, optional deck stack) and cards flying along an arc (realtime moves, menu
 * moves, rollbacks). Pointer events pass through; all motion is transform/opacity only.
 */
export function DragLayer({
  compact,
  now,
  rootStyle,
  depthAttrs,
  stages,
}: {
  compact: boolean;
  now: number;
  rootStyle: CSSProperties;
  depthAttrs: Record<string, string>;
  stages?: readonly Stage[];
}) {
  const ctrl = useBoardController();
  const active = useDragState((s) => s.active);
  const flights = useDragState((s) => s.flights);
  const x = useSpringValue(0);
  const y = useSpringValue(0);
  const rx = useSpringValue(0);
  const ry = useSpringValue(0);
  const rz = useSpringValue(0);
  const scale = useSpringValue(1);
  const lift = useSpringValue(0);
  const sx = useSpringValue(0);
  const sy = useSpringValue(0);

  useLayoutEffect(() => ctrl.attachOverlay({ x, y, rx, ry, rz, scale, lift, sx, sy }), [ctrl, x, y, rx, ry, rz, scale, lift, sx, sy]);
  const onFlightDone = useCallback((key: string) => ctrl.flightDone(key), [ctrl]);

  if (!active && flights.length === 0) return null;
  const perspective = ctrl.physics.perspective;
  const liftZ = ctrl.physics.liftZ;
  const deck = active?.deck.length ?? 0;

  const activeStageIndex = stages && active ? stages.findIndex((s) => s.id === active.fromStageId) : 0;
  const activeStage = stages && activeStageIndex >= 0 ? stages[activeStageIndex] : undefined;
  const activeTavolaTheme = getTavolaTheme(activeStageIndex, activeStage);

  return (
    <DragOverlayPortal className="vb-depth vb-overlay" style={rootStyle}>
      <div className="contents" {...depthAttrs}>
        {flights.map((f) => (
          <FlightGhost key={f.key} flight={f} compact={compact} now={now} onDone={onFlightDone} stages={stages} />
        ))}
        {active && (
          <animated.div
            data-drag-ghost={active.lead.id}
            className="absolute top-0 left-0"
            style={{ width: active.width, height: active.height, transform: to([x, y], (tx, ty) => `translate3d(${tx}px, ${ty}px, 0)`), willChange: 'transform' }}
          >
            {/* Ground shadow: grows and blurs with the lift, slides opposite to the motion. */}
            <animated.div
              aria-hidden
              className="vb-ghost-shadow"
              style={{
                opacity: lift,
                transform: to([sx, sy, lift], (a, b, l) => `translate3d(${a}px, ${b + l * 6}px, 0) scale(${1 + l * 0.02})`),
              }}
            />
            {deck > 0 && (
              <>
                {deck > 1 && (
                  <div
                    aria-hidden
                    className={cn('vb-deck-layer', cardSurface(compact, activeTavolaTheme.cardClass))}
                    style={{ transform: 'translate3d(8px, 8px, 0) rotate(2.5deg)' }}
                  />
                )}
                <div
                  aria-hidden
                  className={cn('vb-deck-layer', cardSurface(compact, activeTavolaTheme.cardClass))}
                  style={{ transform: 'translate3d(4px, 4px, 0) rotate(1.2deg)' }}
                />
              </>
            )}
            <animated.div
              className="vb-ghost absolute inset-0"
              style={{
                transformOrigin: `${active.grabX}px ${active.grabY}px`,
                transform: to(
                  [rx, ry, rz, scale, lift],
                  (a, b, c, s, l) => `perspective(${perspective}px) translateZ(${l * liftZ}px) rotateX(${a}deg) rotateY(${b}deg) rotateZ(${c}deg) scale(${s})`,
                ),
              }}
            >
              <div aria-hidden className="vb-lip" />
              <div className={cn(cardSurface(compact, activeTavolaTheme.cardClass), 'vb-face h-full overflow-hidden shadow-2xl', active.mode === 'keyboard' && 'ring-2 ring-ring')}>
                <animated.span
                  aria-hidden
                  className="vb-ghost-sheen"
                  style={{ transform: to([rx, ry], (a, b) => `translate3d(${b * 4}%, ${-a * 4}%, 0)`) }}
                />
                <LeadCardBody
                  lead={active.lead}
                  compact={compact}
                  now={now}
                  theme={activeTavolaTheme.tone}
                  stageIndex={activeStageIndex}
                  stage={activeStage}
                  stages={stages}
                />
              </div>
              {deck > 0 && (
                <span className="absolute -top-2.5 -right-2.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-fg shadow-raised tabular">
                  {formatNumber(deck + 1)}
                </span>
              )}
            </animated.div>
          </animated.div>
        )}
      </div>
    </DragOverlayPortal>
  );
}

/** A card travelling from `from` to `to` along an arc (spring on progress, slight lean). */
function FlightGhost({
  flight,
  compact,
  now,
  onDone,
  stages,
}: {
  flight: Flight;
  compact: boolean;
  now: number;
  onDone: (key: string) => void;
  stages?: readonly Stage[];
}) {
  const ctrl = useBoardController();
  const { key, from, to: dest, kind } = flight;
  const t = useSpringValue(0);

  const dx = dest.x - from.x;
  const dy = dest.y - from.y;
  const dist = Math.hypot(dx, dy);
  const arc = Math.min(ctrl.physics.arcHeight, dist * 0.35) * (Math.abs(dx) > 8 ? 1 : 0.4);
  const lean = Math.sign(dx) * Math.min(4, Math.abs(dx) / 120);

  useEffect(() => {
    let live = true;
    const config = springConfig(ctrl.physics.flight, { timeScale: ctrl.timeScale(), precision: 0.002 });
    void t.start(1, { config }).then(() => {
      if (live) onDone(key);
    });
    const timer = window.setTimeout(() => live && onDone(key), 1600 / ctrl.timeScale());
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, t, ctrl, onDone]);

  const flightStageIndex = stages ? stages.findIndex((s) => s.id === flight.lead.stageId) : 0;
  const flightStage = stages && flightStageIndex >= 0 ? stages[flightStageIndex] : undefined;
  const flightTavolaTheme = getTavolaTheme(flightStageIndex, flightStage);

  return (
    <animated.div
      data-flight={kind}
      className="absolute top-0 left-0"
      style={{
        width: from.width,
        height: from.height,
        willChange: 'transform',
        transform: t.to((p) => {
          const c = Math.min(1, Math.max(0, p));
          const bump = Math.sin(Math.PI * c);
          return `translate3d(${from.x + dx * p}px, ${from.y + dy * p - arc * bump}px, 0) rotate(${lean * bump}deg) scale(${1 + 0.03 * bump})`;
        }),
      }}
    >
      <animated.div aria-hidden className="vb-ghost-shadow" style={{ opacity: t.to((p) => 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, p)))) }} />
      <div className="vb-ghost absolute inset-0">
        <div aria-hidden className="vb-lip" />
        <div className={cn(cardSurface(compact, flightTavolaTheme.cardClass), 'vb-face h-full overflow-hidden', kind === 'rollback' && 'border-danger')}>
          <LeadCardBody
            lead={flight.lead}
            compact={compact}
            now={now}
            theme={flightTavolaTheme.tone}
            stageIndex={flightStageIndex}
            stage={flightStage}
            stages={stages}
          />
        </div>
      </div>
    </animated.div>
  );
}
