import type { EmployeeStatus } from '@vistar/shared';
import { getLayout } from '../layout';
import type { FloorTemplate } from '../template';
import type { FloorEmployee, FloorState } from '../types';

/**
 * Floor state for the Super Admin preview of a floor version (seat tool, before publishing): one
 * stand-in figure per home seat, named after the seat ("Desk 4"), so scale, seat direction and
 * walking can be judged. Never used on a company's live floor.
 */

const STATUS_CYCLE: EmployeeStatus[] = ['busy', 'idle', 'busy', 'on_call', 'busy', 'away'];

export function previewFloorState(
  template: FloorTemplate,
  opts: { people?: number; withPeople?: boolean } = {},
): FloorState {
  const seats = template.seats.filter(
    (s) =>
      s.kind === 'desk' || s.kind === 'cabin' || s.kind === 'reception' || s.kind === 'hot_desk',
  );
  const count =
    opts.withPeople === false
      ? 0
      : Math.min(seats.length, Math.max(0, opts.people ?? seats.length));
  const layout = getLayout(template, count);
  const employees: FloorEmployee[] = [];
  for (let i = 0; i < count; i++) {
    const seat = seats[i]!;
    const home = layout.homes.findIndex((h) => h.id === seat.id);
    const status = STATUS_CYCLE[i % STATUS_CYCLE.length]!;
    employees.push({
      id: `preview-${seat.id}`,
      name: seat.id.replace(/[-_]/g, ' '),
      role: seat.kind === 'cabin' ? 'manager' : 'employee',
      avatar: null,
      desk: home === -1 ? i : home,
      homeRoom: seat.room,
      seatId: seat.id,
      status,
      statusSince: null,
      currentLeadId: null,
      currentLeadName: null,
      activeCall:
        status === 'on_call'
          ? { callId: `preview-call-${i}`, startedAt: Date.now(), leadName: null }
          : null,
      callsToday: 0,
      avgTalkSec: 0,
      talkedCalls: 0,
      targetPct: null,
      recent: [],
    });
  }
  const index: Record<string, number> = {};
  employees.forEach((e, i) => (index[e.id] = i));
  const booths: (string | null)[] = layout.booths.map(() => null);
  const lounge: (string | null)[] = layout.lounge.map(() => null);
  for (const e of employees) {
    if (e.status === 'on_call') {
      const free = booths.indexOf(null);
      if (free !== -1) booths[free] = e.id;
    }
    if (e.status === 'away') {
      const free = lounge.indexOf(null);
      if (free !== -1) lounge[free] = e.id;
    }
  }
  const zoneSlots: FloorState['zoneSlots'] = {};
  for (const z of layout.zones) zoneSlots[z.id] = z.spots.map(() => null);
  const zoneNames: Record<string, string> = {};
  for (const r of template.rooms) if (!r.id.startsWith('__')) zoneNames[r.id] = r.name;
  return {
    employees,
    index,
    templateId: template.id,
    homeCount: Math.max(count, layout.seatHomes),
    booths,
    lounge,
    zoneSlots,
    zoneNames,
    leadsWaiting: [],
    leadsWaitingExtra: 0,
    attention: [],
    effects: [],
    log: [],
    logSeq: 0,
  };
}
