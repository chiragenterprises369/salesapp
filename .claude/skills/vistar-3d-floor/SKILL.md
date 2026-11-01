---
name: vistar-3d-floor
description: Vistar Live Team Floor rules - R3F isometric office, theme-aware lighting, procedural characters, event-to-animation mapping, A* movement, performance tiers, flat and accessible fallbacks. Use for any work in apps/web/features/team-floor.
---

# Vistar Live Team Floor

Contract: `TeamFloor` props in `apps/web/features/team-floor/index.tsx`, `TeamFloorSnapshotSchema`
(`schemas/dashboard.ts`), events in `events.ts`, palettes in `design/tokens.ts`. Read
`vistar-theming` and `vistar-realtime-events` too. No Three.js skill is installed: use context7 for
`@react-three/fiber` 9, `@react-three/drei` 10, `three` 0.187.

## Architecture
- `index.tsx` stays light: it decides the mode and `next/dynamic(() => import('./scene/...'), { ssr: false })` the 3D scene. three/R3F/drei must never appear in a page's initial chunk.
- One pure reducer `floorReducer(state, DomainEvent)` + `initialFloorState(snapshot)`. Both 3D and flat views render from this state. Wave 1 feeds it `mockTeamFloorSnapshot()` + `createEventSimulator().next()`; Wave 3 feeds socket events unchanged.
- Animation state per employee lives in refs, not React state, and advances in `useFrame`. React state changes only on events.
- Suggested layout: `state/` (reducer, selectors, layout grid), `scene/` (canvas, rooms, props, characters, effects), `flat/` (flat floor + accessible list), `panel/` (employee side panel, KPI strip, Needs-you list).

## Scene
- Orthographic camera, fixed isometric view (rotation ~35 deg pitch, 45 deg yaw), bounded pan, zoom 0.6-1.8, no orbit. `frameloop="demand"` when nothing animates; invalidate on events and active animations.
- Rooms on a tile grid: sales floor (desk clusters, one desk per `deskIndex`), glass calling room, manager cabin, lounge (idle), central Lead Hub. Low walls, no ceiling; floor tiles and walls flat-shaded.
- Lighting: hemisphere + one directional light with soft shadows (small shadow map, `shadows="soft"` only on high tier). Bake-like look: matte materials (`meshStandardMaterial` roughness 0.8+), no reflections.
- Theme: Light = daylight (cool neutral key light, bright floor from `palettes.light.surface-2`). Dark = evening (dim ambient, warm lamp point lights, emissive monitors using `palettes.dark.accent`). Read `useDocumentTheme()`; tween colours/intensity over ~400 ms on change.
- Colours only from `palettes[theme]` and `AvatarConfig`. Status accents from status tones (blue on call, green idle, amber busy, grey away/offline, red error).

## Characters
- No GLB yet: procedural low-poly figures (capsule body, sphere head, hair variant per `hairStyle`, outfit colour) on a shared simple rig; clips as procedural poses: `idle`, `typing`, `phone`, `walking`, `sleeping`. Keep a `CharacterModel` interface so GLB + AnimationMixer can replace it.
- Name tag (drei `Html` only on high tier; else a canvas-texture sprite) with status dot and live call timer (`formatDuration`). Hide tags beyond the zoom threshold.

## Event mapping
| Event | Floor reaction |
| --- | --- |
| `employee.status_changed` | on_call: walk to calling room, phone clip, pulse ring; busy: desk + typing; idle: lounge or wave at desk; away: lounge, sleeping; offline: empty chair (or sleeping at desk) |
| `lead.created` | glowing parcel spawns at the Lead Hub (queue up to 12, then a counter) |
| `lead.assigned` | parcel travels along the path to the owner's desk; owner turns and receives it |
| `call.started` / `call.ended` | sound-wave rings + timer; on end an outcome popup (answered, missed, interested) for ~3 s |
| `task.overdue`, `attention.raised` | clickable "Needs you" bubble above the employee (or the manager cabin when `userId` null); `attention.resolved` removes it |

## Movement
- Grid A* (4- or 8-neighbour, diagonal cost 1.4) on a walkability grid built from the room layout; cache paths per (from, to) tile; smooth with Catmull-Rom; walking speed ~1.6 tiles/s; avoid simultaneous same-tile arrival with small offsets.

## Performance
- Instanced meshes for desks, chairs, monitors, plants, floor tiles. LOD: far characters become simple capsules, tags hidden.
- Max 200 employees. Quality tiers `high | medium | low` from GPU detection (`renderer.capabilities`, `navigator.hardwareConcurrency`, device memory) and an FPS monitor (drop a tier after 3 s below 45 fps; never auto-raise mid-session). Low = no shadows, dpr 1, no Html.
- Pause rendering when `document.hidden`; dispose geometries/materials on unmount.

## Modes and accessibility
- Modes: 3D | Flat toggle (persist `teamFloorMode` via session `updateSettings`). `auto` = flat on coarse pointer/small screens, `prefers-reduced-motion`, low tier, or WebGL unavailable.
- Flat view: 2D floor plan (CSS grid or SVG) with the same rooms, status chips and Needs-you items; fully keyboard operable.
- Always render the accessible employee list (visually hidden when 3D is shown, visible in flat): name, status, current lead, call timer, Needs-you items; `aria-live="polite"` summary of changes (throttled).
- KPI strip on top (active, on call, idle, busy, calls today, leads waiting) with tick-up numbers.
- Clicking an employee (3D or list) opens the side panel: live status, current lead, calls today, avg talk time, target ring, recent activity, actions (reassign lead, message, view recordings if `calls.recordings`). Hide actions when `readOnly`.

## Done checklist
- [ ] three not in the initial chunk (check `.next` build output or bundle analyzer).
- [ ] 200 simulated employees interactive; tier drop works.
- [ ] Light and dark scenes both correct; theme change tweens.
- [ ] Flat mode and list usable with keyboard and screen reader.
