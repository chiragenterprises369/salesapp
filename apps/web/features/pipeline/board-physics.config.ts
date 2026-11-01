'use client';

import { useSyncExternalStore } from 'react';
import { SPRINGS, type SpringParams } from '@/features/shared/physics';

/**
 * Leads Board physics: every tunable in one place (SPEC 11.1). The Board and the demo page
 * (/dev/board-physics) read the same live values; the demo's sliders patch them at runtime, and
 * "Copy config" there prints a block to paste back here.
 */
export interface BoardPhysicsConfig {
  /** Perspective (px) for card depth, tilt and hover lift. */
  perspective: number;
  /** Visible thickness edge under each card (px). */
  cardThickness: number;
  /** Specular sheen strength 0..1 (desktop hover + dragged card). */
  sheen: number;
  /** Hover lift toward the viewer (px of translateZ) on desktop. */
  hoverLift: number;

  /** Pick-up spring (scale, lift, shadow). Spec: stiffness ~320, damping ~22, mass 1. */
  spring: SpringParams;
  /** Dragged card following the pointer (light lag = weight). */
  follow: SpringParams;
  /** Tilt smoothing. */
  tilt: SpringParams;
  /** Drop: snap into the slot with a small overshoot. */
  land: SpringParams;
  /** Dropped outside a column: back to the origin with a gentle bounce. */
  springBack: SpringParams;
  /** Neighbours opening / closing the gap. */
  gap: SpringParams;
  /** Rollback and realtime moves travelling along an arc. */
  flight: SpringParams;

  /** Scale of the lifted card. */
  liftScale: number;
  /** Lift toward the viewer while dragging (px of translateZ). */
  liftZ: number;
  /** Opacity of the other cards while one is dragged. */
  neighbourOpacity: number;
  /** Max tilt (deg) and tilt per px/ms of pointer speed. */
  tiltMax: number;
  tiltGain: number;
  /** Low-pass time constant for pointer velocity (ms). */
  velocityTauMs: number;
  /** Shadow offset opposite to the motion (px per px/ms), capped at 3x this. */
  shadowShift: number;
  /** Cap on the release velocity handed to the landing spring (px/ms). */
  maxThrowSpeed: number;

  /** Gap wave: extra delay per card away from the drop slot (ms). */
  gapStaggerMs: number;
  /** First-load entrance stagger between columns and between cards (ms). */
  entranceStaggerMs: number;
  /** Ring pulse in the stage colour after a drop (ms). */
  ringPulseMs: number;
  /** Count chip pulse (ms). */
  countPulseMs: number;
  /** Count and INR total number tick (ms). */
  numberTickMs: number;
  /** Height of a realtime / rollback arc (px, scales with distance up to this). */
  arcHeight: number;

  autoScroll: {
    /** Edge bands (px) of the board (horizontal) and of a column (vertical). */
    boardEdge: number;
    columnEdge: number;
    /** Top speed (px per 60 Hz frame), ramp-up time (ms) and proximity curve exponent. */
    maxSpeed: number;
    rampMs: number;
    curve: number;
  };

  /** Columns with more cards than this are virtualised (drag still works). */
  virtualizeOver: number;
  /** Adaptive quality: average fps under this drops effects (sheen, tilt, shadows). */
  fpsFloor: number;
  /** Touch long-press to pick up (ms); mouse threshold and touch scroll slop (px). */
  longPressMs: number;
  mouseSlop: number;
  touchSlop: number;
  /** Minimum touch target (px). */
  minTarget: number;
}

export const DEFAULT_BOARD_PHYSICS: BoardPhysicsConfig = {
  perspective: 1200,
  cardThickness: 3,
  sheen: 0.6,
  hoverLift: 6,

  spring: { ...SPRINGS.lift },
  follow: { ...SPRINGS.follow },
  tilt: { stiffness: 320, damping: 22, mass: 1 },
  land: { ...SPRINGS.snap },
  springBack: { ...SPRINGS.springBack },
  gap: { ...SPRINGS.gap },
  flight: { ...SPRINGS.flight },

  liftScale: 1.05,
  liftZ: 24,
  neighbourOpacity: 0.9,
  tiltMax: 8,
  tiltGain: 9,
  velocityTauMs: 70,
  shadowShift: 6,
  maxThrowSpeed: 3,

  gapStaggerMs: 14,
  entranceStaggerMs: 40,
  ringPulseMs: 400,
  countPulseMs: 240,
  numberTickMs: 400,
  arcHeight: 90,

  autoScroll: { boardEdge: 72, columnEdge: 56, maxSpeed: 18, rampMs: 350, curve: 2 },

  virtualizeOver: 50,
  fpsFloor: 45,
  longPressMs: 180,
  mouseSlop: 4,
  touchSlop: 8,
  minTarget: 44,
};

// ---------------------------------------------------------------- live store

type Listener = () => void;
let current: BoardPhysicsConfig = DEFAULT_BOARD_PHYSICS;
const listeners = new Set<Listener>();

type Patch = { [K in keyof BoardPhysicsConfig]?: BoardPhysicsConfig[K] extends object ? Partial<BoardPhysicsConfig[K]> : BoardPhysicsConfig[K] };

export const boardPhysics = {
  get: (): BoardPhysicsConfig => current,
  /** Shallow-merges top-level keys and one level of nested objects (springs, autoScroll). */
  set(patch: Patch) {
    const next = { ...current } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      const prev = (current as unknown as Record<string, unknown>)[k];
      next[k] = v && typeof v === 'object' && prev && typeof prev === 'object' ? { ...prev, ...v } : v;
    }
    current = next as unknown as BoardPhysicsConfig;
    for (const l of listeners) l();
  },
  reset() {
    current = DEFAULT_BOARD_PHYSICS;
    for (const l of listeners) l();
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Live Board physics config. */
export function useBoardPhysics(): BoardPhysicsConfig {
  return useSyncExternalStore(boardPhysics.subscribe, boardPhysics.get, () => DEFAULT_BOARD_PHYSICS);
}
