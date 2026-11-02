# Team Floor V3: screenshot critique log (Phase A, light theme)

Reference: `reference.jpg` (AI concept, comparison only). Each iteration lives in `iter-NN/`
(`medium-day-*.png` app screenshots, `*-canvas.png` canvas crops, `compare-*.png` sheets, `shots.json`
with renderer, people, label counts and overlaps). GPU for every run: NVIDIA GeForce GT 710 (ANGLE D3D11).
Scores are my own 1-5 judgement per axis against the reference.

## Iteration 01

Saw (compare-populated.png, 14 people, 1920x1080 canvas):
- Colour richness 3/5: right palette (honey oak, teal wainscot, walnut cabin, green sofa) but the whole
  scene is darker and harder than the reference. Front walls read near-black navy, the oak is orange-brown.
- Room distinctness 3/5: glass calling room and walnut cabin read well. Reception is a small white box
  with a thin blue line; the hub is a dark platform with purple cubes around it (looks like debris).
- Character readability 2/5: people are ~45 px tall against ~110 px in the reference. The office fills
  only ~70% of the canvas width. Characters look dark: Lambert key/fill light is too weak compared with
  the baked surroundings (three.js divides diffuse light by pi, so 1.75 hemi = 0.56x albedo).
- Label cleanliness 4/5: zero overlaps, no leaders needed, but the pills are small (11 px text) next to
  the reference's chunky tags.
- Lighting 3/5: soft bake and sconce pools are right; overall exposure ~15% low, sun patches barely visible.

Changed for iteration 02:
- Camera pitch 32 -> 27 deg and tighter framing (padding 0.035 -> 0.015): wider, larger office on wide canvases.
- Character and prop light levels raised (hemi 1.75 -> 3.0, key 1.9 -> 2.6), rim light stronger.
- Bake: lighter honey oak and teal-slate front walls, brighter lightmap (x1.12), stronger reception glow.
- Lead Hub: bigger, brighter machine with a light platform; parcels become small glowing lead cards
  orbiting above the hub instead of cubes on the floor.
- Name tags: 12 px text, 22 px tall pills.

## Iteration 02

Saw (compare-populated.png):
- Colour richness 4/5: honey oak, teal-slate front walls and the bright hub now sit close to the
  reference palette. Back walls are still a large flat cream area.
- Room distinctness 4/5: hub reads as the centrepiece (lit glass drum, light platform, ring). The tall
  notch wall in the middle-left looks like a stray partition; the reference is open on that side.
- Character readability 2.5/5: better lit (key + camera-side fill), but still ~55-60 px tall seated
  versus ~110 px in the reference; the reference also draws people slightly larger than life.
- Label cleanliness 4/5: zero overlaps, 12 px tags read well.
- Lighting 4/5: brighter and warmer; lead cards orbit above the hub. Bug: the "LEAD HUB" screen
  texture is upside down (canvas texture flipY on glTF UVs).

Changed for iteration 03:
- Hub screen texture flipY = false (glTF UV convention).
- Back walls 2.8 -> 2.5 m, notch wall becomes a low front wall: less wall mass, tighter fit.
- Characters drawn at 1.12x scale (heroic scale, like the reference) with seated clips re-authored
  so hips still land on the 0.47 m seat and hands on the 0.75 m desk.

## Iteration 03

Saw (compare-populated.png; note: an earlier view of this file was a stale cached read, the shot was
re-taken and re-checked):
- Colour richness 4/5: close to the reference palette; floor grain visible; cream back walls with teal
  wainscot and teal-slate low walls on three sides of the L.
- Room distinctness 4/5: the L now reads open on the left (low notch wall), hub screen reads "LEAD HUB"
  with a waiting count. Reception is still a plain white block next to the reference's marble and walnut.
- Character readability 3.5/5: people are ~1.12x scale and clearly posed (typing, phone with swivel and
  blue ring, cabin manager, standing visitor). Lounge sitters float above the sofa cushions (sofa seat
  0.39 m, clips assume a 0.47 m seat).
- Label cleanliness 4.5/5: zero overlaps; the "Not interested" outcome bubble sits in its own lane above
  the name tag.
- Lighting 4/5: warm and soft; monitors are flat pale rectangles while the reference screens glow with
  content.

Changed for iteration 04:
- Sofa and armchair cushions raised to the chair seat height.
- Monitor screens get UVs and a shared glowing dashboard texture (header bar, chart, rows), dimmed per
  seat when the person is away or offline.
- Reception counter: walnut front panel band under the marble top, larger logo, stronger glow.

## Iteration 04

Saw (medium-day-1440x900@1x-canvas.png and a DPR 2 close-up at focusPoint(9.5, 5.2, 3.2)):
- Monitors: the dashboard texture is mapped correctly (UV 0..1 on every `screen:<seatId>` quad, shared
  256x150 canvas). The close-up shows header bar, KPI tiles, bar chart and rows. At the default zoom a
  screen is about 15 px wide, so it reads as an indigo-blue block; many screens face away from the
  camera and show the dark monitor back. The "pale rectangle" seen in the iteration 04 review was the
  light dashboard on a white desk at DPR 1, not a mapping bug.
- Sofa sitters now sit on the cushions; the reception has a walnut band and a stronger glow.
- Zero label overlaps in every shot.

Iteration cap: the user's parallel-execution override (steer-658ea7f5) sets 3 iterations for a first
pass and moves the remaining polish to `docs/POLISH.md`. Phase A stops looping here; remaining items
(darker, higher-contrast screen content; reception marble; richer prop density) go to POLISH.md.

# Phase B: Evening, Small, Large and Flat (iterations 05 to 07)

Same GPU and scoring. Each new variant (Evening, Small, Large, Flat) had at most 3 fix iterations:
05 (first shots), 06 (full matrix), 07 (fixes, final). Every shot in 06 and 07 had 0 label overlaps
and 0 console errors (`iter-07/shots.json`, copied to `shots.json`). Final files are the top-level
PNGs in this folder; `compare-*.png` put the reference on the left.

## Evening (Dark theme), Medium

Iteration 05 (`medium-evening-1440x900@1x`): first Evening bake. Deep navy surroundings, warm sconce
and downlight pools on the oak, cool blue window light in the lounge and cabin, the hub and reception
edges glow. Monitors still used the light Day dashboard, so they read as white cards. The lightmap
used a 99.7th-percentile encoding scale and the dark majority lost precision (banding in the walnut).

Changed for 06: Evening map scale from the 99th percentile; downlights over every desk cluster and
the calling room; glow cards (fake bloom) on lamps, screens, hub ring and reception edge.

Iteration 06 (`compare-medium-evening.png`):
- Colour richness 4/5: warm oak pools against navy walls, teal wainscot still visible, green sofa
  reads. The reference has no night version; ours keeps its palette and only changes the light.
- Room distinctness 4/5: calling room glass and blue call rings stand out; the walnut cabin is dark
  but lit by its floor and desk lamps.
- Character readability 3.5/5: people read against the floor thanks to the rim light, but faces
  facing away from the camera are dark.
- Label cleanliness 5/5: dark pills from the theme tokens, 0 overlaps.
- Lighting 3.5/5: monitors read as pale rectangles (light dashboard texture at night).

Changed for 07: a dark Evening dashboard texture (navy with bright bars) swapped in when the blend
passes half way, screen level 1.7; stronger character rim (0.85) and fill.

Iteration 07 (`medium-evening-calling-room-zoom.png`): screens glow blue with visible bars, rim light
outlines heads and shoulders, booth rings and the hub read clearly. Score: colour 4, rooms 4,
characters 4, labels 5, lighting 4.

Cross-fade: `theme.mjs` records the Day/Evening blend each frame; Light to Dark completes in 388 ms
(21 partial frames), Dark to Light in 379 ms, instant with reduced motion (0 partial frames).
`medium-theme-crossfade-mid.png` is the blend held at 0.5.

## Small (8 seats)

Iteration 05 (`small-day-1440x900@1x`): module-composed office (4-desk pod, 2-booth calling room,
cabin, lounge, reception, hub plaza, print corner, 2-seat hot bench). Reads as the same product as
Medium. The hub sat close to the pod's south aisle and the Small Evening bake had no downlights over
the pod.

Changed for 06 and 07: pod downlights (all templates), hub moved 0.4 m west into the open floor.

Iteration 07 (`compare-small.png`):
- Colour richness 4/5, same materials as Medium.
- Room distinctness 4/5: lounge, glass calling room, walnut cabin, whiteboard corner and reception
  are all present in 14.4 x 10.4 m.
- Character readability 4/5: the small floor fits larger on screen, people are bigger than in Medium.
- Label cleanliness 5/5.
- Lighting 4/5 Day and Evening.
- Gap: the reception has nobody behind it unless the team has a viewer (by design of the seat rules).

## Large (50 seats)

Iteration 05 (`large-*-1440x900@1x`, 36 people): six 6-desk pods and two 4-desk pods around the hub
plaza, a 6-booth calling room, two manager cabins, two lounges, two print corners. One person per
desk with 1.4 m aisles. Labels: 0 overlaps but 20 of 31 tags were compact and one full tag was cut
by a neighbour's compact pill in the screenshot (a stale width while a call timer grew).
The Evening map was darker per square metre than Medium (few lamps for the floor area).

Changed for 06: low-priority tags start compact when more than 20 people are on screen at the fit
zoom (on call, needs-you and selected tags stay full); call timer tags re-measure every 0.5 s with a
fixed-width timer; corridor downlights and two downlights per 6-desk pod.

Changed for 07: Evening exposure 1.25 for Large (template `lighting.eveningExposure`).

Iteration 07 (`compare-large.png`):
- Colour richness 4/5.
- Room distinctness 3.5/5: at the fit zoom the 32 m floor is small on an 821 px canvas, so rooms read
  mostly by floor colour; zooming in shows the same detail as Medium.
- Character readability 3/5 at fit (people ~25 px tall), 4/5 one zoom step in.
- Label cleanliness 4.5/5: 0 overlaps, compact initials for most people, full names for calls.
- Lighting 4/5 (Evening now matches Medium's brightness).

## Flat view (all templates, mobile)

Iteration 05 (`flat-large-day-1440x900`, `mobile-flat-day`): the plan is drawn from the template
(rooms in the 3D floor colours, furniture, chairs, walls with glass and windows, the Lead Hub with
the waiting count, seat dots with status colours, rings for calls). The "Print corner" name ran past
the room on mobile.

Changed for 06 and 07: room names are skipped when they do not fit and get a halo in the floor
colour; dark palette with lighter oak and darker walnut so the cabin reads against the floor.

Iteration 07 (`flat-*-1440x900`, `mobile-flat-*`): clean plan for Small, Medium and Large in both
themes. Score: colour 4, rooms 4.5, people 4 (initials at desktop size, plain dots when small),
labels 5, lighting n/a. Keyboard path verified by `e2e/team-floor/flat.spec.ts` (one tab stop,
arrow keys, Enter opens the panel, focus returns on close); Pixel 7 gets Flat by default.

Iteration cap reached for all four variants. Leftover items are in `docs/POLISH.md`.
