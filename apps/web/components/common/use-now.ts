'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Shared ticking clock (ms since epoch) for countdowns and "now" labels, without calling Date.now()
 * during render. One interval per tick size, stopped when nobody listens.
 * Returns 0 during server rendering and hydration; treat 0 as "unknown".
 */
interface Clock {
  value: number;
  subs: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { value: Date.now(), subs: new Set(), timer: null };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

export function useNow(intervalMs = 1_000): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const clock = clockFor(intervalMs);
      clock.subs.add(onChange);
      if (!clock.timer) {
        clock.value = Date.now();
        clock.timer = setInterval(() => {
          clock.value = Date.now();
          clock.subs.forEach((fn) => fn());
        }, intervalMs);
      }
      return () => {
        clock.subs.delete(onChange);
        if (clock.subs.size === 0 && clock.timer) {
          clearInterval(clock.timer);
          clock.timer = null;
        }
      };
    },
    [intervalMs],
  );
  const getSnapshot = useCallback(() => clockFor(intervalMs).value, [intervalMs]);
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
