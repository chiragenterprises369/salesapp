# Ownership

Stay inside your folders. Never edit another owner's files; request changes through the orchestrator.
Read anything in the repo when you need it. Contracts are listed in CONTRACTS.md.

## What each agent reads (spec scope)

Your requirements are ONLY: your sections of `docs/SPEC.md` (below) + `CONTRACTS.md` + the skills
`SKILLS.md` lists for you. Do not use chat history as spec. Everyone also reads SPEC sections
2.3 (rules) and 4 (design system) when doing UI work. If something you need is not in your sections,
ask the orchestrator; do not guess from other sections.

| Agent | `docs/SPEC.md` sections |
| --- | --- |
| backend-core | 2.3, 5, 6.2, 7, 8 (API), 9 and 10 (API), 11.2, 15.2, 15.4, 15.6, 15.7 (API), 19 (publishing), 20.1-20.3, 22 (API) |
| realtime-integrations | 2.3, 5.4, 12 (snapshot + events), 14, 15.1, 15.5, 19, 20.2, 20.3, 27 (27.1, 27.2 inbound webhook, 27.3 channels, 27.7, 27.9) |
| workflow-engine | 2.3, 5.4, 13, 15.5 (triggers, outbound webhook action), 19, 20.2, 20.3, 27 |
| frontend-app | 2.3, 4, 5.3, 6, 7 (UI), 8, 9.1-9.3, 9.5, 9.6, 10, 15.2-15.7 (UI), 17, 22 (settings, records and registry UI), 27.1 (Connections settings UI) |
| frontend-physics | 2.3, 4, 9.1-9.4, 11, 13.1, 13.2, 13.4, 13.5, 27.5, 27.6 (UI), 27.8 |
| frontend-3d | 2.3, 4, 12 (incl. 12.1 art target V3), 17 (Team Floor item), 19 (consuming events) |
| qa-reviewer | 2.3, 2.4, 4.5, 5, 6, 20.2, 20.3 (+ the sections of the area under review) |
| asset-generator | 2.3, 4.1, 18 |
| superadmin-panel | 2.3, 4, 5, 6, 15.7 (audit, billing usage), 16 |
| orchestrator | all |

`docs/` (SPEC, CHANGELOG, STATUS) is owned by the orchestrator.

## Branches and worktrees

- Each agent works on branch `agent/<name>` in worktree `.worktrees/<name>` (gitignored), created by the orchestrator from `main` at the start of a wave.
- Small commits on your branch only. The orchestrator merges into `main` after each wave, then everyone rebases.
- Dependencies are pre-installed. Need a new one? Request it (name, version, why); the orchestrator adds it on `main` so `pnpm-lock.yaml` never conflicts.

## Web (`apps/web`)

| Path | Owner | Notes |
| --- | --- | --- |
| `app/layout.tsx`, `app/page.tsx`, `app/globals.css` | frontend-app | Keep `getThemeBootScript()` first in `<head>` |
| `app/(auth)/**` | frontend-app | login, signup, invite accept, super admin login screen |
| `app/(company)/app/**` | frontend-app | Company panel pages and layout |
| `app/(employee)/me/**` | frontend-app | Employee panel (PWA, bottom nav) |
| `app/(super-admin)/super-admin/**` | superadmin-panel | Wave 1: frontend-app may create the layout shell and placeholder pages; ownership moves to superadmin-panel when it starts (Phase 9) |
| `app/(dev)/kit/**` | orchestrator | UI kit preview |
| `components/**` (except below) | frontend-app | shell (sidebar, top bar, bottom nav), leads page shell, Table view, lead detail, dashboard, reports, settings |
| `components/ui/**` | orchestrator | base kit, read-only |
| `components/leads-shared/**` | orchestrator | shared lead actions contract |
| `features/pipeline/**` | frontend-physics | Board view (`LeadsBoardView`), kanban physics |
| `features/workflow-builder/**` | frontend-physics | React Flow builder (Wave 2 adds data picker, run timeline UI, templates gallery: SPEC 27) |
| `features/shared/physics/**` | frontend-physics | Shared spring/drag physics used by the Board and the builder (SPEC 11.1) |
| `app/(dev)/dev/board-physics/**` | frontend-physics | Physics demo page (sliders, slow motion) |
| `app/(company)/app/settings/{industry,fields,labels,objects}/**`, `app/(company)/app/objects/**`, `app/(company)/app/x/**`, `app/(employee)/me/x/**`, `app/(super-admin)/super-admin/(console)/packs/**`, `components/{customization,packs}/**` | frontend-app | Industry Packs UI: settings, records pages, pack page host, Super Admin registry (SPEC 22) |
| `lib/customization/**`, `lib/packs/**`, `lib/mock-db.ts` | orchestrator | Data hooks and extension points (`usePackRuntime`, `PackPage`, `WidgetSlot`, `ui-index.ts`), shared mock store |
| `app/(company)/app/settings/connections/**` | frontend-app (Wave 2, planned) | Connections vault UI (SPEC 27.1) |
| `features/team-floor/**` | frontend-3d | R3F floor + flat fallback |
| `public/team-floor/**` | frontend-3d | Team Floor GLB scene, characters, baked lightmaps, floor templates, Draco/Basis decoders (SPEC 12.1) |
| `lib/auth/**`, `lib/theme/**`, `lib/api/**` | frontend-app | session (mock in Wave 1), theme system, HTTP client |
| `lib/realtime/**` | realtime-integrations (client side, Wave 2) | socket client + cache updaters; orchestrator wires in Wave 3 |
| `lib/cn.ts`, `lib/use-*.ts`, `lib/query-client.tsx`, `lib/leads/**` | orchestrator, except `lib/leads/mock-realtime.ts` (frontend-physics, REQUESTS #10) | shared hooks and Leads data layer |
| `lib/world/**` | frontend-app | mock world readers, scope rules and hooks (dummy data for every screen) |
| `public/generated/**` | asset-generator | generated images + `assets.json` |
| `public/**` (other) | frontend-app | PWA manifest, icons, service worker |
| `tests/**` | qa-reviewer | unit/component tests |
| `styles/**` (tokens.css generated from shared tokens), shell layout (`components/shell/**`, `app/layout.tsx`, background layer) | frontend-app | Since change #18, frontend-app owns tokens and the shell. Others file requests in `docs/REQUESTS.md` |
| configs, `package.json` | orchestrator | |

## API (`apps/api`)

| Path | Owner |
| --- | --- |
| `src/modules/{auth,workspace,leads,tasks,pipeline,notifications,dashboard}/**` | backend-core (auth includes Super Admin login, 2FA and the platform guard) |
| `src/modules/{customization,packs}/**`, `scripts/packs-sync.ts` | backend-core (fields, objects, records, labels, pack installer, registry incl. `/api/super/packs`) |
| `src/modules/{realtime,webhooks,integrations,whatsapp,calls}/**` | realtime-integrations |
| `src/modules/{connections,connectors}/**` | realtime-integrations (Wave 2, planned: credential vault, OAuth2, SSRF-safe HTTP client, connector library) |
| `src/modules/workflows/**` | workflow-engine (Wave 2 adds triggers, HTTP Request/data/logic nodes, run control: SPEC 27) |
| `src/modules/superadmin/**` | superadmin-panel (Phase 9) |
| `src/{main.ts,app.module.ts,common,infra,config,health}/**` | orchestrator |
| `prisma/**` (schema, migrations), `scripts/simulator.ts` | backend-core (since change #18; requests in `docs/REQUESTS.md`) |
| `prisma/seed.ts` | orchestrator |
| `test/**` | qa-reviewer |

## Shared and repo

| Path | Owner |
| --- | --- |
| `packages/shared/src/**` except `design/**` | backend-core (contracts, since change #18; requests in `docs/REQUESTS.md`) |
| `packages/shared/src/design/**` (tokens) | frontend-app (since change #18) |
| `packages/shared/test/**` | qa-reviewer |
| `packs/**` (pack manifests; generated from `packages/shared/src/packs`) | orchestrator |
| `connectors/**` (JSON connector definitions, Wave 2, planned) | realtime-integrations |
| `e2e/**` (Playwright) | qa-reviewer, except `e2e/board/**` (frontend-physics), `e2e/team-floor/**` (frontend-3d) and `e2e/playwright.config.ts` (orchestrator) |
| `docs/REQUESTS.md`, `docs/POLISH.md` | everyone appends their own rows/sections; orchestrator curates |
| `scripts/assets/**` | asset-generator |
| `scripts/team-floor/**` (Blender build/bake/export scripts), `docs/ASSETS.md`, `docs/screenshots/team-floor-v3/**`, `e2e/team-floor/**` | frontend-3d |
| `.claude/**`, root configs, docs (`CONTRACTS.md`, `OWNERSHIP.md`, `DECISIONS.md`, `SKILLS.md`, `README.md`, `docs/**`) | orchestrator, except `.claude/skills/vistar-theming/**` (frontend-app, since change #18) |

## Agents

| Agent | Waves | Scope |
| --- | --- | --- |
| backend-core | 1 | auth (workspace + platform audiences, 2FA), RBAC guards + data scope, tenants, roles, users, settings, leads, tasks, pipeline, notifications, dashboard |
| frontend-app | 1 | three panel shells + guards, theme system, auth pages, Leads page shell + Table view, lead detail, dashboard, settings, employee panel (after Leads) |
| frontend-physics | 1 | Board view (kanban physics), workflow builder |
| frontend-3d | 1 | Live Team Floor |
| realtime-integrations | 2 | Socket.IO, event fan-out, presence, webhooks, IndiaMART, WhatsApp, telephony, calls |
| workflow-engine | 2 | BullMQ engine, executors, compliance guards, test runs |
| qa-reviewer | 2, 4 | tests, accessibility and theme review, skill compliance review, diff review |
| asset-generator | after Wave 1, once, after manifest approval | Fizzly image generation |
| superadmin-panel | Phase 9 (or earlier if requested) | Super Admin panel UI + `/api/super` features |
| mobile-app | change #19 | Flutter Android employee app `apps/mobile/**` (SPEC 29.1), including its Kotlin platform code and web preview build |

## Change #19 streams (wave A, parallel worktrees, at most 5 at a time)

Requirements: SPEC section 29. Heavy steps (builds, typecheck, tests, Playwright, Gradle, seeds) take the lock in `%TEMP%\vistar-handoff\HEAVY-LOCK.md`.

| Stream | Worktree / branch | Owns for this wave | Ports / DB |
| --- | --- | --- | --- |
| platform (backend-core) | `.worktrees/backend-core` / `agent/backend-core` | all change #19 contracts in `packages/shared/src/**` (not `design/**`), `apps/api/prisma/**` (schema, the one migration of this wave, clean and demo seeds), API modules for storage, branding, component style, custom domains, platform config (Firebase, APK releases), devices and push, floor requests and published floors, Super Admin companies and switches | API 4001 / `vistar_backend` |
| realtime (backend-core) | `.worktrees/backend-core-crm` / `agent/backend-core-crm` | API modules for the realtime gateway, presence and status engine, device call ingestion and call list, attendance and location, conversations read API, Team Floor snapshot (no schema edits: requests to the platform stream) | API 4002 / `vistar_backend_crm` |
| mobile (mobile-app) | `.worktrees/mobile` / `agent/mobile` | `apps/mobile/**` | web preview 3010, API 4020 / `vistar_mobile` |
| web-premium (frontend-app) | `.worktrees/frontend-app` / `agent/frontend-app` | `components/ui/**`, `styles/**`, `packages/shared/src/design/**`, `components/{shell,settings,common}/**`, settings pages, Super Admin console pages (config section, company switches), page containers and grids in `app/**` (layout classes only), board column width only in `features/pipeline/board-{view,column}.tsx`, `lib/branding/**` | web 3001 / `vistar_shell` |
| web-api (frontend-app) | `.worktrees/frontend-app-leads` / `agent/frontend-app-leads` | `lib/api/**`, `lib/session/**`, `lib/auth/**`, data sources in `lib/{leads,customization,packs,world}/**`, `app/(auth)/**`, Super Admin login pages, `scripts/smoke-*.mjs` | web 3002 / `vistar_leads` |

Wave A is merged into `integration/19a` (`.worktrees/integration`, web 3020, API 4040, `vistar_integration`); `main` follows once Kiro Crew's tests pass.

## Change #19 streams (wave B, branched from `integration/19a`)

| Stream | Worktree / branch | Owns for this wave | Ports / DB |
| --- | --- | --- | --- |
| crm-api (backend-core) | `.worktrees/crm-api` / `agent/crm-api` | all wave B contracts in `packages/shared/src/**` (not `design/**`), `apps/api/prisma/**` (one migration), API modules for contacts, accounts, deals, products and price lists, quotations and invoices (GST, PDF), calendar and meetings, lead routing, lead capture forms; the working-hours gate for zone signals in `modules/presence/**` | API 4030 / `vistar_crm` |
| floor (frontend-3d) | `.worktrees/frontend-3d` / `agent/frontend-3d` | `features/team-floor/{scene,state,flat,templates}/**` and published-floor loading (GLB, glTF, `layout_json`), company floor request UI (reference images), Super Admin floor pages (requests, prompt with copy, upload, seat tool, preview, publish), office markers settings page | web 3005 / `vistar_floor` |
| floor-workspace (frontend-physics) | `.worktrees/frontend-physics` / `agent/frontend-physics` | `features/team-floor/workspace/**` (new), `app/(company)/app/team-floor/**`, `app/(employee)/me/team-floor/**`: live floor from the snapshot and events (zone, status, activity, screen), person panel with actions, module panels over the floor, full-screen mode; web attendance pages (register, live field map, routes) | web 3003 / `vistar_physics` |
| crm-web (frontend-app) | `.worktrees/frontend-physics-builder` / `agent/frontend-physics-builder` | web pages and components for contacts, accounts, deals, products, quotations and invoices, calendar, routing rules, lead capture form builder; nav entries for them | web 3004 / `vistar_builder` |

## Wave 1 streams (parallel worktrees)

Large agents run as two streams with disjoint files. Same agent rules; each stream commits only its paths.

| Stream | Worktree / branch | Paths | Ports |
| --- | --- | --- | --- |
| backend-core:auth | `.worktrees/backend-core` / `agent/backend-core` | `apps/api/src/modules/{auth,workspace}/**` | API 4001 |
| backend-core:crm | `.worktrees/backend-core-crm` / `agent/backend-core-crm` | `apps/api/src/modules/{leads,tasks,pipeline,notifications,dashboard}/**` | API 4002 (`DEV_AUTH=1`) |
| frontend-app:shell | `.worktrees/frontend-app` / `agent/frontend-app` | `app/layout.tsx`, `app/page.tsx`, `app/(auth)/**`, `app/(company)/app/**` except `page.tsx` and `leads/**`, `app/(employee)/me/**` except `leads/**`, `app/(super-admin)/**`, `components/{shell,auth,settings,employee,common}/**`, `lib/{theme,auth}/**`, `public/**` (not `generated`) | web 3001 |
| frontend-app:leads | `.worktrees/frontend-app-leads` / `agent/frontend-app-leads` | `app/(company)/app/page.tsx` (dashboard), `app/(company)/app/leads/**`, `app/(employee)/me/leads/**`, `components/{leads,lead-detail,dashboard}/**` | web 3002 |
| frontend-physics:board | `.worktrees/frontend-physics` / `agent/frontend-physics` | `features/pipeline/**` | web 3003 |
| frontend-physics:builder | `.worktrees/frontend-physics-builder` / `agent/frontend-physics-builder` | `features/workflow-builder/**` | web 3004 |
| frontend-3d | `.worktrees/frontend-3d` / `agent/frontend-3d` | `features/team-floor/**` | web 3005 |

The shared Postgres (5432) and Redis (6379) are used by both API streams; neither runs migrations or edits `prisma/**`.
