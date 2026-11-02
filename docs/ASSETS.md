# Assets and licenses

Every file the product ships under `apps/web/public/team-floor/` (Live Team Floor, SPEC 12.1), plus
reference material kept in `docs/`. Original work is "Vistar original, project-owned": modelled,
textured, rigged and baked by scripts in `scripts/team-floor/` (rebuild steps in
`scripts/team-floor/README.md`). No third-party models, textures or fonts are used in the floor.

## Shipped (`apps/web/public/team-floor/`)

| Name | File | Source | Author | License | Link | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Medium office (geometry, materials, tiling textures) | `office-medium.glb` | `scripts/team-floor/blender/build_office.py`, `props.py`, `textures.py` (procedural numpy textures) | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 465 KB |
| Medium Day lightmap (Cycles bake) | `office-medium-day.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 275 KB |
| Medium ambient occlusion (Cycles bake) | `office-medium-ao.webp` | `build_office.py --bake` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/README.md` | 225 KB |
| Medium bake metadata | `office-medium.bake.json` | `build_office.py` | Vistar (frontend-3d) | Vistar original, project-owned | - | 2 KB |
| Characters (shared rig, body and hair variants, 11 clips) | `characters.glb` | `scripts/team-floor/blender/build_characters.py` | Vistar (frontend-3d) | Vistar original, project-owned | `scripts/team-floor/blender/` | 709 KB |
| Floor template, Medium | `templates/medium.json` | `scripts/team-floor/templates/build-templates.mjs` | Vistar (frontend-3d) | Vistar original, project-owned | - | 34 KB |
| Draco mesh decoder (glTF build) | `draco/draco_decoder.js`, `draco/draco_decoder.wasm`, `draco/draco_wasm_wrapper.js` | Copied from `three@0.187.0/examples/jsm/libs/draco/gltf/` | Google (Draco authors) | Apache License 2.0 | https://github.com/google/draco | 746 KB (the browser loads the 188 KB wasm + 57 KB wrapper; the 500 KB asm.js file is the fallback) |

Runtime-drawn textures (no files): monitor dashboards, the Lead Hub screen, light pools and contact
shadows are drawn on canvases in `features/team-floor/scene/office.ts` (Vistar original).

## Budgets (SPEC 12.1)

| Item | Budget | Now |
| --- | --- | --- |
| Office GLB per template | 4 MB | Medium 465 KB |
| Characters GLB | 2 MB | 709 KB |
| Lightmaps per theme (lit map + AO) | 2 MB | Medium Day 500 KB |

## Reference material (not shipped)

| Name | File | Source | License | Use |
| --- | --- | --- | --- | --- |
| Team Floor V3 reference render | `docs/screenshots/team-floor-v3/reference.jpg` | AI concept render supplied by the user (change #16) | Reference only, never shipped | Comparison sheets |
