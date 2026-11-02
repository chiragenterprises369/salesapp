# Team Floor asset pipeline (SPEC 12.1)

Everything under `apps/web/public/team-floor/` is rebuilt from this folder. Scripted Blender runs
are the source of truth (`blender --background --factory-startup`); the live Blender MCP is only for
inspection. Output that is not shipped goes to `scripts/team-floor/.out/` (git-ignored).

Tools: Node 22 (repo root), Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`
(Cycles on CPU; the GT 710 is too old for Cycles GPU). Timings below are from an Intel i5-14400F
(10 cores, 16 threads) with 8 GB RAM.

```powershell
$blender = 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
```

## 1. Floor templates (JSON)

```powershell
node scripts/team-floor/templates/build-templates.mjs --svg   # < 1 s
node scripts/team-floor/preview-plan.mjs medium                # optional PNG of the SVG plan
```

Writes `apps/web/public/team-floor/templates/<id>.json` (`small`, `medium`, `large`) and
`templates/modules.json` (module kit catalogue). Medium is hand-composed after the reference render;
Small (8 seats) and Large (50 seats) are composed from the module kit in `templates/modules.mjs
(`sales_pod`, `calling_room`, `manager_cabin`, `lounge`, `reception`, `hub_plaza`, `print_corner`,
`hot_bench`) by `templates/composed.mjs`; every placement is stored under `modules` in the template
(D-054, extended by the 28.3 kit). The JSON is
the single source of truth: the Blender build reads it for geometry and the web runtime validates it
with zod (`features/team-floor/state/template.ts`). The script fails (exit 1) when a seat has no
visible graph node, a waypoint sits inside furniture or a node is unreachable from the entrance.

## 2. Office GLB and lightmaps

```powershell
& $blender --background --factory-startup --python scripts/team-floor/blender/build_office.py -- `
  --template medium --bake --samples 128 --size 2048 --export
```

One run builds the geometry from the template, culls faces the fixed camera never sees, unwraps the
lightmap UVs, bakes in Cycles and exports. Flags:

| Flag | Effect |
| --- | --- |
| `--template <id>` | `small`, `medium` or `large` |
| `--bake` | bake the Day lightmap and AO (Evening too, see `--variants`) |
| `--variants day,evening` | lit variants to bake (default `day,evening`) |
| `--samples <n>` | Cycles samples for the lit bakes (AO uses half) |
| `--size <px>` | lightmap size (square) |
| `--export` | write the Draco GLB with WebP textures |
| `--preview [--light day\|evening] [--preview-samples 48]` | Cycles preview render from the runtime camera to `.out/office-<id>-<light>-preview.png` |
| `--save-blend` | save `.out/office-<id>.blend` for inspection |

Outputs in `apps/web/public/team-floor/`: `office-<id>.glb`, `office-<id>-day.webp`,
`office-<id>-evening.webp`, `office-<id>-ao.webp` and `office-<id>.bake.json` (encoding scale per map,
triangle stats, timings, file sizes). Lightmap texels are `srgb(irradiance / scale)`; the runtime
multiplies by `scale * PI`.

All templates, one after the other (validates the templates first):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/team-floor/bake-all.ps1 [-Templates small,medium,large]
``

Settings and measured timings (whole run = build + Day + Evening + AO + export; the spread comes
from other work on the machine during some runs):

| Template | Size | Samples | Build | Day | Evening | AO | Whole run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| small | 2048 | 128 | 10.5 s | 91 to 104 s | 98 to 106 s | 26 to 141 s | 4.0 to 6.5 min |
| medium | 2048 | 128 | 8 to 32 s | 90 to 473 s | 129 to 397 s | 32 to 130 s | 6.2 to 15.7 min (6.2 min on an idle machine) |
| large | 3072 | 96 | 20 to 82 s | 136 to 199 s | 152 to 153 s | 61 to 72 s | 6.9 to 8.5 min |

The Evening lightmap stores `srgb(irradiance / scale)` with its own scale (99th percentile of the
bake), Day uses scale 2.0. Large sets `lighting.eveningExposure` 1.25 in its template.
Per-template bakes fit every budget, so modules do not share bakes (`docs/ASSETS.md`).

## 3. Characters GLB

```powershell
& $blender --background --factory-startup --python scripts/team-floor/blender/build_characters.py -- --export
```

Writes `apps/web/public/team-floor/characters.glb` (shared armature, two builds x two sleeve
lengths, hair variants, phone and document props, 11 looping clips). `--preview` renders one PNG per
clip to `.out/characters/`; `node scripts/team-floor/contact-sheet.mjs scripts/team-floor/.out/characters <out.png>`
puts them on one sheet.

## 4. Draco decoder

`apps/web/public/team-floor/draco/` is a copy of `three/examples/jsm/libs/draco/gltf/` from the
installed `three` version (Google Draco, Apache-2.0). Refresh it when `three` is upgraded.

## 5. Checks and screenshots (frontend-3d, `e2e/team-floor/`)

Build and start the web app first: `pnpm --filter @vistar/web build`, then
`pnpm --filter @vistar/web exec next start -p 3005`.

| Command | What it does |
| --- | --- |
| `node e2e/team-floor/bundle-check.mjs` | three/R3F are not in the initial chunks of `/app/team-floor` and `/me/team-floor` |
| `E2E_BASE_URL=http://localhost:3005 pnpm e2e e2e/team-floor` | label overlaps (Small, Medium, Large x Light, Dark) and the flat view keyboard path (desktop) and default (Pixel 7) |
| `node e2e/team-floor/fps.mjs http://localhost:3005 30 10 medium dark` | frame time with N people for 10 s (template and theme optional) |
| `node e2e/team-floor/theme.mjs http://localhost:3005 medium <dir> [--reduced]` | Day/Evening cross-fade per frame, mid-fade frame, console errors; instant with `--reduced` |
| `node e2e/team-floor/matrix.mjs --base http://localhost:3005 --iter 08 [--group medium\|small\|large\|flat]` | full screenshot matrix into `docs/screenshots/team-floor-v3/iter-08/` (git-ignored) |
| `node e2e/team-floor/shoot.mjs --base http://localhost:3005 --iter 05 --theme light` | Medium-only set (Phase A) |
| `node e2e/team-floor/compare.mjs <ours.png[,ours2.png]> <out.png> "<caption>[\|caption 2]"` | reference-left comparison sheet |

The scripts sign in with the mock persona and set `localStorage['vistar.floor.qa'] = '1'`, which
enables the `window.__vistarFloor` QA hook and the `?floorTemplate`, `?floorStress`, `?floorMode`
and `?floorTier` URL overrides in production builds.

## Company floors (change #19: layout_json, GLB, glTF)

A company's own floor is published from the Super Admin panel (`/super-admin/floors`) and loaded at
runtime (`features/team-floor/state/layout/published.ts`); nothing is baked. A Vistar floor plan JSON
(written by an AI chat from the office photos with `FLOOR_PLAN_PROMPT`) is drawn from the module kit
(`scene/kit/`), a GLB or zipped glTF as uploaded. The sample plan an AI chat would return for a 24 x 16 m
office is `apps/web/public/team-floor/samples/sample-office.json` (32 seats, 7 rooms).

| Command | What it does |
| --- | --- |
| `E2E_BASE_URL=http://localhost:3005 E2E_API_MODE=1 pnpm e2e team-floor/published-floor --project=desktop` | request with photos, prompt copy, plan validation, upload, seat tool, preview, publish, company floor, office markers (API mode) |
| `node e2e/team-floor/published-shots.mjs --base http://localhost:3005` | Day and Evening screenshots (3D page, canvas, flat) of the published floor, signed in as the company admin |
| `node e2e/team-floor/published-shots.mjs --base http://localhost:3005 --qa` | same with the sample plan and a mock persona (build with `NEXT_PUBLIC_ALLOW_MOCK_DATA=1`) |
| `/app/team-floor?floorPlan=/team-floor/samples/sample-office.json` | QA preview of a plan without the API (dev, or `vistar.floor.qa` = 1) |
