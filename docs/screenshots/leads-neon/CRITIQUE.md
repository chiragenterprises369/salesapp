# Leads Board "Neon Space" screenshot critique (SPEC 28.1, skin half)

Reference: Image A (`references/IMG_3064.PNG` per SPEC 28; on disk the neon board is `IMG_3066.PNG`,
the two files are swapped). Compared on the skin only; event animations belong to the celebrations half.
Loop capped at 3 iterations (change #18). Iteration folders `iter-01..03` are gitignored; the final set is
at the top level of this folder.

## Iteration 1 (Neon/Dark and Aurora/Light, 1440x900 @1x)

Matches the reference:
- Tall glass columns with 2 px saturated edges in the spec colours (New blue, Contacted cyan,
  Interested amber, Quote sent indigo), soft outer glow and an inner glow that stays at the edge.
- Dark card slabs tinted by their column, bright top edge, bold name, value right-aligned, company,
  chips and the follow-up line. All text is DOM text.
- Rounded stage panel with the space backdrop; Board | Table toggle unchanged.

Problems:
1. The overdue edge is a full red border on most cards (the mock data has many past follow-ups), so red
   outlines compete with the stage colours in both themes. The reference keeps cards in the column colour.
2. The office plate is hardly visible: the tint (52 to 70 %) plus 64 % column glass leave the backdrop
   almost black. The reference shows the office clearly through the glass.
3. The floor grid is hidden behind full-height columns.
4. Aurora: the white wash is so strong that the office reads as a grey smear; columns are close to opaque.
5. The Next.js dev indicator shows in the corner (dev server only).

Changes for iteration 2: overdue becomes a 3 px red leading edge plus a faint red outline; tint lowered
to 32 to 62 % (dark) and 46 to 70 % (light); column glass fades from 60 % to 34 % toward the floor so
the plate and the grid show through the lower part; dev indicator hidden in captures.
