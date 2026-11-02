// Team Floor module kit (D-054): reusable office modules for the floor templates. Small and Large
// are composed from these; the 28.3 multi-map kit extends the same functions and catalogue.
//
// A module is authored in local metres and placed with `{ at: [x, z], rot }`. `rot` (0, 90, 180,
// 270) turns the module like a heading: local +z points along heading `rot` (0 = +z, 90 = +x).
// Every placement is recorded in the template JSON (`modules`: kind, params, at, rot, size, seat ids)
// so layouts can be regenerated or extended from data.
//
// Coordinates follow the templates: x = east, z = south, `facing` = heading in degrees,
// forward = (sin, cos). The camera looks from +x +z, so north (z = 0) and west (x = 0) walls are the
// tall back walls.

export const r2 = (v) => Math.round(v * 100) / 100;
export const deg = (d) => ((d % 360) + 360) % 360;
export const fwd = (facing) => [Math.sin((facing * Math.PI) / 180), Math.cos((facing * Math.PI) / 180)];

export const BOOTH_W = 2.07;
export const LOUNGE_SIZE = [5.1, 6.2];

/** Catalogue written to templates/modules.json (documentation for the 28.3 kit). */
export const MODULE_KIT = {
  sales_pod: {
    description: 'Back-to-back desks, one person per desk, low divider, downlight. Origin: pod centre; rows face north and south.',
    params: { desks: { options: [4, 6], default: 6 }, pitch: { default: 1.6 } },
    footprint: { desks4: [3.2, 2.6], desks6: [4.8, 2.6], clearance: 'aisle nodes 1.85 m from the centre line' },
    seats: { desk: 'desks' },
  },
  calling_room: {
    description: 'Glass calling room with N booths along the north wall (acoustic panels, partitions, door in the south glass). Origin: north-west corner.',
    params: { booths: { default: 3 }, depth: { default: 4.3 }, west: { default: true }, east: { default: false }, door: { default: [0.25, 1.15] } },
    footprint: { width: `booths x ${BOOTH_W}`, depth: 4.3 },
    seats: { booth: 'booths' },
  },
  manager_cabin: {
    description: 'Walnut cabin: desk, executive chair, visitor chairs, bookshelf, credenza, lamps; glass and walnut walls, solid partition left of the door. Origin: north-west corner.',
    params: { w: { default: 6.0 }, d: { default: 4.8 }, west: { default: true }, door: { default: 'w*0.45 .. +1.0' } },
    footprint: { width: 'w (>= 4.5)', depth: 'd' },
    seats: { cabin: 1 },
  },
  lounge: {
    description: 'Lounge under a west window: green sofa (3), armchair, rug, coffee table, bookshelf, plants, downlight. Origin: north-west corner, west wall at x = 0.',
    params: { north: { default: true, note: 'adds the north wall sconce' } },
    footprint: LOUNGE_SIZE,
    seats: { lounge: 4 },
  },
  reception: {
    description: 'Marble and walnut counter with a glowing blue base edge, receptionist seat, plant. Origin: counter centre, front facing the entrance (+z).',
    params: {},
    footprint: [4.6, 2.6],
    seats: { reception: 1 },
  },
  hub_plaza: {
    description: 'Lead Hub machine on a light platform with a glowing ring, 8 graph nodes and 3 standing spots around it. Origin: hub centre.',
    params: { ring: { default: 1.55 }, platform: { default: 1.7 }, machine: { default: 0.72 } },
    footprint: { radius: 'platform + 0.5' },
    seats: {},
  },
  print_corner: {
    description: 'Whiteboard with sticky notes and a printer on a low cabinet, against a wall or partition. Origin: west end of the wall face; props stand at +z.',
    params: {},
    footprint: [3.9, 1.0],
    seats: {},
  },
  hot_bench: {
    description: 'Hot-desk bench along a wall: people at local +x face the wall (heading 270), monitors face the room. Origin: bench centre.',
    params: { seats: { default: 3 }, aisle: { default: 1.83 } },
    footprint: { width: 0.75, length: 'seats x 0.8 + 0.3' },
    seats: { hot_desk: 'seats' },
  },
};

export function createPlan() {
  return { walls: [], rooms: [], seats: [], standing: [], props: [], obstacles: [], waypoints: [], lamps: [], modules: [], hub: null };
}

/** Emitters in a module's local frame (placed at `at`, turned by `rot`). */
export function scope(plan, at = [0, 0], rot = 0) {
  const a = (rot * Math.PI) / 180;
  const ca = Math.round(Math.cos(a) * 1e9) / 1e9;
  const sa = Math.round(Math.sin(a) * 1e9) / 1e9;
  const P = (x, z) => [r2(at[0] + x * ca + z * sa), r2(at[1] - x * sa + z * ca)];
  const F = (f) => deg(f + rot);
  return {
    plan,
    P,
    F,
    prop(type, x, z, facing = 0, extra = {}) {
      const p = { type, pos: P(x, z), facing: F(facing), ...extra };
      plan.props.push(p);
      return p;
    },
    seat(s) {
      const out = { ...s, pos: P(...s.pos), facing: F(s.facing) };
      if (s.work) out.work = P(...s.work);
      if (s.callFacing !== undefined) out.callFacing = F(s.callFacing);
      plan.seats.push(out);
      return out;
    },
    spot(id, x, z, facing) {
      plan.standing.push({ id, pos: P(x, z), facing: F(facing), sit: false });
    },
    block(x, z, w, d, facing = 0, pad = 0) {
      const [cx, cz] = P(x, z);
      plan.obstacles.push({ kind: 'rect', cx, cz, w: w + pad * 2, d: d + pad * 2, facing: F(facing) });
    },
    circle(x, z, r) {
      const [cx, cz] = P(x, z);
      plan.obstacles.push({ kind: 'circle', cx, cz, r });
    },
    wp(id, x, z) {
      const [wx, wz] = P(x, z);
      plan.waypoints.push([id, wx, wz]);
    },
    lamp(kind, x, y, z, room) {
      const [wx, wz] = P(x, z);
      plan.lamps.push({ pos: [wx, y, wz], kind, room });
    },
    wall(w) {
      plan.walls.push({ openings: [], ...w, a: P(...w.a), b: P(...w.b) });
    },
    room(r) {
      plan.rooms.push({ ...r, outline: r.outline.map(([x, z]) => P(x, z)) });
    },
  };
}

const rect = (x0, z0, x1, z1) => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

const BUILDERS = { sales_pod: salesPod, calling_room: callingRoom, manager_cabin: managerCabin, lounge, reception, hub_plaza: hubPlaza, print_corner: printCorner, hot_bench: hotBench };

/** Places one module and records it in `plan.modules`. Returns the module's result (seat ids, size). */
export function place(plan, kind, id, at, rot = 0, params = {}) {
  const build = BUILDERS[kind];
  if (!build) throw new Error(`unknown module kind ${kind}`);
  const res = build(scope(plan, at, rot), id, params);
  plan.modules.push({ id, kind, params, at: [r2(at[0]), r2(at[1])], rot, size: res.size.map(r2), seats: res.seats ?? [] });
  return res;
}

// ---------------------------------------------------------------- modules

function salesPod(S, id, { desks = 6, pitch = 1.6, room = 'sales', lamp = true } = {}) {
  const cols = desks / 2;
  const W = cols * pitch;
  const seats = [];
  const rows = [
    [0, 0, -0.35],
    [1, 180, 0.35],
  ];
  for (const [row, facing, dz] of rows) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * pitch;
      const sid = `${id}-${row * cols + c + 1}`;
      const [fx, fz] = fwd(facing);
      const cx = x - fx * 0.62;
      const cz = dz - fz * 0.62;
      S.seat({ id: sid, kind: 'desk', room, pos: [cx, cz], facing, sit: true, work: [x, dz], screen: sid });
      seats.push(sid);
      S.prop('desk_white', x, dz, facing + 180, { seat: sid, variant: (c + row) % 2 ? 'right' : 'left' });
      S.prop('chair_office', cx, cz, facing, { seat: sid });
      S.prop('monitor', x + fx * 0.16, dz + fz * 0.16, facing + 180, { seat: sid, y: 0.75, screen: sid });
      if ((c + row) % 2 === 0) S.prop('plant_desk', x + 0.52 + fx * 0.12, dz + fz * 0.12, 0, { y: 0.75, variant: c % 2 ? 'snake' : 'succulent' });
      else S.prop('desk_mug', x - 0.5 - fx * 0.1, dz - fz * 0.1, 0, { y: 0.75 });
    }
  }
  S.prop('pod_divider', 0, 0, 0, { y: 0.75, size: [r2(W - 0.12), 0.36, 0.03] });
  S.block(0, 0, W - pitch + 1.4, 1.4, 0, 0.05);
  const xs = [-W / 2 - 0.45, ...Array.from({ length: cols }, (_, c) => (c - (cols - 1) / 2) * pitch), W / 2 + 0.45];
  xs.forEach((x, k) => {
    S.wp(`${id}-n${k}`, x, -1.85);
    S.wp(`${id}-s${k}`, x, 1.85);
  });
  // Downlights for the Evening bake: one per 4-desk pod, two over a 6-desk pod.
  if (lamp) for (const x of cols > 2 ? [-W / 4, W / 4] : [0]) S.lamp('pendant', x, 2.4, 0, room);
  return { seats, size: [W, 2.6] };
}

function callingRoom(S, id, { booths = 3, depth = 4.3, west = true, east = false, door = [0.25, 1.15] } = {}) {
  const W = booths * BOOTH_W;
  S.room({ id, type: 'calling_room', name: 'Calling room', floor: 'carpet', outline: rect(0, 0, W, depth) });
  if (west) S.wall({ id: `${id}-west`, kind: 'glass', a: [0, 0], b: [0, depth], height: 2.3, thickness: 0.06 });
  S.wall({ id: `${id}-south`, kind: 'glass', a: [0, depth], b: [W, depth], height: 2.3, thickness: 0.06, openings: [{ kind: 'door', from: door[0], to: door[1] }] });
  if (east) S.wall({ id: `${id}-east`, kind: 'glass', a: [W, 0], b: [W, depth], height: 2.3, thickness: 0.06 });
  const seats = [];
  for (let i = 0; i < booths; i++) {
    const cx = BOOTH_W * (i + 0.5);
    const sid = `${id}-${i + 1}`;
    S.seat({ id: sid, kind: 'booth', room: id, pos: [cx, 1.15], facing: 180, sit: true, work: [cx, 0.55], screen: sid, callFacing: 120 });
    seats.push(sid);
    S.prop('desk_booth', cx, 0.55, 0, { seat: sid });
    S.prop('chair_office', cx, 1.15, 180, { seat: sid });
    S.prop('monitor', cx, 0.36, 0, { seat: sid, y: 0.75, screen: sid });
    S.prop('acoustic_panel', cx, 0.13, 0, { y: 1.05, size: [1.3, 0.9, 0.04] });
    S.block(cx, 0.55, 1.3, 0.6);
    if (i > 0) {
      const px = BOOTH_W * i;
      S.prop('booth_partition', px, 1.2, 90, { size: [2.4, 1.5, 0.05] });
      S.block(px, 1.2, 0.1, 2.4);
    }
    S.wp(`${id}-b${i}`, cx, 2.9);
  }
  S.prop('plant_tall', W - 0.45, depth - 0.45, 0, { variant: 'fiddle' });
  S.circle(W - 0.45, depth - 0.45, 0.35);
  const doorC = (door[0] + door[1]) / 2;
  S.wp(`${id}-in`, doorC, depth - 0.75);
  S.wp(`${id}-out`, doorC, depth + 0.55);
  S.spot(`${id}-wait`, Math.min(W - 1, 3.5), depth + 0.6, 20);
  for (let k = 0; k < Math.max(1, Math.round(booths / 3)); k++) S.lamp('pendant', ((k + 0.5) * W) / Math.max(1, Math.round(booths / 3)), 2.3, 2.2, id);
  return { seats, size: [W, depth] };
}

function managerCabin(S, id, { w = 6.0, d = 4.8, west = true, north = true, door = null, name = 'Manager cabin' } = {}) {
  const [d0, d1] = door ?? [r2(w * 0.45), r2(w * 0.45 + 1.0)];
  S.room({ id, type: 'manager_cabin', name, floor: 'walnut', outline: rect(0, 0, w, d) });
  if (west) S.wall({ id: `${id}-west`, kind: 'glass_walnut', a: [0, 0], b: [0, d], height: 2.3, thickness: 0.12 });
  S.wall({ id: `${id}-south-solid`, kind: 'partition', a: [0, d], b: [d0, d], height: 2.1, thickness: 0.14 });
  if (d1 < w - 0.05) S.wall({ id: `${id}-south-glass`, kind: 'glass_walnut', a: [d1, d], b: [w, d], height: 2.3, thickness: 0.12 });
  const dx = w * 0.58;
  S.seat({ id, kind: 'cabin', room: id, pos: [dx, 1.63], facing: 0, sit: true, work: [dx, 2.25], screen: id });
  S.prop('desk_walnut', dx, 2.25, 180, { seat: id });
  S.prop('chair_exec', dx, 1.63, 0, { seat: id });
  S.prop('monitor', dx - 0.45, 2.15, 180, { seat: id, y: 0.76, screen: id });
  S.prop('desk_lamp', dx + 0.75, 2.4, 200, { y: 0.76 });
  S.prop('chair_visitor', dx - 0.5, 3.2, 180);
  S.prop('chair_visitor', dx + 0.55, 3.2, 180);
  S.prop('bookshelf_walnut', 1.45, 0.3, 0, { size: [1.7, 2.1, 0.4] });
  S.prop('credenza_walnut', w - 0.85, 0.33, 0, { size: [1.4, 0.75, 0.45] });
  S.prop('printer_small', w - 0.6, 0.33, 0, { y: 0.75 });
  S.prop('art_frame', dx - 0.6, 0.13, 0, { y: 1.65, size: [0.9, 0.7, 0.03], variant: 'abstract-warm' });
  const doorC = (d0 + d1) / 2;
  const lampAt = doorC > w - 1.8 ? [0.45, 1.25] : [w - 0.55, d - 0.75];
  S.prop('floor_lamp', ...lampAt, 0);
  S.prop('plant_medium', 0.55, d - 0.6, 0, { variant: 'monstera' });
  S.block(dx, 2.25, 1.8, 0.8);
  S.block(1.45, 0.3, 1.7, 0.4);
  S.block(w - 0.85, 0.33, 1.4, 0.45);
  S.block(dx - 0.5, 3.2, 0.5, 0.5);
  S.block(dx + 0.55, 3.2, 0.5, 0.5);
  S.circle(...lampAt, 0.25);
  S.circle(0.55, d - 0.6, 0.35);
  S.wp(`${id}-out`, doorC, d + 0.6);
  S.wp(`${id}-in`, doorC, d - 0.55);
  S.wp(`${id}-e`, dx + 1.45, 3.9);
  S.wp(`${id}-ne`, dx + 1.45, 1.45);
  S.wp(`${id}-w`, Math.min(2.1, dx - 1.15), 3.85);
  S.lamp('floor', lampAt[0], 1.6, lampAt[1], id);
  S.lamp('desk', dx + 0.75, 1.05, 2.4, id);
  if (north) {
    S.prop('sconce', 0.6, 0.13, 0, { y: 1.72, wall: 'back-north' });
    S.prop('sconce', dx + 0.4, 0.13, 0, { y: 1.72, wall: 'back-north' });
  }
  return { seats: [id], size: [w, d] };
}

function lounge(S, id, { north = true, name = 'Lounge' } = {}) {
  const [W, D] = LOUNGE_SIZE;
  S.room({ id, type: 'lounge', name, floor: 'oak', outline: rect(0, 0, W, D) });
  const seats = [];
  [2.25, 3.0, 3.75].forEach((z, i) => {
    S.seat({ id: `${id}-${i + 1}`, kind: 'lounge', room: id, pos: [0.78, z], facing: 90, sit: true });
    seats.push(`${id}-${i + 1}`);
  });
  S.seat({ id: `${id}-4`, kind: 'lounge', room: id, pos: [3.55, 3.0], facing: 270, sit: true });
  seats.push(`${id}-4`);
  S.prop('rug', 2.2, 3.0, 90, { size: [3.6, 0.012, 2.9], variant: 'grey' });
  S.prop('sofa_green', 0.6, 3.0, 90, { size: [2.5, 0.85, 0.95] });
  S.prop('armchair_green', 3.6, 3.0, 270, { size: [0.9, 0.85, 0.85] });
  S.prop('coffee_table', 2.15, 3.0, 90, { size: [1.15, 0.42, 0.62] });
  S.prop('bookshelf_white', 3.95, 0.3, 0, { size: [1.5, 1.9, 0.38] });
  S.prop('plant_tall', 0.5, 0.5, 0, { variant: 'palm' });
  S.prop('plant_medium', 0.5, 5.1, 0, { variant: 'monstera' });
  S.prop('plant_floor_small', 2.2, 0.35, 0, { variant: 'round' });
  S.prop('art_frame', 0.13, 5.6, 90, { y: 1.45, size: [0.55, 0.7, 0.03], variant: 'abstract-cool' });
  S.block(0.6, 3.0, 0.95, 2.5);
  S.block(3.6, 3.0, 0.85, 0.9);
  S.block(2.15, 3.0, 0.62, 1.15);
  S.block(3.95, 0.3, 1.5, 0.38);
  S.circle(0.5, 0.5, 0.45);
  S.circle(0.5, 5.1, 0.38);
  S.circle(2.2, 0.35, 0.25);
  S.wp(`${id}-n`, 2.82, 1.3);
  S.wp(`${id}-s`, 2.82, 4.85);
  S.spot(`${id}-stand`, 2.7, 4.65, 45);
  S.spot(`${id}-books`, 3.9, 1.05, 180);
  S.lamp('pendant', 2.2, 2.4, 3.0, id);
  S.prop('sconce', 0.13, 0.55, 90, { y: 1.72, wall: 'back-west' });
  if (north) S.prop('sconce', 4.6, 0.13, 0, { y: 1.72, wall: 'back-north' });
  return { seats, size: [W, D] };
}

function reception(S, id, { plant = true } = {}) {
  S.seat({ id, kind: 'reception', room: id, pos: [0, -0.7], facing: 0, sit: true, work: [0, 0], screen: id });
  S.prop('reception_counter', 0, 0, 0, { size: [2.2, 1.05, 0.75] });
  S.prop('chair_office', 0, -0.7, 0, { seat: id });
  S.prop('monitor', -0.35, -0.17, 180, { seat: id, y: 0.75, screen: id, variant: 'small' });
  S.block(0, 0, 2.2, 0.75, 0, 0.05);
  if (plant) {
    S.prop('plant_medium', 2.05, 1.13, 0, { variant: 'bush' });
    S.circle(2.05, 1.13, 0.28);
  }
  S.wp(`${id}-w`, -1.65, 0.8);
  S.wp(`${id}-e`, 1.6, 0.75);
  S.wp(`${id}-back`, 1.65, -0.85);
  S.spot(`${id}-stand`, -1.7, 0.35, 90);
  S.lamp('pendant', 0, 2.2, -0.25, id);
  return { seats: [id], size: [4.6, 2.6] };
}

function hubPlaza(S, id, { ring = 1.55, platform = 1.7, machine = 0.72 } = {}) {
  S.prop('hub', 0, 0, 45, { size: [r2(machine * 2), 1.3, r2(machine * 2)] });
  S.prop('hub_ring', 0, 0, 0, { size: [r2(ring * 2), 0.02, r2(ring * 2)] });
  S.circle(0, 0, machine + 0.25);
  const R = platform + 0.5;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    S.wp(`${id}-${k}`, Math.sin(a) * R, Math.cos(a) * R);
  }
  // Standing spots west, east and south of the hub, facing it.
  for (const [k, a] of [
    ['w', 270],
    ['e', 90],
    ['s', 0],
  ]) {
    const [fx, fz] = fwd(a);
    S.spot(`${id}-stand-${k}`, fx * (platform + 0.6), fz * (platform + 0.6), a + 180);
  }
  const [x, z] = S.P(0, 0);
  S.plan.hub = { pos: [x, z], ringRadius: ring, platformRadius: platform, machineRadius: machine };
  return { seats: [], size: [R * 2, R * 2] };
}

function printCorner(S, id) {
  S.prop('whiteboard', 1.1, 0.09, 0, { y: 0.85, size: [2.0, 1.05, 0.04] });
  S.prop('cabinet_low', 3.3, 0.32, 0, { size: [1.2, 0.72, 0.5] });
  S.prop('printer', 3.3, 0.32, 0, { y: 0.72 });
  S.block(3.3, 0.32, 1.2, 0.5);
  S.spot(`${id}-board`, 1.1, 0.95, 180);
  S.spot(`${id}-printer`, 3.3, 1.0, 160);
  return { seats: [], size: [3.9, 1.0] };
}

function hotBench(S, id, { seats = 3, aisle = 1.83, room = 'sales' } = {}) {
  const len = seats * 0.8 + 0.3;
  S.prop('bench_desk', 0, 0, 90, { size: [r2(len), 0.75, 0.75] });
  S.block(0, 0, 0.75, len);
  const ids = [];
  for (let k = 0; k < seats; k++) {
    const z = (k - (seats - 1) / 2) * 0.8;
    const sid = `${id}-${k + 1}`;
    S.seat({ id: sid, kind: 'hot_desk', room, pos: [0.64, z], facing: 270, sit: true, work: [0, z], screen: sid });
    S.prop('chair_office', 0.64, z, 270, { seat: sid });
    S.prop('monitor', -0.16, z, 90, { seat: sid, y: 0.75, screen: sid, variant: 'small' });
    ids.push(sid);
  }
  S.wp(`${id}-wp`, aisle, 0);
  return { seats: ids, size: [0.75, len] };
}

// ---------------------------------------------------------------- shell helpers

/** Back wall (tall, inner face visible) with windows and inner finishes. */
export function backWall(id, a, b, { windows = [], finish = null, height = 2.5 } = {}) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    id,
    kind: 'back',
    a,
    b,
    height,
    thickness: 0.24,
    openings: windows.map(([from, to, sill = 1.0, head = 2.15]) => ({ kind: 'window', from, to, sill, head })),
    finish: finish ?? [{ from: 0, to: r2(len), inner: 'paint' }],
  };
}

/** Front wall (low, outer face visible) with an optional door. */
export function frontWall(id, a, b, { door = null, height = 1.05 } = {}) {
  return { id, kind: 'front', a, b, height, thickness: 0.2, openings: door ? [{ kind: 'door', from: door[0], to: door[1] }] : [] };
}

/**
 * Sales floor outline = footprint minus the other rooms (all axis-aligned): grid cells, boundary
 * edges, one chained loop, collinear points removed.
 */
export function remainderOutline(footprint, rooms) {
  const xs = [...new Set([...footprint.map((p) => p[0]), ...rooms.flatMap((r) => r.outline.map((p) => p[0]))])].sort((a, b) => a - b);
  const zs = [...new Set([...footprint.map((p) => p[1]), ...rooms.flatMap((r) => r.outline.map((p) => p[1]))])].sort((a, b) => a - b);
  const inPoly = (x, z, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const filled = (i, j) => {
    if (i < 0 || j < 0 || i >= xs.length - 1 || j >= zs.length - 1) return false;
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cz = (zs[j] + zs[j + 1]) / 2;
    return inPoly(cx, cz, footprint) && !rooms.some((r) => inPoly(cx, cz, r.outline));
  };
  const next = new Map();
  const key = (p) => `${p[0]},${p[1]}`;
  const edge = (p, q) => next.set(key(p), q);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      if (!filled(i, j)) continue;
      const [x0, x1, z0, z1] = [xs[i], xs[i + 1], zs[j], zs[j + 1]];
      if (!filled(i, j - 1)) edge([x0, z0], [x1, z0]);
      if (!filled(i + 1, j)) edge([x1, z0], [x1, z1]);
      if (!filled(i, j + 1)) edge([x1, z1], [x0, z1]);
      if (!filled(i - 1, j)) edge([x0, z1], [x0, z0]);
    }
  }
  const start = [...next.keys()][0];
  if (!start) return [];
  const loop = [];
  let cur = start.split(',').map(Number);
  for (let guard = 0; guard < 10000; guard++) {
    loop.push(cur);
    const n = next.get(key(cur));
    next.delete(key(cur));
    if (!n || key(n) === start) break;
    cur = n;
  }
  // Drop collinear points.
  const out = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[(i - 1 + loop.length) % loop.length];
    const c = loop[i];
    const n = loop[(i + 1) % loop.length];
    if ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) !== 0) out.push([r2(c[0]), r2(c[1])]);
  }
  return out;
}
