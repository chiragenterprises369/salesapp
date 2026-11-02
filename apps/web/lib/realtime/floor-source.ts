'use client';

import type { DomainEvent, TeamFloorSnapshot } from '@vistar/shared';
import { api } from '../api/client';
import { onRealtimeEvent, onRealtimeStatus } from './client';

/** Events the Team Floor reducer understands (others are ignored by it anyway). */
const FLOOR_EVENTS = new Set<string>([
  'employee.status_changed',
  'employee.zone_changed',
  'call.started',
  'call.ended',
  'call.updated',
  'lead.created',
  'lead.assigned',
  'task.overdue',
  'attention.raised',
  'attention.resolved',
]);

/**
 * Team Floor data in API mode (same interface as the mock floor source in features/team-floor):
 * GET /team-floor/snapshot (server-authoritative presence, seats and the published floor), then the
 * live events from the realtime socket, batched per animation frame. After a reconnect the floor
 * asks for a fresh snapshot (`onResync`), so events missed while offline cannot leave it stale.
 */
export interface ApiFloorSource {
  load(): Promise<TeamFloorSnapshot>;
  subscribe(onEvents: (events: DomainEvent[]) => void): () => void;
  /** Called after the socket reconnects (the caller reloads the snapshot). Returns unsubscribe. */
  onResync(cb: () => void): () => void;
}

export function createApiFloorSource(opts: { teamId?: string | null } = {}): ApiFloorSource {
  return {
    load: () => api.call('teamFloorSnapshot', { query: opts.teamId ? { teamId: opts.teamId } : {} }),
    subscribe(onEvents) {
      let batch: DomainEvent[] = [];
      let frame = 0;
      const off = onRealtimeEvent((e) => {
        if (!FLOOR_EVENTS.has(e.type)) return;
        batch.push(e);
        if (!frame)
          frame = window.requestAnimationFrame(() => {
            frame = 0;
            const out = batch;
            batch = [];
            onEvents(out);
          });
      });
      return () => {
        off();
        if (frame) window.cancelAnimationFrame(frame);
      };
    },
    onResync(cb) {
      let seen = false;
      let wasConnected = false;
      return onRealtimeStatus((up) => {
        // The first connect follows the snapshot load; only later reconnects resync.
        if (up && seen && !wasConnected) cb();
        if (up) seen = true;
        wasConnected = up;
      });
    },
  };
}
