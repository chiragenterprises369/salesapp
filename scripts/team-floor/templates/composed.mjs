// Small (up to 8 seats) and Large (up to 50 seats) floor templates, composed from the module kit
// (D-054) in the same style as the hand-composed Medium template (reference composition).
import { backWall, BOOTH_W, createPlan, frontWall, LOUNGE_SIZE, place, r2, remainderOutline, scope } from './modules.mjs';

const CAMERA = { yawDeg: 45, pitchDeg: 27, padding: 0.015, fitHeight: 2.5, minZoom: 0.85 };

/** Shared tail: sales floor outline, entrance, wall sconces, outdoor sconces, entrance mat. */
function finishPlan(plan, { D, footprint, door, inside, sconces, outdoor }) {
  const doorC = (door[0] + door[1]) / 2;
  plan.rooms.push({ id: 'sales', type: 'sales_floor', name: 'Sales floor', floor: 'oak', outline: remainderOutline(footprint, plan.rooms) });
  const S = scope(plan);
  for (const [wall, x, z, f] of sconces) S.prop('sconce', x, z, f, { y: 1.72, wall });
  for (const [wall, x, z, f] of outdoor) S.prop('sconce_outdoor', x, z, f, { y: 0.62, wall });
  S.prop('mat', doorC, D + 0.75, 0, { size: [1.9, 0.015, 1.1] });
  S.wp('door-in', doorC, D - 0.4);
  S.wp('door-out', doorC, D + 0.9);
  return { outside: [r2(doorC), r2(D + 0.9)], inside, facing: 180 };
}

// ---------------------------------------------------------------- Small (8 seats)

export function small() {
  const W = 14.4;
  const D = 10.4;
  const plan = createPlan();
  const S = scope(plan);
  const footprint = [
    [0, 0],
    [W, 0],
    [W, D],
    [0, D],
  ];
  const CALL_X = LOUNGE_SIZE[0];
  const CABIN_X = CALL_X + 2 * BOOTH_W;
  const CABIN_W = W - CABIN_X;
  const RECEP = [12.2, D - 1.45];
  const DOOR = [RECEP[0] - 0.8, RECEP[0] + 0.8];

  plan.walls.push(
    backWall('back-north', [0, 0], [W, 0], {
      windows: [[12.4, 13.9]],
      finish: [
        { from: 0, to: CALL_X, inner: 'paint' },
        { from: CALL_X, to: r2(CABIN_X), inner: 'acoustic' },
        { from: r2(CABIN_X), to: W, inner: 'walnut' },
      ],
    }),
    backWall('back-west', [0, 0], [0, D], { windows: [[1.3, 4.7, 0.95, 2.2]] }),
    frontWall('front-south', [0, D], [W, D], { door: DOOR }),
    frontWall('front-east', [W, 0], [W, D]),
  );

  place(plan, 'lounge', 'lounge', [0, 0], 0, { north: true });
  place(plan, 'calling_room', 'calling', [CALL_X, 0], 0, { booths: 2 });
  place(plan, 'manager_cabin', 'cabin', [CABIN_X, 0], 0, { w: r2(CABIN_W), d: 4.8, door: [3.9, 4.8] });
  place(plan, 'print_corner', 'print', [CABIN_X, 4.8], 0);
  place(plan, 'sales_pod', 'pod-a', [4.0, 8.0], 0, { desks: 4 });
  place(plan, 'hub_plaza', 'hub', [8.6, 7.5], 0, { ring: 1.2, platform: 1.35, machine: 0.6 });
  place(plan, 'reception', 'reception', RECEP, 0, { plant: true });
  place(plan, 'hot_bench', 'hot', [0.55, 8.3], 0, { seats: 2, aisle: 1.4 });
  plan.rooms.push({ id: 'reception', type: 'reception', name: 'Reception', floor: 'oak', outline: [[RECEP[0] - 2.2, RECEP[1] - 1.15], [W, RECEP[1] - 1.15], [W, D], [RECEP[0] - 2.2, D]].map(([x, z]) => [r2(x), r2(z)]) });

  // Amenities along the west wall and the east side.
  S.prop('water_cooler', 0.36, 6.75, 90);
  S.block(0.36, 6.75, 0.4, 0.4);
  S.spot('stand-cooler', 1.05, 6.8, 270);
  S.prop('art_frame', 0.13, 8.3, 90, { y: 1.5, size: [1.0, 0.6, 0.03], variant: 'landscape' });
  S.prop('filing_cabinet', W - 0.32, 6.3, 270, { size: [0.5, 1.05, 0.55] });
  S.block(W - 0.32, 6.3, 0.55, 0.5);
  S.prop('plant_tall', W - 0.45, 7.3, 0, { variant: 'palm' });
  S.circle(W - 0.45, 7.3, 0.38);
  S.prop('plant_floor_small', 8.2, D - 0.4, 0, { variant: 'round' });
  S.circle(8.2, D - 0.4, 0.22);
  S.spot('stand-east', 13.2, 6.7, 220);
  S.spot('stand-south', 7.6, 9.7, 160);

  // Corridor nodes joining the modules.
  S.wp('west-mid', 2.9, 6.3);
  S.wp('mid-n', 7.0, 5.2);
  S.wp('mid-s', 7.0, 9.6);
  S.wp('east-n', 13.4, 5.9);
  S.wp('east-s', 13.4, 8.0);

  const entrance = finishPlan(plan, {
    D,
    footprint,
    door: DOOR,
    inside: [r2(RECEP[0] - 1.7), r2(D - 0.65)],
    sconces: [
      ['back-west', 0.13, 6.2, 90],
      ['back-west', 0.13, 9.6, 90],
    ],
    outdoor: [
      ['front-south', 3.4, D + 0.11, 0],
      ['front-south', 8.2, D + 0.11, 0],
      ['front-east', W + 0.11, 2.6, 90],
      ['front-east', W + 0.11, 7.4, 90],
    ],
  });

  return {
    id: 'small',
    name: 'Small office',
    capacity: 8,
    bounds: { min: [0, 0], max: [W, D] },
    footprint,
    wallHeights: { back: 2.5, front: 1.05 },
    ...plan,
    entrance,
    camera: { ...CAMERA, maxZoom: 3.0 },
  };
}

// ---------------------------------------------------------------- Large (50 seats)

export function large() {
  const W = 32;
  const D = 20.8;
  const plan = createPlan();
  const S = scope(plan);
  const footprint = [
    [0, 0],
    [W, 0],
    [W, D],
    [0, D],
  ];
  const CALL_X = LOUNGE_SIZE[0];
  const CABIN_X = r2(CALL_X + 6 * BOOTH_W);
  const CABIN_W = r2((W - CABIN_X) / 2);
  const CABIN2_X = r2(CABIN_X + CABIN_W);
  const RECEP = [29.0, r2(D - 1.45)];
  const DOOR = [RECEP[0] - 0.8, RECEP[0] + 0.8];
  const LOUNGE_B_Z = r2(D - LOUNGE_SIZE[1]);

  plan.walls.push(
    backWall('back-north', [0, 0], [W, 0], {
      windows: [
        [r2(CABIN_X + 4.85), r2(CABIN_X + 6.45)],
        [r2(CABIN2_X + 4.85), r2(CABIN2_X + 6.45)],
      ],
      finish: [
        { from: 0, to: CALL_X, inner: 'paint' },
        { from: CALL_X, to: CABIN_X, inner: 'acoustic' },
        { from: CABIN_X, to: W, inner: 'walnut' },
      ],
    }),
    backWall('back-west', [0, 0], [0, D], {
      windows: [
        [1.3, 4.7, 0.95, 2.2],
        [r2(LOUNGE_B_Z + 1.3), r2(LOUNGE_B_Z + 4.7), 0.95, 2.2],
      ],
    }),
    frontWall('front-south', [0, D], [W, D], { door: DOOR }),
    frontWall('front-east', [W, 0], [W, D]),
  );

  place(plan, 'lounge', 'lounge-a', [0, 0], 0, { north: true, name: 'Lounge' });
  place(plan, 'lounge', 'lounge-b', [0, LOUNGE_B_Z], 0, { north: false, name: 'Lounge' });
  place(plan, 'calling_room', 'calling', [CALL_X, 0], 0, { booths: 6 });
  place(plan, 'manager_cabin', 'cabin-1', [CABIN_X, 0], 0, { w: CABIN_W, d: 4.8, door: [4.0, 4.9] });
  place(plan, 'manager_cabin', 'cabin-2', [CABIN2_X, 0], 0, { w: CABIN_W, d: 4.8, door: [4.0, 4.9] });
  place(plan, 'print_corner', 'print-1', [CABIN_X, 4.8], 0);
  place(plan, 'print_corner', 'print-2', [CABIN2_X, 4.8], 0);

  // Pods: three rows, never a dense wall (1.4 m aisles between rows, 1.8 m between pods). Row 2
  // keeps the middle free for the hub plaza. Fill order: rows 1 and 3 first, then row 2.
  const ROWS = [8.1, 12.3, 16.5];
  const COLS = [11.9, 18.5, 25.1];
  let n = 0;
  for (const z of [ROWS[0], ROWS[2]]) for (const x of COLS) place(plan, 'sales_pod', `pod-${String.fromCharCode(97 + n++)}`, [x, z], 0, { desks: 6 });
  place(plan, 'sales_pod', `pod-${String.fromCharCode(97 + n++)}`, [10.6, ROWS[1]], 0, { desks: 4 });
  place(plan, 'sales_pod', `pod-${String.fromCharCode(97 + n++)}`, [26.4, ROWS[1]], 0, { desks: 4 });
  place(plan, 'hub_plaza', 'hub', [18.5, ROWS[1]], 0, { ring: 1.75, platform: 1.95, machine: 0.8 });
  place(plan, 'reception', 'reception', RECEP, 0, { plant: true });
  place(plan, 'hot_bench', 'hot', [0.55, 10.4], 0, { seats: 3, aisle: 1.6 });
  plan.rooms.push({ id: 'reception', type: 'reception', name: 'Reception', floor: 'oak', outline: [[RECEP[0] - 2.2, RECEP[1] - 1.15], [W, RECEP[1] - 1.15], [W, D], [RECEP[0] - 2.2, D]].map(([x, z]) => [r2(x), r2(z)]) });

  // West strip between the lounges: water cooler, sideboard, art and plants.
  S.prop('water_cooler', 0.36, 7.0, 90);
  S.block(0.36, 7.0, 0.4, 0.4);
  S.spot('stand-cooler', 1.05, 7.05, 270);
  S.prop('plant_tall', 0.5, 8.2, 0, { variant: 'fiddle' });
  S.circle(0.5, 8.2, 0.4);
  S.prop('cabinet_low', 0.32, 13.2, 90, { size: [1.3, 0.8, 0.48], variant: 'oak' });
  S.block(0.32, 13.2, 0.48, 1.3);
  S.prop('plant_desk', 0.3, 12.9, 0, { y: 0.8, variant: 'succulent' });
  S.prop('art_frame', 0.13, 13.2, 90, { y: 1.5, size: [1.0, 0.6, 0.03], variant: 'landscape' });
  S.prop('art_frame', 0.13, 10.4, 90, { y: 1.55, size: [0.9, 0.55, 0.03], variant: 'abstract-warm' });
  S.spot('stand-cabinet', 1.15, 13.8, 250);
  // East strip: filing, plants, a second water cooler.
  S.prop('filing_cabinet', W - 0.32, 6.6, 270, { size: [0.5, 1.05, 0.55] });
  S.block(W - 0.32, 6.6, 0.55, 0.5);
  S.prop('filing_cabinet', W - 0.32, 7.2, 270, { size: [0.5, 1.05, 0.55] });
  S.block(W - 0.32, 7.2, 0.55, 0.5);
  S.prop('plant_tall', W - 0.5, 9.4, 0, { variant: 'palm' });
  S.circle(W - 0.5, 9.4, 0.4);
  S.prop('water_cooler', W - 0.36, 14.2, 270);
  S.block(W - 0.36, 14.2, 0.4, 0.4);
  S.prop('plant_medium', W - 0.45, 16.4, 0, { variant: 'monstera' });
  S.circle(W - 0.45, 16.4, 0.36);
  S.prop('plant_medium', 7.4, D - 0.45, 0, { variant: 'fiddle' });
  S.circle(7.4, D - 0.45, 0.32);
  S.prop('plant_floor_small', 21.8, D - 0.4, 0, { variant: 'round' });
  S.circle(21.8, D - 0.4, 0.22);
  S.prop('plant_tall', 5.6, 6.3, 0, { variant: 'monstera' });
  S.circle(5.6, 6.3, 0.36);
  S.spot('stand-east-1', 30.4, 10.6, 220);
  S.spot('stand-east-2', 30.6, 14.9, 250);
  S.spot('stand-west', 7.2, 12.3, 120);
  S.spot('stand-south', 15.2, 19.4, 20);

  // Corridor downlights (Evening pools between the modules).
  for (const [x, z] of [
    [2.9, 10.4],
    [30.2, 12.3],
    [18.5, 19.2],
    [7.6, 16.6],
    [30.0, 5.8],
  ])
    S.lamp('pendant', x, 2.4, z, 'sales');

  // Corridor nodes joining the strips to the pod aisles.
  S.wp('west-n', 2.9, 6.6);
  S.wp('west-mid', 2.9, 10.4);
  S.wp('west-s', 2.9, 14.0);
  S.wp('mid-w-n', 7.6, 5.9);
  S.wp('mid-w', 7.6, 10.2);
  S.wp('mid-w-s', 7.6, 14.4);
  S.wp('mid-w-sb', 7.6, 18.9);
  S.wp('east-n', 30.2, 6.0);
  S.wp('east-mid', 30.2, 12.3);
  S.wp('east-s', 30.0, 17.4);
  S.wp('south-mid', 18.5, 19.4);
  S.wp('south-e', 24.2, 19.5);

  const entrance = finishPlan(plan, {
    D,
    footprint,
    door: DOOR,
    inside: [r2(RECEP[0] - 1.7), r2(D - 0.65)],
    sconces: [
      ['back-west', 0.13, 6.2, 90],
      ['back-west', 0.13, 9.2, 90],
      ['back-west', 0.13, 11.8, 90],
    ],
    outdoor: [3.6, 8.6, 13.6, 18.6, 23.6].map((x) => ['front-south', x, D + 0.11, 0]).concat([3.4, 8.4, 13.4, 18.0].map((z) => ['front-east', W + 0.11, z, 90])),
  });

  return {
    id: 'large',
    name: 'Large office',
    capacity: 50,
    bounds: { min: [0, 0], max: [W, D] },
    footprint,
    wallHeights: { back: 2.5, front: 1.05 },
    ...plan,
    entrance,
    camera: { ...CAMERA, maxZoom: 4.2 },
    // The Evening bake of the big floor is darker per square metre; lift it to match Medium.
    lighting: { eveningExposure: 1.25 },
  };
}
