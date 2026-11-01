'use client';

import type { DomainEvent, TeamFloorSnapshot } from '@vistar/shared';
import { createEventSimulator, mockTeamFloorSnapshot } from '@vistar/shared/fixtures';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { floorRootReducer, initialFloorState } from './reducer';
import { withStressEmployees } from './stress';
import type { FloorAction, FloorState } from './types';

/**
 * Data source for the floor. Wave 1: mock snapshot + event simulator. Wave 3: replace
 * `createMockFloorSource` with GET /team-floor/snapshot + the realtime socket (same events).
 */
export interface FloorSource {
  load(): Promise<TeamFloorSnapshot>;
  /** Push batches of domain events; returns unsubscribe. */
  subscribe(onEvents: (events: DomainEvent[]) => void): () => void;
}

const TICK_MS = 1500;

export function createMockFloorSource(opts: { stress?: number } = {}): FloorSource {
  let snapshot: TeamFloorSnapshot | null = null;
  const getSnapshot = () => {
    if (!snapshot) {
      const base = mockTeamFloorSnapshot(new Date());
      snapshot = opts.stress ? withStressEmployees(base, opts.stress) : base;
    }
    return snapshot;
  };
  return {
    load: () => Promise.resolve(getSnapshot()),
    subscribe(onEvents) {
      const snap = getSnapshot();
      const sim = createEventSimulator({ users: snap.employees.map((e) => ({ ...e.user, status: e.status })) });
      // Keep activity density similar with many employees: roughly one simulator step per 12 people.
      const steps = Math.max(1, Math.ceil(snap.employees.length / 12));
      const timer = setInterval(() => {
        if (document.hidden) return;
        const out: DomainEvent[] = [];
        for (let i = 0; i < steps; i++) out.push(...sim.next());
        if (out.length) onEvents(out);
      }, TICK_MS);
      return () => clearInterval(timer);
    },
  };
}

export type FeedStatus = 'loading' | 'ready' | 'error';

export interface FloorFeed {
  status: FeedStatus;
  state: FloorState | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  retry: () => void;
  /** Local (Wave 1) actions: resolve/restore attention, reassign. */
  dispatch: (action: Exclude<FloorAction, { kind: 'reset' } | { kind: 'events' }>) => void;
}

const DEDUPE_MAX = 500;
const BUFFER_MAX = 500;

/**
 * One hook owns the floor data: initial snapshot, then events through `floorRootReducer`.
 * Dedupes by event id (last 500), buffers while paused, prunes expired effects.
 */
export function useFloorFeed(opts: { userIds?: readonly string[] | null; stress?: number } = {}): FloorFeed {
  const scopeKey = opts.userIds ? [...opts.userIds].sort().join(',') : '*';
  const stress = opts.stress ?? 0;
  const [state, dispatch] = useReducer(floorRootReducer, null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const buffer = useRef<DomainEvent[]>([]);
  const seen = useRef<{ set: Set<string>; order: string[] }>({ set: new Set(), order: [] });

  useEffect(() => {
    const source = createMockFloorSource({ stress });
    const userIds = scopeKey === '*' ? null : scopeKey.split(',').filter(Boolean);
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const accept = (events: DomainEvent[]) => {
      const fresh: DomainEvent[] = [];
      const s = seen.current;
      for (const e of events) {
        if (s.set.has(e.id)) continue;
        s.set.add(e.id);
        s.order.push(e.id);
        if (s.order.length > DEDUPE_MAX) s.set.delete(s.order.shift() as string);
        fresh.push(e);
      }
      if (!fresh.length) return;
      if (pausedRef.current) {
        buffer.current.push(...fresh);
        if (buffer.current.length > BUFFER_MAX) buffer.current.splice(0, buffer.current.length - BUFFER_MAX);
        return;
      }
      dispatch({ kind: 'events', events: fresh, now: Date.now() });
    };

    source
      .load()
      .then((snapshot) => {
        if (cancelled) return;
        dispatch({ kind: 'reset', state: initialFloorState(snapshot, { userIds }) });
        setStatus('ready');
        unsubscribe = source.subscribe(accept);
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    const pruneTimer = setInterval(() => dispatch({ kind: 'prune', now: Date.now() }), 1000);
    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(pruneTimer);
    };
  }, [scopeKey, stress, attempt]);

  const setPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPausedState(next);
    if (!next && buffer.current.length) {
      const events = buffer.current;
      buffer.current = [];
      dispatch({ kind: 'events', events, now: Date.now() });
    }
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((a) => a + 1);
  }, []);

  const localDispatch = useCallback<FloorFeed['dispatch']>((action) => dispatch(action), []);

  return { status, state, paused, setPaused, retry, dispatch: localDispatch };
}
