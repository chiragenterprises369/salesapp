'use client';

import { addDays, differenceInCalendarDays, format, isSameDay } from 'date-fns';
import { useCallback, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------- viewport

const MOBILE_QUERY = '(max-width: 767px)';

/** Below 768 px the board switches to snap-scrolling columns and compact cards. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY);
}

/** Touch-first devices have no hover, so card actions stay visible. */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

// ---------------------------------------------------------------- minute clock

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribeNow(cb: () => void) {
  if (listeners.size === 0) now = Date.now();
  listeners.add(cb);
  timer ??= setInterval(() => {
    now = Date.now();
    for (const l of listeners) l();
  }, 60_000);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time, refreshed every minute (follow-up labels, overdue state). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => now,
    () => now,
  );
}

// ---------------------------------------------------------------- formatting

export interface FollowUpLabel {
  text: string;
  /** Full sentence for assistive tech. */
  spoken: string;
  overdue: boolean;
}

/** "Today · 3:00 pm", "Tomorrow · 11:30 am", "Wed · 10:00 am", "12 Nov", "Overdue · 30 Oct". */
export function followUpLabel(iso: string, nowMs: number): FollowUpLabel {
  const at = new Date(iso);
  const ref = new Date(nowMs);
  const time = format(at, 'h:mm aaa');
  const overdue = at.getTime() < nowMs;
  const spoken = `Next follow-up ${format(at, 'EEEE d MMMM, h:mm aaa')}${overdue ? ', overdue' : ''}`;
  if (overdue) return { text: `Overdue · ${isSameDay(at, ref) ? time : format(at, 'd MMM')}`, spoken, overdue };
  if (isSameDay(at, ref)) return { text: `Today · ${time}`, spoken, overdue };
  if (isSameDay(at, addDays(ref, 1))) return { text: `Tomorrow · ${time}`, spoken, overdue };
  if (differenceInCalendarDays(at, ref) < 7) return { text: `${format(at, 'EEE')} · ${time}`, spoken, overdue };
  return { text: format(at, 'd MMM'), spoken, overdue };
}

/** Trailing throttle: the last call always lands. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  let last: A | null = null;
  return (...args: A) => {
    last = args;
    if (t) return;
    t = setTimeout(() => {
      t = null;
      if (last) fn(...last);
    }, ms);
  };
}
