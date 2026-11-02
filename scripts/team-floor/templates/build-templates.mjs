#!/usr/bin/env node
// Team Floor templates (SPEC 12.1 item 4): generates apps/web/public/team-floor/templates/<id>.json.
// The JSON is the single source of truth for the office: the Blender build script (build_office.py)
// reads it to author geometry, and the web runtime validates it with zod (state/template.ts).
//
// Usage: node scripts/team-floor/templates/build-templates.mjs [--svg]
//   --svg  also writes scripts/team-floor/.out/<id>-plan.svg (top-down preview of rooms, props, graph)
//
// Coordinates: metres. x = east (screen down-right), z = south (screen down-left), y = up.
// The camera looks from +x +z, so walls on z=0 and x=0 are the tall back walls.
// `facing` is a heading in degrees: 0 = +z, 90 = +x, 180 = -z, 270 = -x (forward = (sin, cos)).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const outDir = join(repo, 'apps/web/public/team-floor/templates');
const previewDir = join(repo, 'scripts/team-floor/.out');

const r2 = (v) => Math.round(v * 100) / 100;
const deg = (d) => ((d % 360) + 360) % 360;
const fwd = (facing) => [Math.sin((facing * Math.PI) / 180), Math.cos((facing * Math.PI) / 180)];

// ---------------------------------------------------------------- Medium (reference composition)

function medium() {
  const W = 18;
  const D = 13;
  const NOTCH = { x: 4.5, z: 9.5 }; // L-shape: the south-west corner (x < 4.5, z > 9.5) is outside.
  const BACK_H = 2.8;
  const FRONT_H = 1.05;

  const footprint = [
    [0, 0],
    [W, 0],
    [W, D],
    [NOTCH.x, D],
    [NOTCH.x, NOTCH.z],
    [0, NOTCH.z],
  ];

  // Room boundaries.
  const CALL = { x0: 5.1, x1: 11.3, z1: 4.3 };
  const CABIN = { x0: 11.3, x1: W, z1: 5.0 };
  const LOUNGE = { x1: CALL.x0, z1: 6.2 };
  const RECEPTION = { x0: 13.4, z0: 10.4 };
  const PRINT = { x0: 16.2, z1: 6.7 };
  const DOOR = { x0: 14.8, x1: 16.4 }; // entrance in the south wall
  const CALL_DOOR = { x0: 5.35, x1: 6.25 };
  const CABIN_DOOR = { x0: 14.3, x1: 15.3 };

  const walls = [
    // Back walls (tall, inner face visible): wainscot + paint + trim.
    {
      id: 'back-north',
      kind: 'back',
      a: [0, 0],
      b: [W, 0],
      height: BACK_H,
      thickness: 0.24,
      openings: [
        { kind: 'window', from: 16.0, to: 17.6, sill: 1.0, head: 2.3 },
      ],
      finish: [
        { from: 0, to: CALL.x0, inner: 'paint' },
        { from: CALL.x0, to: CALL.x1, inner: 'acoustic' },
        { from: CALL.x1, to: W, inner: 'walnut' },
      ],
    },
    {
      id: 'back-west',
      kind: 'back',
      a: [0, 0],
      b: [0, NOTCH.z],
      height: BACK_H,
      thickness: 0.24,
      openings: [{ kind: 'window', from: 1.3, to: 4.7, sill: 0.95, head: 2.35 }],
      finish: [{ from: 0, to: NOTCH.z, inner: 'paint' }],
    },
    {
      id: 'back-notch',
      kind: 'back',
      a: [NOTCH.x, NOTCH.z],
      b: [NOTCH.x, D],
      height: BACK_H,
      thickness: 0.24,
      openings: [],
      finish: [{ from: 0, to: D - NOTCH.z, inner: 'paint' }],
    },
    // Front walls (low, outer face visible): dark slate with a light cap and outdoor sconces.
    { id: 'front-notch', kind: 'front', a: [0, NOTCH.z], b: [NOTCH.x, NOTCH.z], height: FRONT_H, thickness: 0.2, openings: [] },
    {
      id: 'front-south',
      kind: 'front',
      a: [NOTCH.x, D],
      b: [W, D],
      height: FRONT_H,
      thickness: 0.2,
      openings: [{ kind: 'door', from: DOOR.x0 - NOTCH.x, to: DOOR.x1 - NOTCH.x }],
    },
    { id: 'front-east', kind: 'front', a: [W, 0], b: [W, D], height: FRONT_H, thickness: 0.2, openings: [] },
    // Calling room: glass on aluminium frames.
    { id: 'call-west', kind: 'glass', a: [CALL.x0, 0], b: [CALL.x0, CALL.z1], height: 2.3, thickness: 0.06, openings: [] },
    {
      id: 'call-south',
      kind: 'glass',
      a: [CALL.x0, CALL.z1],
      b: [CALL.x1, CALL.z1],
      height: 2.3,
      thickness: 0.06,
      openings: [{ kind: 'door', from: CALL_DOOR.x0 - CALL.x0, to: CALL_DOOR.x1 - CALL.x0 }],
    },
    // Manager cabin: walnut base with glass above towards the calling room and the floor.
    { id: 'cabin-west', kind: 'glass_walnut', a: [CABIN.x0, 0], b: [CABIN.x0, CABIN.z1], height: 2.3, thickness: 0.12, openings: [] },
    { id: 'cabin-south-solid', kind: 'partition', a: [CABIN.x0, CABIN.z1], b: [CABIN_DOOR.x0, CABIN.z1], height: 2.1, thickness: 0.14, openings: [] },
    { id: 'cabin-south-glass', kind: 'glass_walnut', a: [CABIN_DOOR.x1, CABIN.z1], b: [W, CABIN.z1], height: 2.3, thickness: 0.12, openings: [] },
  ];

  const rooms = [
    {
      id: 'lounge',
      type: 'lounge',
      name: 'Lounge',
      floor: 'oak',
      outline: [
        [0, 0],
        [LOUNGE.x1, 0],
        [LOUNGE.x1, LOUNGE.z1],
        [0, LOUNGE.z1],
      ],
    },
    {
      id: 'calling',
      type: 'calling_room',
      name: 'Calling room',
      floor: 'carpet',
      outline: [
        [CALL.x0, 0],
        [CALL.x1, 0],
        [CALL.x1, CALL.z1],
        [CALL.x0, CALL.z1],
      ],
    },
    {
      id: 'cabin',
      type: 'manager_cabin',
      name: 'Manager cabin',
      floor: 'walnut',
      outline: [
        [CABIN.x0, 0],
        [CABIN.x1, 0],
        [CABIN.x1, CABIN.z1],
        [CABIN.x0, CABIN.z1],
      ],
    },
    {
      id: 'print',
      type: 'print_corner',
      name: 'Print corner',
      floor: 'oak',
      outline: [
        [PRINT.x0, CABIN.z1],
        [W, CABIN.z1],
        [W, PRINT.z1],
        [PRINT.x0, PRINT.z1],
      ],
    },
    {
      id: 'reception',
      type: 'reception',
      name: 'Reception',
      floor: 'oak',
      outline: [
        [RECEPTION.x0, RECEPTION.z0],
        [W, RECEPTION.z0],
        [W, D],
        [RECEPTION.x0, D],
      ],
    },
    {
      id: 'sales',
      type: 'sales_floor',
      name: 'Sales floor',
      floor: 'oak',
      outline: [
        [0, LOUNGE.z1],
        [LOUNGE.x1, LOUNGE.z1],
        [LOUNGE.x1, CALL.z1],
        [CALL.x1, CALL.z1],
        [CALL.x1, CABIN.z1],
        [PRINT.x0, CABIN.z1],
        [PRINT.x0, PRINT.z1],
        [W, PRINT.z1],
        [W, RECEPTION.z0],
        [RECEPTION.x0, RECEPTION.z0],
        [RECEPTION.x0, D],
        [NOTCH.x, D],
        [NOTCH.x, NOTCH.z],
        [0, NOTCH.z],
      ],
    },
  ];

  const hub = { pos: [10.2, 8.6], ringRadius: 1.5, platformRadius: 1.65, machineRadius: 0.62 };

  const seats = [];
  const props = [];
  const obstacles = []; // walk-blocking footprints: { kind: 'rect', cx, cz, w, d, facing } | { kind: 'circle', cx, cz, r }
  const block = (cx, cz, w, d, facing = 0, pad = 0) => obstacles.push({ kind: 'rect', cx, cz, w: w + pad * 2, d: d + pad * 2, facing });
  const blockCircle = (cx, cz, r) => obstacles.push({ kind: 'circle', cx, cz, r });
  const prop = (type, x, z, facing = 0, extra = {}) => {
    const p = { type, pos: [r2(x), r2(z)], facing: deg(facing), ...extra };
    props.push(p);
    return p;
  };
  /** Point at `dist` metres in front of (x, z) for a heading. */
  const ahead = (x, z, facing, dist) => {
    const [fx, fz] = fwd(facing);
    return [x + fx * dist, z + fz * dist];
  };

  // ---- Sales desks: one person per desk, facing north (-z), screens face the camera side.
  const DESKS = [
    [6.6, 6.0],
    [9.5, 5.55],
    [14.1, 6.55],
    [6.5, 8.75],
    [14.5, 9.05],
    [7.7, 11.55],
    [11.2, 11.75],
    [16.95, 8.45],
  ];
  DESKS.forEach(([x, z], i) => {
    const id = `desk-${String(i + 1).padStart(2, '0')}`;
    const facing = 180;
    const [sx, sz] = ahead(x, z, facing, -0.82); // chair behind the desk (towards +z)
    seats.push({ id, kind: 'desk', room: 'sales', pos: [r2(sx), r2(sz)], facing, sit: true, work: [r2(x), r2(z)], screen: id });
    prop('desk_white', x, z, facing + 180, { seat: id, variant: i % 3 === 1 ? 'right' : 'left' });
    prop('chair_office', sx, sz, facing, { seat: id });
    prop('monitor', ...ahead(x, z, facing, 0.16), facing + 180, { seat: id, y: 0.75, screen: id });
    if (i % 2 === 0) prop('plant_desk', ...ahead(x + 0.52, z, facing, 0.12), 0, { y: 0.75, variant: i % 4 === 0 ? 'succulent' : 'snake' });
    else prop('desk_mug', ...ahead(x - 0.5, z, facing, -0.1), 0, { y: 0.75 });
    block(x, z, 1.4, 0.7, 0, 0.05);
  });

  // ---- Calling room: three booths along the north wall, glass partitions between them.
  const boothW = (CALL.x1 - CALL.x0) / 3;
  for (let i = 0; i < 3; i++) {
    const cx = CALL.x0 + boothW * (i + 0.5);
    const id = `booth-${i + 1}`;
    const deskZ = 0.55;
    seats.push({ id, kind: 'booth', room: 'calling', pos: [r2(cx), 1.42], facing: 180, sit: true, work: [r2(cx), deskZ], screen: id, callFacing: 120 });
    prop('desk_booth', cx, deskZ, 0, { seat: id });
    prop('chair_office', cx, 1.42, 180, { seat: id });
    prop('monitor', cx, 0.36, 0, { seat: id, y: 0.75, screen: id });
    prop('acoustic_panel', cx, 0.13, 0, { y: 1.05, size: [1.3, 0.9, 0.04] });
    block(cx, deskZ, 1.3, 0.6);
    if (i > 0) {
      const px = CALL.x0 + boothW * i;
      prop('booth_partition', px, 1.2, 90, { size: [2.4, 1.5, 0.05] });
      block(px, 1.2, 0.1, 2.4);
    }
  }
  prop('plant_tall', CALL.x1 - 0.45, CALL.z1 - 0.45, 0, { variant: 'fiddle' });
  blockCircle(CALL.x1 - 0.45, CALL.z1 - 0.45, 0.35);

  // ---- Manager cabin.
  const cabinDesk = [15.2, 2.25];
  seats.push({ id: 'cabin-1', kind: 'cabin', room: 'cabin', pos: [15.2, 1.4], facing: 0, sit: true, work: cabinDesk, screen: 'cabin-1' });
  prop('desk_walnut', ...cabinDesk, 180, { seat: 'cabin-1' });
  prop('chair_exec', 15.2, 1.4, 0, { seat: 'cabin-1' });
  prop('monitor', 14.75, 2.15, 180, { seat: 'cabin-1', y: 0.76, screen: 'cabin-1' });
  prop('desk_lamp', 15.95, 2.4, 200, { y: 0.76 });
  prop('chair_visitor', 14.7, 3.2, 180);
  prop('chair_visitor', 15.75, 3.2, 180);
  prop('bookshelf_walnut', 12.75, 0.3, 0, { size: [1.7, 2.1, 0.4] });
  prop('credenza_walnut', 17.15, 0.33, 0, { size: [1.4, 0.75, 0.45] });
  prop('printer_small', 17.4, 0.33, 0, { y: 0.75 });
  prop('art_frame', 14.6, 0.13, 0, { y: 1.65, size: [0.9, 0.7, 0.03], variant: 'abstract-warm' });
  prop('floor_lamp', 17.45, 4.25, 0);
  prop('plant_medium', 11.85, 4.4, 0, { variant: 'monstera' });
  block(...cabinDesk, 1.8, 0.8);
  block(12.75, 0.3, 1.7, 0.4);
  block(17.15, 0.33, 1.4, 0.45);
  block(14.7, 3.2, 0.5, 0.5);
  block(15.75, 3.2, 0.5, 0.5);
  blockCircle(17.45, 4.25, 0.25);
  blockCircle(11.85, 4.4, 0.35);

  // ---- Whiteboard (on the cabin's solid partition, facing the floor) and the print corner.
  prop('whiteboard', 12.75, CABIN.z1 + 0.09, 0, { y: 0.85, size: [2.2, 1.05, 0.04] });
  prop('cabinet_low', 17.25, CABIN.z1 + 0.32, 0, { size: [1.2, 0.72, 0.5] });
  prop('printer', 17.25, CABIN.z1 + 0.32, 0, { y: 0.72 });
  prop('filing_cabinet', W - 0.32, 6.25, 270, { size: [0.5, 1.05, 0.55] });
  prop('plant_medium', PRINT.x0 - 0.05, CABIN.z1 + 0.4, 0, { variant: 'bush' });
  block(17.25, CABIN.z1 + 0.32, 1.2, 0.5);
  block(W - 0.32, 6.25, 0.55, 0.5);
  blockCircle(PRINT.x0 - 0.05, CABIN.z1 + 0.4, 0.33);

  // ---- Lounge: green sofa under the west window, rug, coffee table, armchair, bookshelf, plants.
  seats.push({ id: 'lounge-1', kind: 'lounge', room: 'lounge', pos: [0.78, 2.25], facing: 90, sit: true });
  seats.push({ id: 'lounge-2', kind: 'lounge', room: 'lounge', pos: [0.78, 3.0], facing: 90, sit: true });
  seats.push({ id: 'lounge-3', kind: 'lounge', room: 'lounge', pos: [0.78, 3.75], facing: 90, sit: true });
  seats.push({ id: 'lounge-4', kind: 'lounge', room: 'lounge', pos: [3.55, 3.0], facing: 270, sit: true });
  prop('rug', 2.2, 3.0, 90, { size: [3.6, 0.012, 2.9], variant: 'grey' });
  prop('sofa_green', 0.6, 3.0, 90, { size: [2.5, 0.85, 0.95] });
  prop('armchair_green', 3.6, 3.0, 270, { size: [0.9, 0.85, 0.85] });
  prop('coffee_table', 2.15, 3.0, 90, { size: [1.15, 0.42, 0.62] });
  prop('bookshelf_white', 3.95, 0.3, 0, { size: [1.5, 1.9, 0.38] });
  prop('plant_tall', 0.5, 0.5, 0, { variant: 'palm' });
  prop('plant_medium', 0.5, 5.1, 0, { variant: 'monstera' });
  prop('plant_floor_small', 2.2, 0.35, 0, { variant: 'round' });
  prop('art_frame', 0.13, 5.6, 90, { y: 1.45, size: [0.55, 0.7, 0.03], variant: 'abstract-cool' });
  block(0.6, 3.0, 0.95, 2.5);
  block(3.6, 3.0, 0.85, 0.9);
  block(2.15, 3.0, 0.62, 1.15);
  block(3.95, 0.3, 1.5, 0.38);
  blockCircle(0.5, 0.5, 0.45);
  blockCircle(0.5, 5.1, 0.38);
  blockCircle(2.2, 0.35, 0.25);

  // ---- West side below the lounge: water cooler, sideboard, art, plants.
  prop('water_cooler', 0.36, 6.75, 90);
  prop('cabinet_low', 0.32, 7.85, 90, { size: [1.3, 0.8, 0.48], variant: 'oak' });
  prop('plant_desk', 0.3, 7.55, 0, { y: 0.8, variant: 'succulent' });
  prop('art_frame', 0.13, 7.85, 90, { y: 1.5, size: [1.0, 0.6, 0.03], variant: 'landscape' });
  prop('plant_tall', 0.5, 9.0, 0, { variant: 'fiddle' });
  block(0.36, 6.75, 0.4, 0.4);
  block(0.32, 7.85, 0.48, 1.3);
  blockCircle(0.5, 9.0, 0.4);

  // ---- Hot desks: a bench along the notch wall, monitors face the room.
  const benchX = NOTCH.x + 0.42;
  prop('bench_desk', benchX, 11.55, 90, { size: [2.7, 0.75, 0.75] });
  block(benchX, 11.55, 0.75, 2.7);
  [10.75, 11.55, 12.35].forEach((z, i) => {
    const id = `hot-${i + 1}`;
    seats.push({ id, kind: 'hot_desk', room: 'sales', pos: [r2(benchX + 0.85), z], facing: 270, sit: true, work: [r2(benchX), z], screen: id });
    prop('chair_office', benchX + 0.85, z, 270, { seat: id });
    prop('monitor', benchX - 0.16, z, 90, { seat: id, y: 0.75, screen: id, variant: 'small' });
  });
  prop('plant_tall', NOTCH.x + 0.45, 9.95, 0, { variant: 'palm' });
  blockCircle(NOTCH.x + 0.45, 9.95, 0.38);

  // ---- Reception at the entrance: counter with a glowing blue base edge.
  const recep = [15.6, 11.55];
  seats.push({ id: 'reception-1', kind: 'reception', room: 'reception', pos: [15.6, 10.78], facing: 0, sit: true, work: recep, screen: 'reception-1' });
  prop('reception_counter', ...recep, 0, { size: [2.2, 1.05, 0.75] });
  prop('chair_office', 15.6, 10.78, 0, { seat: 'reception-1' });
  prop('monitor', 15.25, 11.38, 180, { seat: 'reception-1', y: 0.75, screen: 'reception-1', variant: 'small' });
  prop('plant_medium', W - 0.35, 12.68, 0, { variant: 'bush' });
  block(...recep, 2.2, 0.75, 0, 0.05);
  blockCircle(W - 0.35, 12.68, 0.28);

  // ---- Lead Hub (centre) and the entrance mat outside the door.
  prop('hub', ...hub.pos, 45, { size: [hub.machineRadius * 2, 1.25, hub.machineRadius * 2] });
  prop('hub_ring', ...hub.pos, 0, { size: [hub.ringRadius * 2, 0.02, hub.ringRadius * 2] });
  blockCircle(...hub.pos, hub.machineRadius + 0.25);
  prop('mat', (DOOR.x0 + DOOR.x1) / 2, D + 0.75, 0, { size: [1.9, 0.015, 1.1] });

  // ---- Plants and lights around the floor.
  prop('plant_tall', 4.95, 6.6, 0, { variant: 'monstera' });
  blockCircle(4.95, 6.6, 0.36);
  prop('plant_medium', 12.4, 12.55, 0, { variant: 'fiddle' });
  blockCircle(12.4, 12.55, 0.32);
  prop('plant_floor_small', 9.55, 12.7, 0, { variant: 'round' });
  blockCircle(9.55, 12.7, 0.22);

  // Wall sconces: warm lights on the back walls (inside) and the low front walls (outside).
  const sconces = [
    ['back-west', 0.13, 0.55, 90],
    ['back-west', 0.13, 6.2, 90],
    ['back-north', 4.6, 0.13, 0],
    ['back-north', 11.9, 0.13, 0],
    ['back-north', 15.6, 0.13, 0],
    ['back-notch', NOTCH.x + 0.13, 12.1, 90],
  ];
  for (const [wall, x, z, f] of sconces) prop('sconce', x, z, f, { y: 1.85, wall });
  const outdoor = [
    ['front-south', 7.2, D + 0.11, 0],
    ['front-south', 11.6, D + 0.11, 0],
    ['front-east', W + 0.11, 3.0, 90],
    ['front-east', W + 0.11, 8.0, 90],
    ['front-notch', 2.2, NOTCH.z + 0.11, 0],
  ];
  for (const [wall, x, z, f] of outdoor) prop('sconce_outdoor', x, z, f, { y: 0.62, wall });

  // Lamps used by the evening look (positions of warm light pools).
  const lamps = [
    { pos: [17.45, 1.6, 4.25], kind: 'floor', room: 'cabin' },
    { pos: [15.95, 1.05, 2.4], kind: 'desk', room: 'cabin' },
    { pos: [2.2, 2.4, 3.0], kind: 'pendant', room: 'lounge' },
    { pos: [8.0, 2.4, 7.2], kind: 'pendant', room: 'sales' },
    { pos: [13.6, 2.4, 8.2], kind: 'pendant', room: 'sales' },
    { pos: [15.6, 2.2, 11.3], kind: 'pendant', room: 'reception' },
  ];

  // ---- Standing spots (idle, overflow, walkers) and the entrance.
  const standing = [
    ['stand-lounge', 2.7, 4.65, 45],
    ['stand-whiteboard', 12.75, 5.85, 180],
    ['stand-cooler', 1.05, 6.8, 270],
    ['stand-printer', 16.6, 6.1, 140],
    ['stand-hub-w', 7.95, 9.9, 80],
    ['stand-hub-e', 12.6, 7.4, 260],
    ['stand-books', 3.9, 1.05, 180],
    ['stand-reception', 13.9, 11.9, 90],
    ['stand-call', 8.6, 4.85, 20],
    ['stand-west', 3.2, 7.6, 120],
    ['stand-cabinet', 1.15, 8.4, 250],
    ['stand-hub-s', 10.4, 10.75, 0],
    ['stand-east', 16.6, 10.1, 220],
    ['stand-bench', 7.2, 10.0, 200],
  ].map(([id, x, z, f]) => ({ id, pos: [x, z], facing: f, sit: false }));

  const entrance = { outside: [r2((DOOR.x0 + DOOR.x1) / 2), D + 0.9], inside: [r2((DOOR.x0 + DOOR.x1) / 2 - 1.7), 12.35], facing: 180 };

  // ---- Walking graph: hand-placed corridor waypoints; edges are generated by line of sight.
  const waypoints = [
    ['lounge-n', 2.82, 1.3],
    ['lounge-s', 2.82, 4.85],
    ['west-n', 2.9, 6.6],
    ['west-s', 2.9, 8.7],
    ['notch', 5.55, 9.5],
    ['bench', 6.25, 11.6],
    ['call-out', 5.8, 4.85],
    ['call-in', 5.8, 3.55],
    ['call-mid', 8.2, 2.9],
    ['call-e', 10.3, 2.9],
    ['call-w', 6.15, 2.9],
    ['north-1', 8.0, 4.85],
    ['north-2', 11.6, 5.55],
    ['cabin-out', 14.8, 5.6],
    ['cabin-in', 14.8, 4.45],
    ['cabin-e', 16.65, 3.9],
    ['cabin-ne', 16.65, 1.45],
    ['cabin-w', 13.4, 3.6],
    ['print', 16.3, 7.05],
    ['east-1', 15.9, 7.55],
    ['east-2', 16.3, 10.0],
    ['hub-n', 11.5, 6.6],
    ['hub-w', 7.75, 7.6],
    ['hub-sw', 8.4, 10.1],
    ['hub-e', 12.45, 8.4],
    ['hub-se', 12.3, 10.45],
    ['south-w', 9.45, 12.15],
    ['south-e', 13.0, 11.0],
    ['recep-w', 13.95, 12.35],
    ['recep-e', 17.2, 12.3],
    ['recep-back', 17.25, 10.7],
    ['door-in', 15.6, 12.6],
    ['door-out', 15.6, 13.9],
    ['hub-front', 10.2, 10.55],
  ];

  return finalize({
    id: 'medium',
    name: 'Medium office',
    capacity: 20,
    bounds: { min: [0, 0], max: [W, D] },
    footprint,
    wallHeights: { back: BACK_H, front: FRONT_H },
    walls,
    rooms,
    seats,
    standing,
    hub,
    entrance,
    props,
    lamps,
    camera: { yawDeg: 45, pitchDeg: 32, padding: 0.035, fitHeight: BACK_H, minZoom: 0.85, maxZoom: 3.2 },
    waypoints,
    obstacles,
  });
}

// ---------------------------------------------------------------- graph + validation

function segDistToRect(ax, az, bx, bz, o) {
  // Distance from segment AB to an oriented rectangle (approx: sample the segment).
  const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.08));
  let best = Infinity;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    best = Math.min(best, pointDist(x, z, o));
    if (best <= 0) return 0;
  }
  return best;
}

function pointDist(x, z, o) {
  if (o.kind === 'circle') return Math.max(0, Math.hypot(x - o.cx, z - o.cz) - o.r);
  const a = (-(o.facing ?? 0) * Math.PI) / 180;
  const dx = x - o.cx;
  const dz = z - o.cz;
  const lx = dx * Math.cos(a) - dz * Math.sin(a);
  const lz = dx * Math.sin(a) + dz * Math.cos(a);
  const qx = Math.max(0, Math.abs(lx) - o.w / 2);
  const qz = Math.max(0, Math.abs(lz) - o.d / 2);
  return Math.hypot(qx, qz);
}

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Wall pieces that block walking (openings of kind door/gap are passable, windows are not). */
function wallSolids(walls) {
  const out = [];
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / len;
    const uz = (w.b[1] - w.a[1]) / len;
    let cursor = 0;
    const doors = (w.openings ?? []).filter((o) => o.kind === 'door' || o.kind === 'gap').sort((p, q) => p.from - q.from);
    for (const o of [...doors, { from: len, to: len }]) {
      if (o.from > cursor) out.push([[w.a[0] + ux * cursor, w.a[1] + uz * cursor], [w.a[0] + ux * o.from, w.a[1] + uz * o.from]]);
      cursor = Math.max(cursor, o.to);
    }
  }
  return out;
}

function clear(a, b, solids, obstacles, clearance) {
  for (const [p, q] of solids) {
    if (segmentsCross(a, b, p, q)) return false;
    // Keep away from wall ends and faces.
    const d = segSegDist(a, b, p, q);
    if (d < clearance) return false;
  }
  for (const o of obstacles) if (segDistToRect(a[0], a[1], b[0], b[1], o) < clearance) return false;
  return true;
}

function segSegDist(a, b, c, d) {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
}

function ptSeg(p, a, b) {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const l2 = vx * vx + vz * vz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vz * t);
}

function finalize(t) {
  const solids = wallSolids(t.walls);
  const nodes = t.waypoints.map(([id, x, z]) => ({ id, pos: [r2(x), r2(z)] }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const problems = [];

  for (const n of nodes) {
    for (const o of t.obstacles) if (pointDist(n.pos[0], n.pos[1], o) < 0.25) problems.push(`waypoint ${n.id} is inside an obstacle`);
  }

  const edges = [];
  const MAX = 7.5;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].pos;
      const b = nodes[j].pos;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > MAX) continue;
      if (clear(a, b, solids, t.obstacles, 0.3)) edges.push([nodes[i].id, nodes[j].id]);
    }
  }

  // Seats and spots attach to their nearest visible waypoint (own furniture is ignored).
  const attach = (id, pos, label) => {
    const own = t.obstacles.filter((o) => pointDist(pos[0], pos[1], o) > 0.12);
    const ranked = nodes
      .map((n) => ({ n, d: Math.hypot(n.pos[0] - pos[0], n.pos[1] - pos[1]) }))
      .sort((p, q) => p.d - q.d);
    for (const { n } of ranked) if (clear(pos, n.pos, solids, own, 0.18)) return n.id;
    problems.push(`${label} ${id} has no visible waypoint`);
    return ranked[0].n.id;
  };
  for (const s of t.seats) s.approach = attach(s.id, s.pos, 'seat');
  for (const s of t.standing) s.approach = attach(s.id, s.pos, 'spot');
  const hubApproach = attach('hub', [t.hub.pos[0] + t.hub.platformRadius + 0.4, t.hub.pos[1]], 'hub');
  const entranceApproach = 'door-out';
  if (!byId.has(entranceApproach)) problems.push('missing door-out waypoint');

  // Connectivity from the entrance.
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const [a, b] of edges) {
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set([entranceApproach]);
  const queue = [entranceApproach];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of adj.get(cur) ?? []) if (!seen.has(nb)) (seen.add(nb), queue.push(nb));
  }
  for (const n of nodes) if (!seen.has(n.id)) problems.push(`waypoint ${n.id} is not reachable from the entrance`);

  const counts = {};
  for (const s of t.seats) counts[s.kind] = (counts[s.kind] ?? 0) + 1;

  const out = {
    $schema: './template.schema.json',
    schemaVersion: 1,
    id: t.id,
    name: t.name,
    capacity: t.capacity,
    units: 'm',
    bounds: t.bounds,
    footprint: t.footprint,
    wallHeights: t.wallHeights,
    walls: t.walls,
    rooms: t.rooms,
    seats: t.seats,
    standing: t.standing,
    hub: { ...t.hub, approach: hubApproach },
    entrance: { ...t.entrance, approach: entranceApproach },
    graph: { nodes, edges },
    props: t.props,
    lamps: t.lamps,
    obstacles: t.obstacles.map((o) =>
      o.kind === 'circle' ? { kind: 'circle', pos: [r2(o.cx), r2(o.cz)], r: r2(o.r) } : { kind: 'rect', pos: [r2(o.cx), r2(o.cz)], size: [r2(o.w), r2(o.d)], facing: o.facing ?? 0 },
    ),
    camera: t.camera,
  };
  return { template: out, problems, counts };
}

// ---------------------------------------------------------------- SVG preview

function svgPlan(t) {
  const S = 50;
  const pad = 1.5;
  const W = (t.bounds.max[0] + pad * 2) * S;
  const H = (t.bounds.max[1] + pad * 2) * S;
  const X = (x) => ((x + pad) * S).toFixed(1);
  const Z = (z) => ((z + pad) * S).toFixed(1);
  const floorColor = { oak: '#d9b98f', carpet: '#9aa3ad', walnut: '#6b4a33' };
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif">`, `<rect width="100%" height="100%" fill="#eef0f3"/>`];
  parts.push(`<polygon points="${t.footprint.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="#f4e6d2" stroke="#333" stroke-width="2"/>`);
  for (const r of t.rooms) {
    parts.push(`<polygon points="${r.outline.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="${floorColor[r.floor] ?? '#ddd'}" fill-opacity="0.55" stroke="#888" stroke-dasharray="4 3"/>`);
    const cx = r.outline.reduce((a, p) => a + p[0], 0) / r.outline.length;
    const cz = r.outline.reduce((a, p) => a + p[1], 0) / r.outline.length;
    parts.push(`<text x="${X(cx)}" y="${Z(cz)}" font-size="13" fill="#333" text-anchor="middle">${r.name}</text>`);
  }
  for (const o of t.obstacles) {
    if (o.kind === 'circle') parts.push(`<circle cx="${X(o.pos[0])}" cy="${Z(o.pos[1])}" r="${o.r * S}" fill="#6a8f5a" fill-opacity="0.5"/>`);
    else {
      parts.push(
        `<rect x="${X(o.pos[0] - o.size[0] / 2)}" y="${Z(o.pos[1] - o.size[1] / 2)}" width="${o.size[0] * S}" height="${o.size[1] * S}" fill="#555" fill-opacity="0.35" transform="rotate(${-o.facing} ${X(o.pos[0])} ${Z(o.pos[1])})"/>`,
      );
    }
  }
  for (const w of t.walls) {
    const color = { back: '#1f3b44', front: '#2f4f4f', glass: '#5aa9e6', glass_walnut: '#7a5232', partition: '#bbb' }[w.kind] ?? '#000';
    parts.push(`<line x1="${X(w.a[0])}" y1="${Z(w.a[1])}" x2="${X(w.b[0])}" y2="${Z(w.b[1])}" stroke="${color}" stroke-width="${Math.max(3, w.thickness * S)}" stroke-opacity="0.85"/>`);
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const o of w.openings ?? []) {
      const ux = (w.b[0] - w.a[0]) / len;
      const uz = (w.b[1] - w.a[1]) / len;
      parts.push(
        `<line x1="${X(w.a[0] + ux * o.from)}" y1="${Z(w.a[1] + uz * o.from)}" x2="${X(w.a[0] + ux * o.to)}" y2="${Z(w.a[1] + uz * o.to)}" stroke="${o.kind === 'window' ? '#9fd3ff' : '#f4e6d2'}" stroke-width="${Math.max(3, w.thickness * S) + 2}"/>`,
      );
    }
  }
  const node = new Map(t.graph.nodes.map((n) => [n.id, n]));
  for (const [a, b] of t.graph.edges) {
    const p = node.get(a).pos;
    const q = node.get(b).pos;
    parts.push(`<line x1="${X(p[0])}" y1="${Z(p[1])}" x2="${X(q[0])}" y2="${Z(q[1])}" stroke="#e05" stroke-opacity="0.25"/>`);
  }
  for (const n of t.graph.nodes) parts.push(`<circle cx="${X(n.pos[0])}" cy="${Z(n.pos[1])}" r="4" fill="#e05"/>`);
  const kindColor = { desk: '#4f46e5', booth: '#2563eb', cabin: '#7c3aed', reception: '#0891b2', lounge: '#16a34a', hot_desk: '#d97706' };
  for (const s of [...t.seats, ...t.standing]) {
    const [fx, fz] = fwd(s.facing);
    const color = kindColor[s.kind] ?? '#64748b';
    parts.push(`<circle cx="${X(s.pos[0])}" cy="${Z(s.pos[1])}" r="9" fill="${color}"/>`);
    parts.push(`<line x1="${X(s.pos[0])}" y1="${Z(s.pos[1])}" x2="${X(s.pos[0] + fx * 0.45)}" y2="${Z(s.pos[1] + fz * 0.45)}" stroke="${color}" stroke-width="3"/>`);
    const ap = node.get(s.approach)?.pos;
    if (ap) parts.push(`<line x1="${X(s.pos[0])}" y1="${Z(s.pos[1])}" x2="${X(ap[0])}" y2="${Z(ap[1])}" stroke="${color}" stroke-dasharray="3 3"/>`);
  }
  parts.push(`<circle cx="${X(t.hub.pos[0])}" cy="${Z(t.hub.pos[1])}" r="${t.hub.ringRadius * S}" fill="none" stroke="#3b82f6" stroke-width="4"/>`);
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------------------------------------------------------------- main

const builders = { medium };
const wantSvg = process.argv.includes('--svg');
mkdirSync(outDir, { recursive: true });
let failed = false;
for (const [id, build] of Object.entries(builders)) {
  const { template, problems, counts } = build();
  const file = join(outDir, `${id}.json`);
  writeFileSync(file, JSON.stringify(template, null, 1) + '\n');
  const seatsTotal = template.seats.length;
  console.log(`${id}: ${seatsTotal} seats ${JSON.stringify(counts)}, ${template.standing.length} standing spots, ${template.graph.nodes.length} nodes, ${template.graph.edges.length} edges, ${template.props.length} props -> ${file}`);
  if (wantSvg) {
    mkdirSync(previewDir, { recursive: true });
    writeFileSync(join(previewDir, `${id}-plan.svg`), svgPlan(template));
  }
  if (problems.length) {
    failed = true;
    for (const p of problems) console.error(`  ! ${p}`);
  }
}
if (failed) process.exitCode = 1;
