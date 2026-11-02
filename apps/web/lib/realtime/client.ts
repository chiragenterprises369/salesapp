'use client';

import type { QueryClient } from '@tanstack/react-query';
import {
  EVENT_NAMES,
  HEARTBEAT_INTERVAL_MS,
  REALTIME_NAMESPACE,
  type ClientToServerEvents,
  type DomainEvent,
  type EventName,
  type Heartbeat,
  type PresenceHeartbeat,
  type ServerToClientEvents,
  type SyncScope,
} from '@vistar/shared';
import { io, type Socket } from 'socket.io-client';
import { api, getFreshAccessToken, refreshAccessToken } from '../api/client';
import { WS_URL } from '../api/config';
import { activityFor, knownScopes, leadIdForPath, scopesForEvent, screenForPath } from './logic';

/**
 * Minimal realtime client (web, workspace sessions in API mode). One Socket.IO connection per tab to
 * the `/realtime` namespace with the in-memory access token.
 *
 * - Events: every DomainEvent marks the query scopes it touches stale (lib/realtime/logic); the
 *   refetch is debounced (400 ms) so a burst of events costs one refetch per scope. Listeners added
 *   with `onRealtimeEvent` (Team Floor, live widgets) get the raw events.
 * - Reconnect: the server sends `sync.required` on every connection that is not the first one after
 *   loading data (`auth.fresh`); those scopes refetch, so nothing missed while offline stays stale.
 * - Heartbeat every HEARTBEAT_INTERVAL_MS with activity (active, idle after 2 min without input,
 *   hidden), the screen in use and the open lead (SPEC 29.2 / 29.11), see `beat()`.
 * - Token expiry: `auth.expired` or a connect error with an auth code refreshes the token
 *   (single-flight in lib/api/client) and reconnects. Sign-out disconnects (the server treats a
 *   deliberate disconnect as logout of this device).
 */

type VSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Listener = (event: DomainEvent) => void;

export interface RealtimeHandle {
  stop: () => void;
}

const listeners = new Set<Listener>();
const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;

/** Raw domain events (after they reach the tab). Returns unsubscribe. */
export function onRealtimeEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Connection state changes (true = connected). Returns unsubscribe. */
export function onRealtimeStatus(listener: (connected: boolean) => void): () => void {
  statusListeners.add(listener);
  listener(connected);
  return () => statusListeners.delete(listener);
}

export const isRealtimeConnected = () => connected;

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const l of statusListeners) l(next);
}

const AUTH_CODES = new Set(['AUTH_TOKEN_INVALID', 'AUTH_TOKEN_EXPIRED', 'AUTH_UNAUTHENTICATED']);

export interface RealtimeOptions {
  /** Send presence heartbeats (off for read-only support sessions). */
  heartbeat: boolean;
  appVersion?: string;
}

/** Start the realtime client for a workspace session. */
export function startRealtime(qc: QueryClient, opts: RealtimeOptions): RealtimeHandle {
  let stopped = false;
  let first = true;
  let lastInputAt = Date.now();
  let beatTimer = 0;
  let flushTimer = 0;
  let lastRestKey = '';
  const pending = new Set<SyncScope>();

  const flush = () => {
    flushTimer = 0;
    const scopes = [...pending];
    pending.clear();
    for (const scope of scopes) void qc.invalidateQueries({ queryKey: [scope] });
  };
  const markStale = (scopes: readonly SyncScope[]) => {
    for (const s of scopes) pending.add(s);
    if (pending.size && !flushTimer) flushTimer = window.setTimeout(flush, 400);
  };

  const socket: VSocket = io(`${WS_URL}${REALTIME_NAMESPACE}`, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    withCredentials: true,
    autoConnect: false,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 15_000,
    auth: (cb) => {
      void getFreshAccessToken('workspace').then((token) => {
        cb({ token: token ?? '', client: 'web', appVersion: opts.appVersion, fresh: first });
        first = false;
      });
    },
  });

  const onEvent = (event: DomainEvent) => {
    if (!event || typeof event !== 'object' || !event.type) return;
    markStale(scopesForEvent(event.type));
    for (const l of listeners) {
      try {
        l(event);
      } catch (e) {
        console.warn('[vistar] realtime listener failed', e);
      }
    }
  };
  for (const name of EVENT_NAMES) socket.on(name as EventName, onEvent as never);

  socket.on('sync.required', (p) => markStale(knownScopes(p?.scopes ?? [])));
  socket.on('auth.expired', () => {
    void refreshAccessToken('workspace')
      .then(() => {
        if (!stopped) socket.connect();
      })
      .catch(() => undefined);
  });
  socket.on('connect', () => {
    setConnected(true);
    beat(true);
  });
  socket.on('disconnect', () => setConnected(false));
  let retryTimer = 0;
  let retryMs = 2_000;
  socket.on('connect', () => {
    retryMs = 2_000;
  });
  socket.on('connect_error', (err) => {
    setConnected(false);
    const code = (err as Error & { data?: { code?: string } }).data?.code ?? err.message;
    // A rejected handshake (middleware error) is not retried by socket.io: refresh the token, then
    // connect again with backoff. A failed refresh ends the session and the provider stops us.
    if (socket.active || stopped) return;
    const again = () => {
      retryTimer = 0;
      if (!stopped && !socket.connected) socket.connect();
    };
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, 60_000);
    if (AUTH_CODES.has(code)) {
      void refreshAccessToken('workspace')
        .then(() => (retryTimer = window.setTimeout(again, 500)))
        .catch(() => undefined);
    } else retryTimer = window.setTimeout(again, wait);
  });

  function heartbeat(): PresenceHeartbeat {
    const now = Date.now();
    return {
      client: 'web',
      activity: activityFor(document.visibilityState === 'hidden', lastInputAt, now),
      screen: screenForPath(window.location.pathname, window.location.search),
      currentLeadId: leadIdForPath(window.location.pathname, window.location.search),
    };
  }

  /**
   * Socket heartbeat every interval (with `screen`, for servers whose socket schema has it). The REST
   * heartbeat carries `screen` for today's servers: sent when the screen, activity or lead changes,
   * and every interval while the socket is down (fallback).
   */
  function beat(force = false) {
    if (stopped || !opts.heartbeat) return;
    const hb = heartbeat();
    if (socket.connected) {
      const payload: Heartbeat & { screen?: PresenceHeartbeat['screen'] } = { activity: hb.activity, currentLeadId: hb.currentLeadId ?? null, client: 'web', screen: hb.screen };
      socket.emit('presence.heartbeat', payload);
    }
    const key = `${hb.screen}|${hb.activity}|${hb.currentLeadId ?? ''}`;
    if (force || key !== lastRestKey || !socket.connected) {
      lastRestKey = key;
      void api.call('myPresenceHeartbeat', { body: hb }).catch(() => undefined);
    }
  }

  const onInput = () => {
    const wasIdle = Date.now() - lastInputAt > 60_000;
    lastInputAt = Date.now();
    if (wasIdle) beat();
  };
  const onVisibility = () => beat();
  const onNavigate = () => window.setTimeout(() => beat(), 50);
  const inputEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  for (const e of inputEvents) window.addEventListener(e, onInput, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('popstate', onNavigate);
  // Next.js client navigation uses history.pushState; wrap it while running to notice route changes.
  const nativePush = history.pushState;
  const nativeReplace = history.replaceState;
  history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
    nativePush.apply(this, args);
    onNavigate();
  };
  history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
    nativeReplace.apply(this, args);
    onNavigate();
  };

  beatTimer = window.setInterval(() => beat(), HEARTBEAT_INTERVAL_MS);
  socket.connect();

  return {
    stop: () => {
      stopped = true;
      window.clearInterval(beatTimer);
      if (flushTimer) window.clearTimeout(flushTimer);
      if (retryTimer) window.clearTimeout(retryTimer);
      for (const e of inputEvents) window.removeEventListener(e, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('popstate', onNavigate);
      history.pushState = nativePush;
      history.replaceState = nativeReplace;
      socket.removeAllListeners();
      socket.disconnect();
      setConnected(false);
    },
  };
}
