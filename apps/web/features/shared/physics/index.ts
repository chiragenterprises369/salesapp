/**
 * Shared physics for draggable surfaces (Leads Board cards, workflow builder nodes). SPEC 11.1.
 * Framework pieces only: no board, React Flow or data specifics. Owners keep their own tunables
 * (e.g. features/pipeline/board-physics.config.ts) and feed them in.
 *
 * - spring.ts       spring params, presets, react-spring mapping (time-scaled), imperative Spring
 * - clock.ts        global time scale (slow motion)
 * - velocity.ts     low-pass velocity tracker and velocity -> tilt (clamped)
 * - inertia.ts      release momentum (throw distance, velocity cap)
 * - pickup.ts       pointer/touch pick-up (4 px threshold, 180 ms long-press + haptic), pointer session
 * - auto-scroll.ts  edge auto-scroll with proximity curve and time ramp
 * - quality.ts      frame-time monitor and adaptive quality tiers (drops effects under ~45 fps)
 * - motion.ts       full / reduced / flat profile (what to switch off)
 * - overlay.tsx     portal overlay for dragged and flying bodies
 * - react.ts        hooks: time scale, quality, page visibility, fps readout
 */
export * from './auto-scroll';
export * from './clock';
export * from './inertia';
export * from './motion';
export * from './overlay';
export * from './pickup';
export * from './quality';
export * from './react';
export * from './spring';
export * from './velocity';
