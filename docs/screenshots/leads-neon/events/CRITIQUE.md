# Board event celebrations: frame critique (SPEC 28.1)

Frames: mid-animation, 1440x900, DPR 1, Depth skin (the default), triggered from the Celebrations panel of `/dev/board-physics` on a production build (`next start`, port 3004). Script: `capture.mjs` in this folder (`node docs/screenshots/leads-neon/events/capture.mjs http://localhost:3004 docs/screenshots/leads-neon/events`).

| Event | Dark | Light |
| --- | --- | --- |
| New lead | `dark-new-lead.png` | `light-new-lead.png` |
| Stage move | `dark-stage-move.png` | `light-stage-move.png` |
| Quote sent | `dark-quote-sent.png` | `light-quote-sent.png` |
| Won | `dark-won.png` | `light-won.png` |
| Lost | `dark-lost.png` | `light-lost.png` |

Loop: 3 iterations (`iter-01` to `iter-03`, local only, gitignored). The fixes from the iter-03 review (longer stream-in ribbon with two side strands, a solid envelope with speed lines, a larger rupee glyph with a soft halo, Lost as tinted glass slivers, solid pieces painted normally on dark) are in commit 869028e. The frames in this folder are a capture of that committed code with no further changes. What is still open is listed under "Leftovers" and in `docs/POLISH.md`.

Reference: SPEC 28 names `references/IMG_3064.PNG` as Image A (neon Leads Board). In the checkout the two files are swapped: `IMG_3064.PNG` is the multi-floor office, and the neon board is `IMG_3066.PNG`. These notes compare against the neon board (`IMG_3066.PNG`). The reference shows the Neon Space skin, which another worktree builds, so the comparison is about the effects, not the columns.

## Per frame

**New lead.** An amber (IndiaMART) glowing card outline rides a ribbon into the top slot of New, tilts level and shrinks onto the real card, then a ring and a little dust mark the landing. In light it is a pastel outline with no glow, as Aurora asks. Compared with the reference, ours is much smaller and calmer. The reference streams several large glowing cards from off-board across the first column, and ours starts at the board's left edge, so most of the ribbon is clipped by the canvas bounds (the canvas covers the board root only). For a moment the ribbon's side strand crosses the lead name. The real text stays readable under it because the canvas never draws fake text.

**Stage move.** The card flies its usual arc (board physics) and a thin ribbon in the target stage colour trails it. Dark: amber into Interested. Light: blue into Contacted. On arrival a single ring pulses. It reads as a light trail. The reference ribbon is a thick multicolour light beam with sparks. Ours is deliberately thin on Depth, and most of it is hidden under the flying card, which is drawn above the canvas.

**Quote sent.** A small paper envelope with an indigo outline (and a glow on dark) flies from the card's top-right corner to the column header and dissolves into dust. A ring pulses around the card. This matches the reference idea (an envelope flying into Quote sent), at about a third of its size. For about 300 ms the envelope sits over the header total (₹3.1Cr).

**Won.** Three shells of sparks burst over the Won header (stage green, gold, accent), with confetti on Full and a rising green ₹ glyph. A "Won ₹2.5Cr" chip above the column counts up to the new total. It is short (1.6 s), and the Won limit holds (one burst per 2 s, the fifth of five skipped). The burst sits over the header and the top card, so for about a second the header count, the total and the top card's name are partly covered by sparks. In the reference the fireworks go off above the column, in the toolbar band.

**Lost.** The card dims to 20% and nine glass slivers in the card colour with stage-red edges peel off and fall a short way. Then the card fades back in as it settles in Lost. There is no red flash and no full-screen effect. The slivers are plain triangles. The reference shreds the card into torn strips with a red particle swirl. Ours is quieter on purpose ("no gore, no harsh red flash"), but the slivers could look more like torn card pieces.

## Safety checks seen in the frames
- No flashes: particles fade in over 80 ms and fade out over the last 40% of their life, and rings are one fading pulse. Arrival pulses are limited to 3 per second, and anything over that becomes a plain fade.
- Nothing covers the full screen. The canvas is clipped to the board and never takes pointer events.
- Real text is never painted on the canvas. The ₹ glyph is the only drawn character, and the Won total is DOM text.

## Performance (`fps.mjs`, results in `fps.json` and `fps-gpu.json`)
"Won x5 + 3 moves" on the 2,500-lead stress board, 1440x900 DPR 1, intensity Full, about 8.5 s of effects (4 bursts, 1 skipped):

| Renderer | Theme | Avg frame | FPS | p95 | Worst | Frames over 33 ms | Peak particles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SwiftShader (headless default) | dark | 17.6 ms | 57 | 16.8 ms | 66.7 ms | 10 | 131 |
| SwiftShader (headless default) | light | 17.0 ms | 59 | 16.8 ms | 33.4 ms | 2 | 140 |
| GeForce GT 710 (D3D11) | dark | 17.5 ms | 57 | 16.8 ms | 116.7 ms | 6 | 129 |
| GeForce GT 710 (D3D11) | light | 17.5 ms | 57 | 16.8 ms | 100 ms | 8 | 132 |

The quality tier stayed High in every run. The live particle count never went above the cap of 300: the highest reading was 140, and the over-cap frame count was 0. The long frames are probably the 2,500-card board re-rendering for the data patches (5 wins and 3 moves within half a second). That was not profiled separately. The p95 holds at 16.8 ms in every run.

## Leftovers (also in docs/POLISH.md)
1. New lead: let the stream-in start outside the board (a canvas margin to the left of New, or start the ribbon from the toolbar's "New lead" button), so the ribbon is visible before it reaches the card.
2. Won: raise the burst into the toolbar band above the header, so the count, the total and the top card stay clear.
3. Quote sent: end the envelope beside the header total, not on it.
4. Lost: make the slivers look like torn card pieces (strips with a straight cut edge) instead of plain triangles.
5. Stage move: on the Neon Space skin, a wider ribbon with a few sparks would match the reference more closely. Depth should stay thin.
6. These frames use the Depth skin. Neon Space and Aurora frames need the skin branch, so capture them after the merge (`capture.mjs --skin=neon` only switches the canvas palette).
