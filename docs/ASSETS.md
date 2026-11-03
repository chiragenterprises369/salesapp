# Assets and licenses

Every file the product ships under `apps/web/public/team-floor/` (Live Team Floor, SPEC 12.1), plus
reference material kept in `docs/`. Original work is "Vistar original, project-owned": modelled,
textured, rigged and baked by scripts in `scripts/team-floor/` (rebuild steps and timings in
`scripts/team-floor/README.md`). No third-party models, textures or fonts are used in the floor; the
only third-party file is the Draco decoder.

## Shipped (`apps/web/public/team-floor/`)

| Name | File | Source | Author | License | Link | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Small office (geometry, materials, procedural tiling textures) | `office-small.glb` | `scripts/team-floor/blender/build_office.py`, `props.py`, `textures.py` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 412 KB |
| Small Day lightmap (Cycles bake) | `office-small-day.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 272 KB |
| Small Evening lightmap (Cycles bake) | `office-small-evening.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 465 KB |
| Small ambient occlusion (Cycles bake) | `office-small-ao.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 208 KB |
| Medium office | `office-medium.glb` | `build_office.py`, `props.py`, `textures.py` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 465 KB |
| Medium Day lightmap | `office-medium-day.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 271 KB |
| Medium Evening lightmap | `office-medium-evening.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 451 KB |
| Medium ambient occlusion | `office-medium-ao.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 225 KB |
| Large office | `office-large.glb` | `build_office.py`, `props.py`, `textures.py` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 692 KB |
| Large Day lightmap (3072 px) | `office-large-day.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 449 KB |
| Large Evening lightmap (3072 px) | `office-large-evening.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 1,054 KB |
| Large ambient occlusion (3072 px) | `office-large-ao.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 395 KB |
| Bake metadata (encoding scale per map, stats, timings) | `office-small.bake.json`, `office-medium.bake.json`, `office-large.bake.json` | `build_office.py` | Vistar (frontend-3d) | Vistar original, project-owned | - | 2 KB each |
| Characters (shared rig, 2 builds x 2 sleeve lengths, 4 hair styles, phone and document props, 11 clips) | `characters.glb` | `scripts/team-floor/blender/build_characters.py` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 709 KB |
| Floor templates | `templates/small.json`, `templates/medium.json`, `templates/large.json` | `scripts/team-floor/templates/build-templates.mjs` (Small and Large from `modules.mjs` and `composed.mjs`) | Vistar (frontend-3d) | Vistar original, project-owned | - | 33 KB, 35 KB, 120 KB |
| Module kit catalogue (D-054) | `templates/modules.json` | `scripts/team-floor/templates/modules.mjs` | Vistar (frontend-3d) | Vistar original, project-owned | - | 3 KB |
| Draco mesh decoder (glTF build) | `draco/draco_decoder.js`, `draco/draco_decoder.wasm`, `draco/draco_wasm_wrapper.js` | Copied from `three@0.187.0/examples/jsm/libs/draco/gltf/` | Google (Draco authors) | Apache License 2.0 | https://github.com/google/draco | 746 KB (the browser loads the 188 KB wasm + 57 KB wrapper; the 500 KB asm.js file is the fallback) |

Runtime-drawn textures (no files, Vistar original): monitor dashboards (Day and Evening), the Lead
Hub screen, glow cards, light pools and contact shadows are drawn on canvases in
`features/team-floor/scene/office.ts` and `scene/glow.ts`. The flat plan is SVG drawn from the
template (`flat/floor-map.tsx`).

## Budgets (SPEC 12.1)

| Item | Budget | Small | Medium | Large |
| --- | --- | --- | --- | --- |
| Office GLB | 4 MB | 412 KB | 465 KB | 692 KB |
| Characters GLB (shared) | 2 MB | 709 KB | 709 KB | 709 KB |
| Light theme lightmaps (Day + AO) | 2 MB | 480 KB | 496 KB | 844 KB |
| Dark theme lightmaps (Evening + AO) | 2 MB | 673 KB | 676 KB | 1,449 KB |

Every template has its own bakes (no shared module bakes): all three fit the budgets, and per-template
bakes keep contact shadows and light pools correct where modules meet.

## Shipped by the API: PDF fonts (`apps/api/assets/fonts/`, D-071)

| Name | File | Source | Author | License | Link | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Noto Sans Regular (Latin, Greek, Cyrillic, rupee sign) | `NotoSans-Regular.ttf` | npm `@expo-google-fonts/noto-sans@0.4.2` (`400Regular/NotoSans_400Regular.ttf`, Google Fonts build) | The Noto Project Authors | SIL Open Font License 1.1 (`OFL-NotoSans.txt`) | https://github.com/notofonts/latin-greek-cyrillic | 614 KB |
| Noto Sans Bold | `NotoSans-Bold.ttf` | same package (`700Bold/NotoSans_700Bold.ttf`) | The Noto Project Authors | SIL OFL 1.1 (`OFL-NotoSans.txt`) | https://github.com/notofonts/latin-greek-cyrillic | 616 KB |
| Noto Sans Devanagari Regular | `NotoSansDevanagari-Regular.ttf` | npm `@expo-google-fonts/noto-sans-devanagari@0.4.2` (`400Regular/...`) | The Noto Project Authors | SIL OFL 1.1 (`OFL-NotoSansDevanagari.txt`) | https://github.com/notofonts/devanagari | 212 KB |
| Noto Sans Devanagari Bold | `NotoSansDevanagari-Bold.ttf` | same package (`700Bold/...`) | The Noto Project Authors | SIL OFL 1.1 (`OFL-NotoSansDevanagari.txt`) | https://github.com/notofonts/devanagari | 213 KB |

The API reads them once per process (`apps/api/src/modules/documents/pdf/fonts.ts`; override the folder with
`PDF_FONT_DIR`) and embeds only the glyphs a document uses (subset TrueType, Type0 / Identity-H with a ToUnicode
map). The OFL allows bundling and embedding; the fonts keep their names and are not sold on their own. A
deployment must copy `apps/api/assets/` next to `apps/api/dist/`.

## Reference material (not shipped)

| Name | File | Source | License | Use |
| --- | --- | --- | --- | --- |
| Team Floor V3 reference render | `docs/screenshots/team-floor-v3/reference.jpg` | AI concept render supplied by the user (change #16) | Reference only, never shipped | Comparison sheets |
