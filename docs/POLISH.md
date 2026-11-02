# Polish backlog

Items left after the first-pass screenshot loop (capped at 3 iterations by the parallel-execution override). Each section belongs to its owner agent; add your own section and do not edit others.

## Team Floor V3, Medium Day (frontend-3d)

Source: `docs/screenshots/team-floor-v3/CRITIQUE.md`, iterations 01 to 04.

- Monitor screens: at the default zoom a screen is about 15 px wide and reads as an indigo block. Use a darker, higher-contrast dashboard (dark navy with bright bars) so screens glow like the reference.
- Reception: the reference has a marble top over a walnut front. Ours has a white counter with a walnut band; add marble veining to the counter material.
- Prop density: the reference has more small props (desk clutter, wall art, plant variety). Add 2 or 3 small prop kinds to the instanced set within the 4 MB office budget.
- Characters scored 3.5/5 on readability in iteration 03. The reference figures have more outfit and face detail (collars, shoe shapes, facial shading).
- Evening bake (12.1 order: Day, then Evening): dark theme still uses the dimmed Day bake as an interim look.

## Board physics v2 (frontend-physics)

Source: `docs/screenshots/board-physics/` (final set, iteration 2 of 3; iteration 1 softened the target column ring from full accent to 50 %).

- Dark theme lift: the dragged card separates from the board mostly by its border; the `--elevation-drag` shadow is weak on the dark surface. A slightly stronger dark drag shadow (token owned by frontend-app) or a 1 px top highlight on the ghost would read better.
- Tilt on the dark ghost is hard to see at DPR 1 because the card edges are low contrast. Same fix as above.
- First drag after page load has one long frame (50 to 170 ms on a GeForce GT 710) while the overlay layer is created. Pre-warm the overlay layer on the first pointer hover over a card.
- Workflow builder node physics constants (lift, tilt gain, repulsion, throw) still live in `features/workflow-builder/physics/world.ts`; they use the shared spring presets but are not tunable from a config file or the demo page yet.
- Target column highlight is a ring only; a faint tint shift on the column body would make the drop target easier to spot on wide boards.
