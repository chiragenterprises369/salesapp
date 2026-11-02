import type { Call, CallDirection, CallOutcome } from '@vistar/shared';
import { DAY_MS, hashSeed, istDayStart } from '@vistar/shared/fixtures';

/** Pure call-log helpers: filters, totals strip and the mock recording waveform. Tested in ./logic.test.ts. */

/** Calls the viewer may see (Call.userId in scope; calls without a user need all scope). */
export function scopeCalls(calls: readonly Call[], v: { userId: string | null; visible: ReadonlySet<string> | null }): Call[] {
  if (!v.userId) return [];
  return calls.filter((c) => v.visible === null || (!!c.user && v.visible.has(c.user.id)));
}

export interface CallFilter {
  userId?: string;
  outcome?: CallOutcome | 'all' | 'missed_any';
  direction?: CallDirection | 'all';
  q?: string;
}

export function matchesCall(c: Call, f: CallFilter): boolean {
  if (f.userId && f.userId !== 'all' && c.user?.id !== f.userId) return false;
  if (f.direction && f.direction !== 'all' && c.direction !== f.direction) return false;
  if (f.outcome === 'missed_any' && c.status !== 'missed' && c.status !== 'failed') return false;
  if (f.outcome && f.outcome !== 'all' && f.outcome !== 'missed_any' && c.outcome !== f.outcome) return false;
  const q = f.q?.trim().toLowerCase();
  if (q && !`${c.leadName ?? ''} ${c.from} ${c.to} ${c.notes ?? ''} ${c.disposition ?? ''} ${c.user?.name ?? ''}`.toLowerCase().includes(q)) return false;
  return true;
}

export function filterCalls(calls: readonly Call[], f: CallFilter, range?: { from: number; to: number }): Call[] {
  return calls.filter((c) => {
    if (range) {
      const t = Date.parse(c.startedAt);
      if (t < range.from || t >= range.to) return false;
    }
    return matchesCall(c, f);
  });
}

/** A call reached the lead: completed and not a voicemail. */
export const isConnected = (c: Call) => c.status === 'completed' && c.outcome !== 'voicemail';

export interface CallTotals {
  /** Finished calls in the list (in-progress calls are not counted). */
  total: number;
  connected: number;
  missed: number;
  /** 0-100, one decimal. */
  connectedRate: number;
  avgDurationSec: number;
  talkSec: number;
  inbound: number;
  outbound: number;
}

export function callTotals(calls: readonly Call[]): CallTotals {
  let total = 0;
  let connected = 0;
  let talk = 0;
  let missed = 0;
  let inbound = 0;
  for (const c of calls) {
    if (c.status === 'in_progress' || c.status === 'ringing') continue;
    total++;
    if (c.direction === 'inbound') inbound++;
    if (c.status === 'missed' || c.status === 'failed') missed++;
    if (isConnected(c)) {
      connected++;
      talk += c.durationSec;
    }
  }
  return {
    total,
    connected,
    missed,
    connectedRate: total ? Math.round((connected / total) * 1000) / 10 : 0,
    avgDurationSec: connected ? Math.round(talk / connected) : 0,
    talkSec: talk,
    inbound,
    outbound: total - inbound,
  };
}

/** Calls that started today (IST), in the given list. */
export function callsToday(calls: readonly Call[], now: number): Call[] {
  const from = istDayStart(now);
  return calls.filter((c) => {
    const t = Date.parse(c.startedAt);
    return t >= from && t < from + DAY_MS;
  });
}

/** Deterministic mock waveform (0.12-1 peaks) for a call id: the same call always draws the same shape. */
export function waveform(callId: string, bars = 64): number[] {
  let s = hashSeed(callId) || 1;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const noise = s / 4294967296;
    const envelope = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI);
    out.push(Math.max(0.12, Math.min(1, envelope * (0.35 + noise * 0.75))));
  }
  return out;
}
