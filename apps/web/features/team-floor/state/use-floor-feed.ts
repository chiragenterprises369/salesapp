'use client';

import type { DomainEvent, TeamFloorRef, TeamFloorSnapshot } from '@vistar/shared';
import { createEventSimulator, mockTeamFloorSnapshot } from '@vistar/shared/fixtures';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { isMockData } from '@/lib/api/data-source';
import { onRealtimeEvent, onRealtimeStatus } from '@/lib/realtime/client';
import { createApiFloorSource } from '@/lib/realtime/floor-source';
import { INITIAL_LIVE_FLOOR, liveFloorReducer, type LiveState } from '../workspace/live-presence';
import { initialFloorState } from './reducer';
import { withStressEmployees } from './stress';
import { loadTemplate, resolveTemplateId, type FloorTemplate, type TemplateId } from './template';
import type { FloorAction, FloorState } from './types';

/**
 * Data source for the floor: GET /team-floor/snapshot + the realtime socket in API mode
 * (lib/realtime/floor-source), the mock snapshot + event simulator in the test-only mock mode.
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
  /** Validated floor template the state refers to (null until loaded). */
  template: FloorTemplate | null;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  retry: () => void;
  /** Local (Wave 1) actions: resolve/restore attention, reassign. */
  dispatch: (action: Exclude<FloorAction, { kind: 'reset' } | { kind: 'events' }>) => void;
  /** Server presence per person (D-062): detailed status, version, zone, activity, screen, last seen. */
  live: LiveState;
  /** Realtime socket connected (always true in the test-only mock mode). */
  connected: boolean;
  /** Which floor the server says to draw (snapshot.floor); null until loaded or in mock mode. */
  floorRef: TeamFloorRef | null;
}

const DEDUPE_MAX = 500;
const BUFFER_MAX = 500;
/** Last seen and zone confidence move without events (D-062): refresh them from the snapshot. */
const LIVE_REFRESH_MS = 60_000;
/** Events the feed takes besides the floor events of the API floor source. */
const EXTRA_EVENTS = new Set(['attendance.checked_in', 'attendance.checked_out', 'floor.published']);

/**
 * One hook owns the floor data: initial snapshot and floor template, then events through the live
 * presence reducer (version ordering, zones, activity) and `floorRootReducer`. Dedupes by event id
 * (last 500), buffers while paused, prunes expired effects, reloads the snapshot after a reconnect and
 * after `floor.published`, and refreshes last seen and zone confidence every minute while visible.
 * The template follows the head count (SPEC 12.1); `template` overrides it (dev and screenshots).
 * `enabled: false` keeps the hook idle (the caller passes a feed it lifted, e.g. the floor workspace).
 */
export function useFloorFeed(
  opts: { userIds?: readonly string[] | null; stress?: number; template?: TemplateId | null; enabled?: boolean } = {},
): FloorFeed {
  const scopeKey = opts.userIds ? [...opts.userIds].sort().join(',') : '*';
  const stress = opts.stress ?? 0;
  const templateOverride = opts.template ?? null;
  const enabled = opts.enabled ?? true;
  const [{ floor: state, live }, dispatch] = useReducer(liveFloorReducer, INITIAL_LIVE_FLOOR);
  const [template, setTemplate] = useState<FloorTemplate | null>(null);
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const [paused, setPausedState] = useState(false);
  const [connected, setConnected] = useState(() => isMockData());
  const [floorRef, setFloorRef] = useState<TeamFloorRef | null>(null);
  const pausedRef = useRef(false);
  const buffer = useRef<DomainEvent[]>([]);
  const seen = useRef<{ set: Set<string>; order: string[] }>({ set: new Set(), order: [] });

  useEffect(() => {
    if (!enabled) return;
    // API mode: GET /team-floor/snapshot + the realtime socket (lib/realtime); mock mode (tests,
    // dev stress): the mock snapshot and event simulator.
    const api$ = !isMockData() && stress === 0 ? createApiFloorSource() : null;
    const source: FloorSource = api$ ?? createMockFloorSource({ stress });
    // Dev stress mode pads the whole workspace with synthetic people, so the team scope is lifted.
    const userIds = scopeKey === '*' || stress > 0 ? null : scopeKey.split(',').filter(Boolean);
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let loaded: FloorTemplate | null = null;

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

    /** Zone names of the published seat map (zone events carry only the id). */
    const loadZoneNames = () => {
      if (!api$) return;
      void api
        .call('teamFloorLayout')
        .then((layout) => {
          const zones = layout.floor?.seatMap.zones ?? [];
          if (!cancelled && zones.length) dispatch({ kind: 'zones', zones: zones.map((z) => ({ id: z.id, name: z.name })) });
        })
        .catch(() => undefined);
    };

    /** Full reload (after a reconnect or a newly published floor): events missed while away cannot leave it stale. */
    const reload = () => {
      if (!api$) return;
      void api$
        .load()
        .then((snapshot) => {
          if (cancelled || !loaded) return;
          dispatch({ kind: 'load', snapshot, floor: initialFloorState(snapshot, { userIds, template: loaded }) });
          setFloorRef(snapshot.floor ?? null);
        })
        .catch(() => undefined);
    };

    source
      .load()
      .then(async (snapshot) => {
        const scope = userIds ? new Set(userIds) : null;
        const people = scope ? snapshot.employees.filter((e) => scope.has(e.user.id)).length : snapshot.employees.length;
        const tpl = await loadTemplate(resolveTemplateId(people, templateOverride));
        if (cancelled) return;
        loaded = tpl;
        setTemplate(tpl);
        setFloorRef(snapshot.floor ?? null);
        dispatch({ kind: 'load', snapshot, floor: initialFloorState(snapshot, { userIds, template: tpl }) });
        setStatus('ready');
        unsubscribe = source.subscribe(accept);
        loadZoneNames();
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    const pruneTimer = setInterval(() => dispatch({ kind: 'prune', now: Date.now() }), 1000);
    const offResync = api$?.onResync(reload);
    const offStatus = api$
      ? onRealtimeStatus((up) => {
          if (!cancelled) setConnected(up);
        })
      : null;
    const offExtra = api$
      ? onRealtimeEvent((e) => {
          if (!EXTRA_EVENTS.has(e.type)) return;
          if (e.type === 'floor.published') {
            reload();
            loadZoneNames();
            return;
          }
          accept([e]);
        })
      : null;
    const refreshTimer = api$
      ? setInterval(() => {
          if (document.hidden || pausedRef.current || !loaded) return;
          void api$
            .load()
            .then((snapshot) => {
              if (!cancelled) dispatch({ kind: 'refresh', snapshot, now: Date.now() });
            })
            .catch(() => undefined);
        }, LIVE_REFRESH_MS)
      : null;
    return () => {
      cancelled = true;
      unsubscribe?.();
      offResync?.();
      offStatus?.();
      offExtra?.();
      clearInterval(pruneTimer);
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [scopeKey, stress, templateOverride, attempt, enabled]);

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

  return { status, state, template, paused, setPaused, retry, dispatch: localDispatch, live, connected, floorRef };
}
