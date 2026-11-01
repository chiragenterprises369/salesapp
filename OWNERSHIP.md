# Ownership

Stay inside your folders. Never edit another owner's files; request changes through the orchestrator.
Read anything. Contracts are listed in CONTRACTS.md.

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
| `features/workflow-builder/**` | frontend-physics | React Flow builder |
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
| `src/modules/{realtime,webhooks,integrations,whatsapp,calls}/**` | realtime-integrations |
| `src/modules/workflows/**` | workflow-engine |
| `src/modules/superadmin/**` | superadmin-panel (Phase 9) |
| `src/{main.ts,app.module.ts,common,infra,config,health}/**` | orchestrator |
| `prisma/**` (schema, migrations, seed), `scripts/simulator.ts` | orchestrator |
| `test/**` | qa-reviewer |

## Shared and repo

| Path | Owner |
| --- | --- |
| `packages/shared/src/**` | orchestrator (contracts) |
| `packages/shared/test/**` | qa-reviewer |
| `e2e/**` (Playwright) | qa-reviewer |
| `scripts/assets/**` | asset-generator |
| `.claude/**`, root configs, docs (`CONTRACTS.md`, `OWNERSHIP.md`, `DECISIONS.md`, `SKILLS.md`, `README.md`) | orchestrator |

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
