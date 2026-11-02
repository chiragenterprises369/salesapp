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

## Iteration 2 (Neon/Dark and Aurora/Light, 1440x900 @1x)

Fixed from iteration 1: overdue is now a 3 px red leading edge with a faint outline, so columns keep
their stage colour; the dev indicator is gone; the lower part of each column lets the plate through.

Problems:
1. The office plate still reads as near black in Neon/Dark. Column glass at 60 % to 34 % plus the
   32 to 52 % backdrop tint hide most of it; only the gaps between columns show the scene.
2. Column bodies are neutral dark glass. The stage colour lives only on the edge and header, while the
   reference tints the whole column faintly in its stage colour.
3. Header slabs are flat; stage names are mixed case. The reference uses uppercase stage names on a
   header that carries the stage tint and fades into the column.
4. Columns sit 16 px apart, slightly tighter than the reference.
5. A plate already in the HTTP cache sometimes stayed hidden (onLoad fired before React attached it).

Changes for iteration 3: dark glass 52 % to 22 %, backdrop tint 26 to 46 %; light glass 58 % to 36 %;
full-height stage tint (edge colour at 6 %) on every column, neon floor glow 8 to 10 %; header slab
gradient from 18 % stage tint at the top to 5 % at 75 %; uppercase stage names with 0.04 em tracking;
column gap 18 px; backdrop marks itself ready when the cached image is already complete.

## Iteration 3, final (all 8 views: both themes, 1440x900 and 1920x1080, DPR 1 and 2)

Contrast audit before the fix (`iter-03/contrast-before-fix.json`, gitignored) failed one class: the
Aurora INR total in the column header was 3.7:1 (muted-strong text on the translucent New header).
Fix: the INR total uses `--fg-secondary` and the Aurora header backing mixes 12 % stage tint into 72 %
surface. After the fix every text class passes on both themes (`contrast.json`, lowest 5.53:1 for the
Aurora company line; lowest Neon/Dark 6.33:1, also the company line).

Matches the reference:
- Each column now reads as its stage colour end to end: saturated 2 px edge, glow, a faint tint over
  the whole body and a tinted header with an uppercase stage name, count pill and INR total.
- More of the office plate shows in the gaps and in the lower part of the stage in Neon/Dark; Aurora
  shows a bright, blurred office behind frosted columns.
- Cards keep the stage tint; overdue cards show the red leading edge and red follow-up line, hot leads
  breathe softly (CSS only, off in Depth, Flat and reduced motion).
- Text stays sharp at DPR 2; all text is DOM text.

Left for `docs/POLISH.md` (loop cap reached):
1. In Neon/Dark the office is still dimmer than in the reference behind the cards. Lowering the card
   slabs further would cut the company line margin (6.3:1) and make cards float less clearly.
2. At 1440x900 the fourth column is cut at the right edge and the board scrolls; the reference fits
   four columns. Column width belongs to the board layout, not the skin.
3. The mock data has many overdue leads, so red edges still appear on about a third of the cards.
4. The floor grid of the plate is visible only below the shortest column.
