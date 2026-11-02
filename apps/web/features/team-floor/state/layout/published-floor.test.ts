import { FloorPlanSchema, seatMapFromPlan, type DomainEvent, type SeatMap, type TeamFloorSnapshot } from '@vistar/shared';
import { mockTeamFloorSnapshot } from '@vistar/shared/fixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLayout } from '../layout';
import { PathFinder } from '../pathfinding';
import { floorRootReducer, initialFloorState } from '../reducer';
import { locationOf } from '../selectors';
import { FloorTemplateSchema } from '../template';
import { templateFromModel, templateFromPlan } from './plan-template';

/**
 * Published floors as templates (SPEC 29.5, 29.11): the sample plan an AI chat would return for a
 * 24 x 16 m office (public/team-floor/samples/sample-office.json), and a GLB seat map.
 */

const SAMPLE = join(__dirname, '../../../../public/team-floor/samples/sample-office.json');
const plan = FloorPlanSchema.parse(JSON.parse(readFileSync(SAMPLE, 'utf8')));
const seatMap = seatMapFromPlan(plan);
const meta = { key: 'test:1', floorId: 'f1', version: 1 };

describe('templateFromPlan (layout_json)', () => {
  const t = templateFromPlan(plan, seatMap, meta);
  const layout = buildLayout(t, 22);

  it('is a valid floor template marked as a custom layout_json floor', () => {
    expect(FloorTemplateSchema.safeParse(t).success).toBe(true);
    expect(t.custom?.format).toBe('layout_json');
    expect(t.bounds.max).toEqual([24, 16]);
  });

  it('keeps every seat of the seat map with its id, and adds a booth per phone booth', () => {
    for (const s of seatMap.seats) expect(t.seats.some((x) => x.id === s.id)).toBe(true);
    expect(t.seats.filter((s) => s.kind === 'booth')).toHaveLength(2);
    expect(t.seats.filter((s) => s.kind === 'meeting')).toHaveLength(6);
  });

  it('puts a monitor on the desk in front of every desk and cabin seat', () => {
    const screens = new Set(t.props.filter((p) => p.type === 'kit_monitor').map((p) => p.screen));
    for (const s of t.seats.filter((x) => x.kind === 'desk' || x.kind === 'cabin')) expect(screens.has(s.id), s.id).toBe(true);
  });

  it('cuts a door into every walled room and keeps the entrance on the front wall', () => {
    for (const r of plan.rooms.filter((x) => x.walls !== 'none')) {
      const walls = t.walls.filter((w) => w.id.startsWith(`room-${r.id}-`) || w.openings.length);
      expect(walls.some((w) => w.openings.length > 0), r.id).toBe(true);
    }
    expect(t.walls.find((w) => w.id === 'front-south')?.openings.length).toBeGreaterThan(0);
    expect(t.entrance.outside[1]).toBeGreaterThan(16);
  });

  it('uses the Lead Hub item and keeps inner solid walls low and glass walls tall', () => {
    expect(t.hub.pos).toEqual([11, 13]);
    for (const w of t.walls.filter((x) => x.kind === 'partition')) expect(w.height).toBeLessThanOrEqual(1.2);
    for (const w of t.walls.filter((x) => x.kind === 'glass')) expect(w.height).toBeGreaterThan(2);
  });

  it('can walk from the entrance to every seat', () => {
    const paths = new PathFinder(layout);
    const { entrance } = layout;
    for (const s of t.seats) {
      const route = paths.route(entrance.x, entrance.z, s.pos[0], s.pos[1], { fromNode: entrance.approach, toNode: s.approach });
      expect(route, `route to ${s.id}`).not.toBeNull();
    }
  });

  it('has visitor spots in every room for zone tracking', () => {
    const ids = layout.zones.map((z) => z.id);
    for (const z of seatMap.zones) expect(ids, z.id).toContain(z.id);
    expect(layout.zones.find((z) => z.id === 'conference')?.spots.length).toBeGreaterThanOrEqual(6);
  });

  it('follows seat tool edits: moved seats and renamed zones come from the seat map', () => {
    const edited: SeatMap = { ...seatMap, seats: seatMap.seats.map((s) => (s.id === 'd1' ? { ...s, position: [3.3, 0, 7.1] as [number, number, number] } : s)), zones: seatMap.zones.map((z) => (z.id === 'pantry' ? { ...z, name: 'Cafe' } : z)) };
    const t2 = templateFromPlan(plan, edited, { ...meta, key: 'test:2' });
    expect(t2.seats.find((s) => s.id === 'd1')?.pos).toEqual([3.3, 7.1]);
    expect(t2.rooms.find((r) => r.id === 'pantry')?.name).toBe('Cafe');
  });
});

describe('templateFromModel (GLB / glTF)', () => {
  const map: SeatMap = {
    schemaVersion: 1,
    units: 'm',
    scale: 0.01,
    origin: [0, 0, 0],
    seats: [
      { id: 's1', kind: 'desk', position: [2, 0, 2], rotation: 0, zoneId: 'floor' },
      { id: 's2', kind: 'desk', position: [4, 0, 2], rotation: 0, zoneId: 'floor' },
      { id: 's3', kind: 'meeting', position: [8, 0, 3], rotation: 90, zoneId: 'room' },
    ],
    zones: [
      { id: 'floor', name: 'Work area', kind: 'work_area', polygon: [[0, 0], [6, 0], [6, 6], [0, 6]] },
      { id: 'room', name: 'Meeting room', kind: 'meeting_room', polygon: [[6, 0], [10, 0], [10, 6], [6, 6]] },
    ],
  };
  const t = templateFromModel(map, { ...meta, key: 'model:1', format: 'glb' });

  it('is valid, has the zones as rooms and the model placement', () => {
    expect(FloorTemplateSchema.safeParse(t).success).toBe(true);
    expect(t.rooms.map((r) => r.id)).toEqual(['floor', 'room']);
    expect(t.custom?.model).toEqual({ scale: 0.01, origin: [0, 0, 0] });
    expect(t.walls).toHaveLength(0);
  });
});

describe('zone placement (SPEC 29.11)', () => {
  const t = templateFromPlan(plan, seatMap, meta);
  const base = mockTeamFloorSnapshot(new Date('2026-11-03T10:00:00Z'));
  const people = base.employees.slice(0, 5);
  const at = '2026-11-03T10:00:00.000Z';
  const snapshot: TeamFloorSnapshot = {
    ...base,
    employees: people.map((e, i) => ({
      ...e,
      status: 'idle',
      activeCall: null,
      presence: {
        status: 'available',
        version: 1,
        employeeStatus: 'idle',
        source: 'heartbeat',
        since: at,
        manualStatus: null,
        lastHeartbeatAt: at,
        lastSeenAt: at,
        activity: { callId: null, callStartedAt: null, leadId: null, leadName: null, client: 'android', clientActivity: 'active', note: null, screen: 'leads' },
        location: i === 0 ? { zoneId: 'conference', zoneName: 'Conference room', source: 'ble', confidence: 0.9, since: at, at } : null,
        seatId: `d${i + 1}`,
        isFieldStaff: false,
        checkedIn: false,
      },
    })),
  };
  const state = initialFloorState(snapshot, { template: t });

  it('seats people at the server seat and puts the first one in the conference room', () => {
    const layout = buildLayout(t, people.length);
    const first = state.employees[0]!;
    expect(layout.homes[state.employees[1]!.desk]?.id).toBe('d2');
    expect(locationOf(state, first).kind).toBe('zone');
    expect(first.zoneName).toBe('Conference room');
    expect(first.screen).toBe('leads');
  });

  it('walks people between zones on employee.zone_changed and back to the desk when the zone clears', () => {
    const userId = state.employees[1]!.id;
    const event = (zoneId: string | null): DomainEvent =>
      ({ id: `e-${zoneId}`, type: 'employee.zone_changed', workspaceId: 'w', occurredAt: at, actor: null, payload: { userId, zoneId, previousZoneId: null, source: 'qr', confidence: 1, at } }) as unknown as DomainEvent;
    const inPantry = floorRootReducer(state, { kind: 'events', events: [event('pantry')], now: 1 })!;
    const emp = inPantry.employees[1]!;
    expect(locationOf(inPantry, emp)).toMatchObject({ kind: 'zone', zoneId: 'pantry' });
    expect(emp.zoneName).toBe('Pantry');
    const back = floorRootReducer(inPantry, { kind: 'events', events: [event(null)], now: 2 })!;
    expect(locationOf(back, back.employees[1]!).kind).toBe('desk');
  });

  it('accepts presence patches from another source', () => {
    const userId = state.employees[2]!.id;
    const next = floorRootReducer(state, { kind: 'presence', userId, patch: { zoneId: 'reception', screen: 'calls' } })!;
    expect(locationOf(next, next.employees[2]!)).toMatchObject({ kind: 'zone', zoneId: 'reception' });
    expect(next.employees[2]!.screen).toBe('calls');
  });
});
