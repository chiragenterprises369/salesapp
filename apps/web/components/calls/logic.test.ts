import type { Call } from '@vistar/shared';
import { createWorldContext, mockTeams, mockUsers, worldCalls } from '@vistar/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { customRange, presetRange, previousRange } from '../reports/date-range';
import { callTotals, callsToday, filterCalls, isConnected, scopeCalls, waveform } from './logic';

const NOW = Date.parse('2026-11-02T06:30:00.000Z'); // 12:00 IST
const calls = worldCalls(createWorldContext({ now: NOW }));
const users = mockUsers();
const manager = users.find((u) => u.name === 'Priya Sharma')!;
const rep = users.find((u) => u.name === 'Rohit Verma')!;
const team = mockTeams().find((t) => t.managerId === manager.id)!;

describe('call scope filters', () => {
  it('employees only see their own calls', () => {
    const rows = scopeCalls(calls, { userId: rep.id, visible: new Set([rep.id]) });
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((c) => c.user?.id === rep.id)).toBe(true);
  });
  it('managers see their team; admins see everything', () => {
    const rows = scopeCalls(calls, { userId: manager.id, visible: new Set(team.memberIds) });
    expect(rows.every((c) => !!c.user && team.memberIds.includes(c.user.id))).toBe(true);
    expect(rows.length).toBeLessThan(calls.length);
    expect(scopeCalls(calls, { userId: 'x', visible: null })).toHaveLength(calls.length);
    expect(scopeCalls(calls, { userId: null, visible: null })).toHaveLength(0);
  });
});

describe('call filters and totals', () => {
  it('filters by employee, direction, outcome and search', () => {
    expect(filterCalls(calls, { userId: rep.id }).every((c) => c.user?.id === rep.id)).toBe(true);
    expect(filterCalls(calls, { direction: 'inbound' }).every((c) => c.direction === 'inbound')).toBe(true);
    expect(filterCalls(calls, { outcome: 'interested' }).every((c) => c.outcome === 'interested')).toBe(true);
    expect(filterCalls(calls, { outcome: 'missed_any' }).every((c) => c.status === 'missed' || c.status === 'failed')).toBe(true);
    const name = calls.find((c) => c.leadName)!.leadName!;
    expect(filterCalls(calls, { q: name.toLowerCase() }).length).toBeGreaterThan(0);
  });

  it('totals: connected excludes voicemail; average is over connected calls', () => {
    const sample: Call[] = [
      { ...calls[0]!, status: 'completed', outcome: 'answered', durationSec: 100 },
      { ...calls[0]!, status: 'completed', outcome: 'voicemail', durationSec: 30 },
      { ...calls[0]!, status: 'missed', outcome: 'missed', durationSec: 0 },
      { ...calls[0]!, status: 'completed', outcome: 'interested', durationSec: 200, direction: 'inbound' },
      { ...calls[0]!, status: 'in_progress', outcome: null, durationSec: 0 },
    ];
    const t = callTotals(sample);
    expect(t.total).toBe(4);
    expect(t.connected).toBe(2);
    expect(t.missed).toBe(1);
    expect(t.connectedRate).toBe(50);
    expect(t.avgDurationSec).toBe(150);
    expect(t.talkSec).toBe(300);
    expect(isConnected(sample[1]!)).toBe(false);
  });

  it('range filtering is half-open and "today" uses the IST day', () => {
    const r = presetRange('today', NOW);
    const today = callsToday(calls, NOW);
    expect(filterCalls(calls, {}, r)).toHaveLength(today.length);
    expect(today.every((c) => Date.parse(c.startedAt) >= r.from && Date.parse(c.startedAt) < r.to)).toBe(true);
    expect(previousRange(r).to).toBe(r.from);
    expect(customRange('2026-11-02', '2026-10-27')).toEqual(presetRange('7d', NOW));
    expect(customRange('bad', '2026-10-27')).toBeNull();
  });
});

describe('waveform', () => {
  it('is deterministic and within 0-1', () => {
    const a = waveform('call-1', 48);
    expect(a).toHaveLength(48);
    expect(waveform('call-1', 48)).toEqual(a);
    expect(waveform('call-2', 48)).not.toEqual(a);
    expect(a.every((p) => p > 0 && p <= 1)).toBe(true);
  });
});
