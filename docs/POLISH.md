# Polish backlog

Items left after the first-pass screenshot loop (capped at 3 iterations by the parallel-execution override). Each section belongs to its owner agent; add your own section and do not edit others.

## Team Floor V3 (frontend-3d)

Source: `docs/screenshots/team-floor-v3/CRITIQUE.md`, iterations 01 to 07.

Medium Day:
- Reception: the reference has a marble top over a walnut front. Ours has a white counter with a walnut band; add marble veining to the counter material.
- Prop density: the reference has more small props (desk clutter, wall art, plant variety). Add 2 or 3 small prop kinds to the instanced set within the 4 MB office budget.
- Characters scored 3.5 to 4 out of 5 on readability. The reference figures have more outfit and face detail (collars, shoe shapes, facial shading).

Evening:
- Faces turned away from the camera stay dark at night; a second, warmer rim from the desk side would help.
- Bloom is done with glow cards on emissive sources (no post-processing pass). A real selective bloom pass on the high tier would give softer halos around the hub and reception edge.
- The Lead Hub drum interior renders near black in Evening; give the glass drum a faint emissive core.

Small:
- The reception stays empty unless the team has a viewer (seat rules). Consider a receptionist placeholder or a plant arrangement when nobody is assigned.

Large:
- At the fit zoom on a 1440x900 screen people are about 25 px tall; most tags are compact initials. A default view slightly zoomed into the busiest pods (with Fit one click away) would read better.
- Room names are not drawn in 3D; on a floor this size small signs over the calling room and cabins would help orientation.
- 6-desk pods repeat the same desk variant pattern; vary desk accessories per pod.

Flat:
- The plan is decorative for assistive tech (the accessible list carries the data). Clicking a seat dot opens the person; hovering shows the name as an SVG title only.
- Lounge sitters and booth callers are drawn at their spots, but people walking between spots in 3D jump directly in the plan (no walk animation, by design for reduced motion).

## Board physics v2 (frontend-physics)

Source: `docs/screenshots/board-physics/` (final set, iteration 2 of 3; iteration 1 softened the target column ring from full accent to 50 %).

- Dark theme lift: the dragged card separates from the board mostly by its border; the `--elevation-drag` shadow is weak on the dark surface. A slightly stronger dark drag shadow (token owned by frontend-app) or a 1 px top highlight on the ghost would read better.
- Tilt on the dark ghost is hard to see at DPR 1 because the card edges are low contrast. Same fix as above.
- First drag after page load has one long frame (50 to 170 ms on a GeForce GT 710) while the overlay layer is created. Pre-warm the overlay layer on the first pointer hover over a card.
- Workflow builder node physics constants (lift, tilt gain, repulsion, throw) still live in `features/workflow-builder/physics/world.ts`; they use the shared spring presets but are not tunable from a config file or the demo page yet.
- Target column highlight is a ring only; a faint tint shift on the column body would make the drop target easier to spot on wide boards.

## Leads Board Neon Space skin (frontend-physics, NEON-SKIN, SPEC 28.1)

Source: `docs/screenshots/leads-neon/CRITIQUE.md` (final set, iteration 3 of 3; contrast audit in `contrast.json` passes on Neon/Dark and Aurora/Light).

- Neon/Dark: the office plate is still dimmer behind the cards than in reference Image A. Card slabs could drop a few percent of opacity, but the company line (6.3:1 now) loses margin and cards float less clearly; retest with `contrast.mjs` after any change.
- At 1440x900 the fourth column is cut at the right edge and the board scrolls horizontally; the reference fits four columns. Needs a narrower Neon column width or a smaller stage padding in the board layout.
- Mock data marks about a third of the leads overdue, so red leading edges show on many cards in screenshots. Real tenants will see fewer; no skin change planned.
- The plate's floor grid shows only below the shortest column; a short fade at the column foot would show more of it.
- Aurora/Light: the blurred plate reads as a soft grey-blue wash; a slightly warmer light plate would feel closer to the reference's "space" look.
- Drop frames (`fps.json`, GeForce GT 710): the drag itself holds 60 fps (p95 16.8 ms), but the drop has a few long frames (p95 50 ms, max 183 ms) while the card lands and both columns re-render. Profile the drop commit with glow on.

## Board event celebrations, SPEC 28.1 (frontend-physics)

Source: `docs/screenshots/leads-neon/events/CRITIQUE.md` (3 iterations; the final frames capture commit 869028e).

- New lead: the stream-in starts at the board's left edge, so the canvas bounds clip most of the ribbon. Give the canvas a margin to the left of New, or start the ribbon from the toolbar's "New lead" button.
- Won: the burst covers the Won header (count and total) and the top card's name for about a second. Raise the shells into the toolbar band above the header.
- Quote sent: the envelope ends on the column total for about 300 ms. End it beside the total.
- Lost: the slivers are plain triangles. Strips with a straight cut edge would read more like a torn card.
- Stage move: on the Neon Space skin, a wider ribbon with a few sparks would match the reference more closely. Depth keeps the thin trail.
- Neon Space and Aurora event frames need the skin branch. Capture them after the merge (`capture.mjs --skin=neon` only switches the canvas palette).
- Stress FPS: a few frames of 67 to 117 ms appear when 5 wins and 3 moves patch the 2,500-lead board within half a second (p95 stays 16.8 ms). Profile whether the board re-render or the diff (`diffBoards` walks every loaded card) causes them; a per-column diff that skips unchanged columns by reference would be the first thing to try.
