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
