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

Writes `apps/web/public/team-floor/templates/<id>.json` (`small`, `medium`, `large`). The JSON is
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
| `--preview` | Cycles preview render from the runtime camera to `.out/office-<id>-preview.png` |
| `--save-blend` | save `.out/office-<id>.blend` for inspection |

Outputs in `apps/web/public/team-floor/`: `office-<id>.glb`, `office-<id>-day.webp`,
`office-<id>-evening.webp`, `office-<id>-ao.webp` and `office-<id>.bake.json` (encoding scale per map,
triangle stats, timings, file sizes). Lightmap texels are `srgb(irradiance / scale)`; the runtime
multiplies by `scale * PI`.

Measured (Medium, 2048 px, 128 samples): build 20.8 s, Day bake 417 s, AO bake 120 s.

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
| `E2E_BASE_URL=http://localhost:3005 pnpm e2e e2e/team-floor --project=desktop` | label overlap test |
| `node e2e/team-floor/fps.mjs http://localhost:3005 30 10` | frame time with 30 people for 10 s |
| `node e2e/team-floor/theme.mjs http://localhost:3005 medium <dir>` | theme switch frames and console errors |
| `node e2e/team-floor/shoot.mjs --base http://localhost:3005 --iter 05 --theme light` | screenshot set into `docs/screenshots/team-floor-v3/iter-05/` (git-ignored) |
| `node e2e/team-floor/compare.mjs <ours.png> <out.png> "<caption>"` | reference-left, ours-right comparison sheet |

The scripts sign in with the mock persona and set `localStorage['vistar.floor.qa'] = '1'`, which
enables the `window.__vistarFloor` QA hook and the `?floorTemplate`, `?floorStress`, `?floorMode`
and `?floorTier` URL overrides in production builds.
