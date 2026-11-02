import type { FloorPlan, SeatMap } from '@vistar/shared';
import { insidePolygon, obstacleDistance, pointSegment, polygonCentroid, roomAt } from '../layout';
import { FloorTemplateSchema, templateFor, type FloorTemplate, type RoomType, type SeatKind } from '../template';
import { KIT_CHAIR, KIT_ITEMS, KIT_MONITOR, KIT_STOOL, PLAN_FLOOR } from './kit';
import { buildWalkGraph, nodeFinder, round, toObstacle, wallSolids } from './walk-graph';

/**
 * Published floors as floor templates (SPEC 29.5, 29.11; D-061). The live floor (3D scene, flat plan,
 * reducer, pathfinding) only knows templates, so a company's floor is converted once per version:
 *
 * - `templateFromPlan`: a Vistar floor plan (`layout_json`, FloorPlanSchema, written by an AI chat
 *   from the office photos). Rooms become floors and walls (outer back walls full height, outer front
 *   walls low, inner walls cut away to 1.1 m or glass), doors become openings, items the module kit
 *   (scene/kit), seats chairs and monitors. Seats and zones come from the published SEAT MAP (the seat
 *   tool may have changed them), architecture and furniture from the plan.
 * - `templateFromModel`: a GLB or zipped glTF. Only the seat map is known here (the model draws itself),
 *   so rooms are the seat-map zones and the walking graph is a grid over them.
 *
 * Plan and seat-map coordinates are metres from the top-left corner (x right, z down) = template
 * coordinates; rotations are headings in degrees (0 = facing +z, 90 = +x), as in the templates.
 */

export interface PublishedMeta {
  /** Unique per floor version and seat map. */
  key: string;
  floorId: string | null;
  version: number | null;
}

type Wall = FloorTemplate['walls'][number];
type Room = FloorTemplate['rooms'][number];
type Seat = FloorTemplate['seats'][number];
type Prop = FloorTemplate['props'][number];
type Obstacle = FloorTemplate['obstacles'][number];
type Spot = FloorTemplate['standing'][number];
type Pt = [number, number];

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const FRONT_HEIGHT = 1.05;
const INNER_SOLID_HEIGHT = 1.1;
const INNER_GLASS_HEIGHT = 2.3;
const DOOR_NODE = 0.6;

export const ZONE_ROOM_TYPE: Record<SeatMap['zones'][number]['kind'], RoomType> = {
  work_area: 'sales_floor',
  cabin: 'manager_cabin',
  meeting_room: 'meeting_room',
  reception: 'reception',
  pantry_lounge: 'lounge',
  other: 'other',
};

const SEAT_KIND: Record<SeatMap['seats'][number]['kind'], SeatKind> = {
  desk: 'desk',
  cabin: 'cabin',
  meeting: 'meeting',
  lounge: 'lounge',
  reception: 'reception',
};

/** Forward direction of a heading in degrees. */
const forward = (deg: number): Pt => [Math.sin(deg * RAD), Math.cos(deg * RAD)];

/** Point inside an item's rotated footprint (rect) or radius (round), with a margin. */
function insideItem(item: { kind: keyof typeof KIT_ITEMS; position: Pt; rotation: number }, x: number, z: number, margin = 0): boolean {
  const spec = KIT_ITEMS[item.kind];
  const dx = x - item.position[0];
  const dz = z - item.position[1];
  if (spec.shape === 'round') return Math.hypot(dx, dz) <= spec.size[0] + margin;
  const c = Math.cos(-item.rotation * RAD);
  const s = Math.sin(-item.rotation * RAD);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) <= spec.size[0] / 2 + margin && Math.abs(lz) <= spec.size[1] / 2 + margin;
}

interface Opening {
  wall: Wall;
  at: number;
  centre: Pt;
  normal: Pt;
}

function addOpening(wall: Wall, at: number, width: number): Opening | null {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (len < 0.7) return null;
  const half = Math.min(width, len - 0.1) / 2;
  const mid = Math.max(half + 0.05, Math.min(len - half - 0.05, at));
  const from = round(mid - half);
  const to = round(mid + half);
  if (wall.openings.some((o) => o.kind !== 'window' && o.from < to && o.to > from)) return null;
  wall.openings.push({ kind: 'door', from, to });
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uz = (wall.b[1] - wall.a[1]) / len;
  return { wall, at: mid, centre: [wall.a[0] + ux * mid, wall.a[1] + uz * mid], normal: [-uz, ux] };
}

function projectOnWall(wall: Wall, p: Pt): { at: number; dist: number } {
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) || 1;
  const ux = (wall.b[0] - wall.a[0]) / len;
  const uz = (wall.b[1] - wall.a[1]) / len;
  const at = (p[0] - wall.a[0]) * ux + (p[1] - wall.a[1]) * uz;
  return { at, dist: pointSegment(p[0], p[1], wall.a[0], wall.a[1], wall.b[0], wall.b[1]) };
}

/** Rooms, seats and the walking graph shared by both builders. */
function finish(t: Omit<FloorTemplate, 'graph' | 'seats' | 'standing' | 'hub' | 'entrance'> & {
  seatMap: SeatMap;
  doorNodes: { id: string; pos: Pt; link?: string[] }[];
  entrance: { door: Pt; outward: Pt };
  hub: { pos: Pt; ringRadius: number; platformRadius: number; machineRadius: number };
  extraSeats: Omit<Seat, 'approach'>[];
  standing: Omit<Spot, 'approach'>[];
  monitors: boolean;
}): FloorTemplate {
  const { seatMap, doorNodes, entrance, hub, extraSeats, standing, monitors, ...base } = t;
  const outside: Pt = [round(entrance.door[0] + entrance.outward[0] * 0.95), round(entrance.door[1] + entrance.outward[1] * 0.95)];
  const inside: Pt = [round(entrance.door[0] - entrance.outward[0] * 0.9), round(entrance.door[1] - entrance.outward[1] * 0.9)];
  const graph = buildWalkGraph({
    footprint: base.footprint,
    walls: base.walls,
    obstacles: base.obstacles,
    extra: [...doorNodes, { id: 'entrance-in', pos: inside }, { id: 'entrance-out', pos: outside, link: ['entrance-in'] }],
  });
  const nearest = nodeFinder(graph, base.walls, base.obstacles);
  const zoneIds = new Set(base.rooms.map((r) => r.id));
  const seats: Seat[] = [];
  const props: Prop[] = [...base.props];
  for (const s of seatMap.seats) {
    const pos: Pt = [round(s.position[0]), round(s.position[2])];
    const kind = SEAT_KIND[s.kind];
    const room = s.zoneId && zoneIds.has(s.zoneId) ? s.zoneId : (roomAt(base.rooms, pos[0], pos[1]) ?? '__open');
    const seat: Seat = { id: s.id, kind, room, pos, facing: round(s.rotation), sit: true, approach: nearest(pos[0], pos[1]) };
    if (monitors && (kind === 'desk' || kind === 'cabin' || kind === 'reception')) {
      const work = workSurface(base.props, pos, s.rotation);
      if (work) {
        seat.work = work.work;
        seat.screen = s.id;
        props.push({ type: KIT_MONITOR, pos: work.monitor, facing: round(s.rotation + 180), y: work.height, screen: s.id, seat: s.id });
      }
    }
    seats.push(seat);
    if (monitors) {
      const onSofa = kind === 'lounge' && base.props.some((p) => (p.type === 'sofa' || p.type === 'armchair') && Math.hypot(p.pos[0] - pos[0], p.pos[1] - pos[1]) < 1.1);
      if (!onSofa) props.push({ type: kind === 'lounge' || kind === 'reception' ? KIT_STOOL : KIT_CHAIR, pos, facing: round(s.rotation), seat: s.id });
    }
  }
  for (const s of extraSeats) {
    const room = zoneIds.has(s.room) ? s.room : (roomAt(base.rooms, s.pos[0], s.pos[1]) ?? '__open');
    seats.push({ ...s, room, approach: nearest(s.pos[0], s.pos[1]) });
  }
  if (seats.some((s) => s.room === '__open') && !base.rooms.some((r) => r.id === '__open')) {
    base.rooms.unshift({ id: '__open', type: 'other', name: 'Open floor', floor: base.rooms[0]?.floor ?? 'oak', outline: base.footprint });
  }
  const candidate: FloorTemplate = {
    ...base,
    props,
    seats,
    standing: standing.map((s) => ({ ...s, approach: nearest(s.pos[0], s.pos[1]) })),
    hub: { ...hub, approach: nearest(hub.pos[0] + hub.platformRadius + 0.3, hub.pos[1]) },
    entrance: { outside, inside, facing: round(Math.atan2(-entrance.outward[0], -entrance.outward[1]) * DEG), approach: 'entrance-out' },
    graph,
  };
  return FloorTemplateSchema.parse(candidate);
}

/** Desk surface in front of a seat: where the parcel lands and the monitor stands (null = no desk there). */
function workSurface(props: Prop[], seat: Pt, facing: number): { work: Pt; monitor: Pt; height: number } | null {
  const [fx, fz] = forward(facing);
  for (const p of props) {
    const spec = p.type in KIT_ITEMS ? KIT_ITEMS[p.type as keyof typeof KIT_ITEMS] : null;
    if (!spec?.surface) continue;
    const item = { kind: p.type as keyof typeof KIT_ITEMS, position: p.pos, rotation: p.facing };
    let enter = -1;
    let exit = -1;
    for (let d = 0.1; d <= 1.6; d += 0.05) {
      const inside = insideItem(item, seat[0] + fx * d, seat[1] + fz * d);
      if (inside && enter < 0) enter = d;
      if (!inside && enter >= 0) {
        exit = d;
        break;
      }
    }
    if (enter < 0 || enter > 0.9) continue;
    if (exit < 0) exit = Math.min(1.6, enter + spec.size[1]);
    const depth = exit - enter;
    const m = enter + Math.min(depth - 0.08, Math.max(0.3, depth * 0.62));
    const w = enter + Math.min(0.22, depth * 0.35);
    return { work: [round(seat[0] + fx * w), round(seat[1] + fz * w)], monitor: [round(seat[0] + fx * m), round(seat[1] + fz * m)], height: spec.height };
  }
  return null;
}

function roomsFromZones(seatMap: SeatMap, floorOf: (id: string) => Room['floor']): Room[] {
  return seatMap.zones.map((z) => ({ id: z.id, type: ZONE_ROOM_TYPE[z.kind], name: z.name, floor: floorOf(z.id), outline: z.polygon.map(([x, zz]) => [round(x), round(zz)] as Pt) }));
}

/** Free point with the most clearance inside an area (Lead Hub when the plan has none). */
function openSpot(area: Pt[], blockers: { obstacles: Obstacle[]; walls: Wall[]; seats: Pt[] }, fallback: Pt): { pos: Pt; clearance: number } {
  const obs = blockers.obstacles.map(toObstacle);
  const segs = wallSolids(blockers.walls);
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of area) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  let best: { pos: Pt; clearance: number } = { pos: fallback, clearance: 0 };
  const step = Math.max(0.4, Math.min(1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 900)));
  for (let z = z0 + 0.8; z <= z1 - 0.8; z += step) {
    for (let x = x0 + 0.8; x <= x1 - 0.8; x += step) {
      if (!insidePolygon(x, z, area)) continue;
      let c = 3;
      for (const o of obs) c = Math.min(c, obstacleDistance(o, x, z));
      for (const [ax, az, bx, bz] of segs) c = Math.min(c, pointSegment(x, z, ax, az, bx, bz));
      for (const [sx, sz] of blockers.seats) c = Math.min(c, Math.hypot(sx - x, sz - z) - 0.3);
      if (c > best.clearance + 0.05) best = { pos: [round(x), round(z)], clearance: c };
    }
  }
  return best;
}

function hubFrom(pos: Pt, clearance: number) {
  const ringRadius = round(Math.max(0.55, Math.min(1.0, clearance * 0.7)));
  return { pos, ringRadius, platformRadius: round(ringRadius + 0.15), machineRadius: 0.42 };
}

/** Fixed isometric view like the templates; big offices may zoom in further (people stay readable). */
const camera = (fitHeight: number, span: number): FloorTemplate['camera'] => ({ yawDeg: 45, pitchDeg: 27, padding: 0.03, fitHeight, minZoom: 0.85, maxZoom: round(Math.max(3, span / 12)) });

// ---------------------------------------------------------------- layout_json

export function templateFromPlan(plan: FloorPlan, seatMap: SeatMap, meta: PublishedMeta): FloorTemplate {
  const W = plan.size.width;
  const D = plan.size.depth;
  const footprint: Pt[] = [
    [0, 0],
    [W, 0],
    [W, D],
    [0, D],
  ];
  const back = Math.max(2.4, Math.min(3, plan.wallHeight));
  const walls: Wall[] = [
    { id: 'back-north', kind: 'back', a: [0, 0], b: [W, 0], height: back, thickness: 0.24, openings: [] },
    { id: 'back-west', kind: 'back', a: [0, 0], b: [0, D], height: back, thickness: 0.24, openings: [] },
    { id: 'front-south', kind: 'front', a: [0, D], b: [W, D], height: FRONT_HEIGHT, thickness: 0.2, openings: [] },
    { id: 'front-east', kind: 'front', a: [W, 0], b: [W, D], height: FRONT_HEIGHT, thickness: 0.2, openings: [] },
  ];
  const outer = walls.slice();
  const onOuter = (p: Pt, q: Pt) => (Math.abs(p[1]) < 0.15 && Math.abs(q[1]) < 0.15) || (Math.abs(p[0]) < 0.15 && Math.abs(q[0]) < 0.15) || (Math.abs(p[1] - D) < 0.15 && Math.abs(q[1] - D) < 0.15) || (Math.abs(p[0] - W) < 0.15 && Math.abs(q[0] - W) < 0.15);

  // Inner walls from the room outlines (shared edges once; glass stays full height, solid is cut away).
  const byKey = new Map<string, Wall>();
  const roomWalls = new Map<string, Wall[]>();
  const key = (p: Pt) => `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;
  plan.rooms.forEach((r) => {
    if (r.walls === 'none') return;
    const list: Wall[] = [];
    r.polygon.forEach((p, i) => {
      const q = r.polygon[(i + 1) % r.polygon.length]!;
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.3 || onOuter(p, q)) return;
      const k = [key(p), key(q)].sort().join('|');
      let wall = byKey.get(k);
      if (!wall) {
        const glass = r.walls === 'glass';
        wall = { id: `room-${r.id}-${i}`, kind: glass ? 'glass' : 'partition', a: [round(p[0]), round(p[1])], b: [round(q[0]), round(q[1])], height: glass ? INNER_GLASS_HEIGHT : INNER_SOLID_HEIGHT, thickness: glass ? 0.06 : 0.12, openings: [] };
        byKey.set(k, wall);
        walls.push(wall);
      }
      list.push(wall);
    });
    roomWalls.set(r.id, list);
  });

  // Doors: an opening in every wall the door sits on.
  const openings: Opening[] = [];
  for (const d of plan.doors) {
    for (const w of walls) {
      const { at, dist } = projectOnWall(w, d.position);
      if (dist > 0.6) continue;
      const o = addOpening(w, at, d.width);
      if (o) openings.push(o);
    }
  }
  // A walled room without a door gets one on its longest inner wall (people must be able to walk in).
  for (const [, list] of roomWalls) {
    if (!list.length || list.some((w) => w.openings.length)) continue;
    const sorted = [...list].sort((a, b) => Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) - Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]));
    for (const w of sorted) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const o = addOpening(w, len / 2, 1);
      if (o) {
        openings.push(o);
        break;
      }
    }
  }

  // Items: module kit props and walk obstacles; the Lead Hub is a template feature of its own.
  const props: Prop[] = [];
  const obstacles: Obstacle[] = [];
  const extraSeats: Omit<Seat, 'approach'>[] = [];
  let hubItem: Pt | null = null;
  plan.items.forEach((it, i) => {
    const spec = KIT_ITEMS[it.kind];
    const pos: Pt = [round(it.position[0]), round(it.position[1])];
    if (it.kind === 'lead_hub') {
      hubItem ??= pos;
      return;
    }
    props.push({ type: it.kind, pos, facing: round(it.rotation), size: [spec.size[0], spec.height, spec.size[1]] });
    if (it.kind === 'phone_booth') {
      extraSeats.push({ id: `__booth-${i}`, kind: 'booth', room: roomAt(roomsFromPlan(plan), pos[0], pos[1]) ?? '__open', pos, facing: round(it.rotation), sit: true });
      return; // people walk into booths
    }
    if (!spec.blocks) return;
    obstacles.push(spec.shape === 'round' ? { kind: 'circle', pos, r: spec.size[0] } : { kind: 'rect', pos, size: spec.size, facing: round(it.rotation) });
  });

  // Rooms = published zones (seat tool) + plan rooms that are no zone any more (still floors and walls).
  const planFloor = (id: string) => PLAN_FLOOR[plan.rooms.find((r) => r.id === id)?.floorMaterial ?? plan.floorMaterial];
  const rooms = roomsFromZones(seatMap, planFloor);
  const zoneIds = new Set(rooms.map((r) => r.id));
  for (const r of roomsFromPlan(plan)) if (!zoneIds.has(r.id)) rooms.unshift({ ...r, id: `__room-${r.id}` });

  // Entrance: a door on the outer wall (front walls first), else a new one on the front.
  const outerOpenings = openings.filter((o) => outer.includes(o.wall));
  const pick = outerOpenings.find((o) => o.wall.kind === 'front') ?? outerOpenings[0];
  let entrance: { door: Pt; outward: Pt };
  if (pick) {
    entrance = { door: pick.centre, outward: outwardOf(pick.wall) };
  } else {
    const walled = plan.rooms.filter((r) => r.walls !== 'none');
    const blocked = (x: number, z: number) => walled.some((r) => insidePolygon(x, z, r.polygon)) || plan.items.some((it) => insideItem(it, x, z, 0.4));
    let made: Opening | null = null;
    for (const w of [walls[2]!, walls[3]!]) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const out = outwardOf(w);
      for (const f of [0.78, 0.62, 0.9, 0.45, 0.3, 0.15]) {
        const p: Pt = [w.a[0] + ((w.b[0] - w.a[0]) * f), w.a[1] + ((w.b[1] - w.a[1]) * f)];
        if (blocked(p[0] - out[0] * 0.8, p[1] - out[1] * 0.8)) continue;
        made = addOpening(w, len * f, 1.2);
        if (made) break;
      }
      if (made) break;
    }
    made ??= addOpening(walls[2]!, W * 0.75, 1.2);
    entrance = made ? { door: made.centre, outward: outwardOf(made.wall) } : { door: [W * 0.75, D], outward: [0, 1] };
  }

  // Door node pairs (inner doors; the entrance has its own nodes).
  const doorNodes: { id: string; pos: Pt; link?: string[] }[] = [];
  openings.forEach((o, k) => {
    if (outer.includes(o.wall)) return;
    const a: Pt = [o.centre[0] + o.normal[0] * DOOR_NODE, o.centre[1] + o.normal[1] * DOOR_NODE];
    const b: Pt = [o.centre[0] - o.normal[0] * DOOR_NODE, o.centre[1] - o.normal[1] * DOOR_NODE];
    if (!insidePolygon(a[0], a[1], footprint) || !insidePolygon(b[0], b[1], footprint)) return;
    doorNodes.push({ id: `door-${k}-a`, pos: a }, { id: `door-${k}-b`, pos: b, link: [`door-${k}-a`] });
  });

  const seatPts: Pt[] = seatMap.seats.map((s) => [s.position[0], s.position[2]]);
  let hub;
  if (hubItem) hub = hubFrom(hubItem, 1.3);
  else {
    const work = [...plan.rooms].filter((r) => r.kind === 'work_area').sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
    const area = work?.polygon ?? footprint;
    const spot = openSpot(area, { obstacles, walls, seats: seatPts }, polygonCentroid(area));
    hub = hubFrom(spot.pos, spot.clearance);
  }
  obstacles.push({ kind: 'circle', pos: hub.pos, r: hub.machineRadius });
  props.push({ type: 'lead_hub', pos: hub.pos, facing: 0 });

  // Standing homes for people without a seat: the pantry or lounge, else near the hub.
  const standing: Omit<Spot, 'approach'>[] = [];
  const obs = obstacles.map(toObstacle);
  const segs = wallSolids(walls);
  for (const r of plan.rooms.filter((x) => x.kind === 'pantry_lounge')) {
    const [cx, cz] = polygonCentroid(r.polygon);
    for (let z = Math.min(...r.polygon.map((p) => p[1])) + 0.6; z < Math.max(...r.polygon.map((p) => p[1])) - 0.5; z += 0.9) {
      for (let x = Math.min(...r.polygon.map((p) => p[0])) + 0.6; x < Math.max(...r.polygon.map((p) => p[0])) - 0.5; x += 0.9) {
        if (standing.length >= 24 || !insidePolygon(x, z, r.polygon)) continue;
        if (obs.some((o) => obstacleDistance(o, x, z) < 0.45) || segs.some(([ax, az, bx, bz]) => pointSegment(x, z, ax, az, bx, bz) < 0.5)) continue;
        if (seatPts.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 0.6)) continue;
        standing.push({ id: `__stand-${standing.length}`, pos: [round(x), round(z)], facing: round(Math.atan2(cx - x, cz - z) * DEG), sit: false });
      }
    }
  }

  const lamps = lampsFor(rooms.filter((r) => r.id !== '__open'), props);

  return finish({
    schemaVersion: 1,
    id: templateFor(seatMap.seats.length),
    name: plan.name,
    capacity: seatMap.seats.length,
    units: 'm',
    bounds: { min: [0, 0], max: [W, D] },
    footprint,
    wallHeights: { back, front: FRONT_HEIGHT },
    walls,
    rooms,
    props,
    lamps,
    obstacles,
    camera: camera(back, Math.max(W, D)),
    lighting: { eveningExposure: 1 },
    custom: { key: meta.key, floorId: meta.floorId, version: meta.version, format: 'layout_json', floorMaterial: plan.floorMaterial },
    seatMap,
    doorNodes,
    entrance,
    hub,
    extraSeats,
    standing,
    monitors: true,
  });
}

function roomsFromPlan(plan: FloorPlan): Room[] {
  return plan.rooms.map((r) => ({ id: r.id, type: ZONE_ROOM_TYPE[r.kind], name: r.name, floor: PLAN_FLOOR[r.floorMaterial ?? plan.floorMaterial], outline: r.polygon.map(([x, z]) => [round(x), round(z)] as Pt) }));
}

function outwardOf(wall: Wall): Pt {
  if (wall.id === 'back-north') return [0, -1];
  if (wall.id === 'back-west') return [-1, 0];
  if (wall.id === 'front-east') return [1, 0];
  return [0, 1];
}

export function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j]![0] * poly[i]![1] - poly[i]![0] * poly[j]![1];
  return Math.abs(a) / 2;
}

/** Pendant lamps over each room and floor lamps by the sofas (Evening light pools and glows). */
function lampsFor(rooms: Room[], props: Prop[]): FloorTemplate['lamps'] {
  const lamps: FloorTemplate['lamps'] = [];
  const ranked = [...rooms].sort((a, b) => polygonArea(b.outline) - polygonArea(a.outline)).slice(0, 10);
  for (const r of ranked) {
    const [cx, cz] = polygonCentroid(r.outline);
    lamps.push({ pos: [round(cx), 2.4, round(cz)], kind: 'pendant', room: r.id });
  }
  for (const p of props.filter((x) => x.type === 'sofa').slice(0, 4)) {
    const [fx, fz] = forward(p.facing);
    lamps.push({ pos: [round(p.pos[0] - fx * 0.3 + fz * 1.2), 1.5, round(p.pos[1] - fz * 0.3 - fx * 1.2)], kind: 'floor', room: roomAt(rooms, p.pos[0], p.pos[1]) ?? rooms[0]?.id ?? '__open' });
  }
  return lamps;
}

// ---------------------------------------------------------------- GLB / zipped glTF

export function templateFromModel(seatMap: SeatMap, meta: PublishedMeta & { format: 'glb' | 'gltf_zip' }): FloorTemplate {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const grow = (x: number, z: number) => {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  };
  for (const z of seatMap.zones) for (const [x, zz] of z.polygon) grow(x, zz);
  for (const s of seatMap.seats) grow(s.position[0], s.position[2]);
  x0 = round(x0 - 0.6);
  z0 = round(z0 - 0.6);
  x1 = round(Math.max(x1 + 0.6, x0 + 4));
  z1 = round(Math.max(z1 + 0.6, z0 + 4));
  const footprint: Pt[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const rooms = roomsFromZones(seatMap, () => 'oak');
  const seatPts: Pt[] = seatMap.seats.map((s) => [s.position[0], s.position[2]]);
  const work = [...seatMap.zones].filter((z) => z.kind === 'work_area').sort((a, b) => polygonArea(b.polygon) - polygonArea(a.polygon))[0];
  const area = work?.polygon ?? footprint;
  const spot = openSpot(area, { obstacles: [], walls: [], seats: seatPts }, polygonCentroid(area));
  const hub = hubFrom(spot.pos, Math.min(spot.clearance, 1.2));
  const scale = seatMap.scale;
  return finish({
    schemaVersion: 1,
    id: templateFor(seatMap.seats.length),
    name: 'Office',
    capacity: seatMap.seats.length,
    units: 'm',
    bounds: { min: [x0, z0], max: [x1, z1] },
    footprint,
    wallHeights: { back: 2.5, front: FRONT_HEIGHT },
    walls: [],
    rooms,
    props: [{ type: 'lead_hub', pos: hub.pos, facing: 0 }],
    lamps: lampsFor(rooms, []),
    obstacles: [{ kind: 'circle', pos: hub.pos, r: hub.machineRadius }],
    camera: camera(2.5, Math.max(x1 - x0, z1 - z0)),
    lighting: { eveningExposure: 1 },
    custom: { key: meta.key, floorId: meta.floorId, version: meta.version, format: meta.format, model: { scale, origin: seatMap.origin } },
    seatMap,
    doorNodes: [],
    entrance: { door: [round(x1 - Math.min(1.6, (x1 - x0) / 4)), z1], outward: [0, 1] },
    hub,
    extraSeats: [],
    standing: [],
    monitors: false,
  });
}
