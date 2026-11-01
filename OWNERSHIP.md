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
| frontend-3d | 2.3, 4, 12, 17 (Team Floor item), 19 (consuming events) |
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
| `lib/auth/**`, `lib/theme/**`, `lib/api/**` | frontend-app | session (mock in Wave 1), theme system, HTTP client |
| `lib/realtime/**` | realtime-integrations (client side, Wave 2) | socket client + cache updaters; orchestrator wires in Wave 3 |
| `lib/cn.ts`, `lib/use-*.ts`, `lib/query-client.tsx`, `lib/leads/**` | orchestrator | shared hooks and Leads data layer |
| `public/generated/**` | asset-generator | generated images + `assets.json` |
| `public/**` (other) | frontend-app | PWA manifest, icons, service worker |
| `tests/**` | qa-reviewer | unit/component tests |
| `styles/**`, configs, `package.json` | orchestrator | |

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
| `prisma/**` (schema, migrations, seed), `scripts/simulator.ts` | orchestrator |
| `test/**` | qa-reviewer |

## Shared and repo

| Path | Owner |
| --- | --- |
| `packages/shared/src/**` | orchestrator (contracts) |
| `packages/shared/test/**` | qa-reviewer |
| `packs/**` (pack manifests; generated from `packages/shared/src/packs`) | orchestrator |
| `connectors/**` (JSON connector definitions, Wave 2, planned) | realtime-integrations |
| `e2e/**` (Playwright) | qa-reviewer, except `e2e/board/**` (frontend-physics) and `e2e/playwright.config.ts` (orchestrator) |
| `scripts/assets/**` | asset-generator |
| `.claude/**`, root configs, docs (`CONTRACTS.md`, `OWNERSHIP.md`, `DECISIONS.md`, `SKILLS.md`, `README.md`, `docs/**`) | orchestrator |

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
