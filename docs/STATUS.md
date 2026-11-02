# Status

Updated 2026-11-01 after the Wave 1 check on `main`.

## Wave 1 check on main (all green)

| Check | Result |
| --- | --- |
| Merge | 7 Wave 1 branches merged without conflicts; every branch stayed inside its owned paths |
| Typecheck / lint | `pnpm -r typecheck` and `pnpm -r lint` clean (3 packages) |
| Tests | Runners pass; **no test suites exist yet** (qa-reviewer writes them in Wave 2) |
| Builds | API (`nest build`) and web (`next build`, all routes) succeed |
| DB | 3 migrations applied; re-seeded: 1 Super Admin, 3 companies, 2,940 leads |
| API running (`pnpm smoke:api`) | 28/28: health; login for 5 personas; `/auth/me`, lead list, board, dashboard, `/me/today` and tasks all match the shared schemas; data scope (admin 2,500, manager team subset, employee own subset, viewer all); another tenant gets 404; RBAC 403s; board counts equal the list total; new lead lands at the top of its column; a settings PATCH keeps `leadsViewMode`; a workspace token gets 401 on `/api/super`; Super Admin login returns the 2FA challenge |
| Web running (`pnpm smoke:web`) | 28/28: 14 routes for 5 personas plus signed out, in light at 1440 and dark at 375; role guards redirect correctly; no page or console errors; no horizontal scroll at 375 |

Fixed during the check:
- the dashboard's screen-reader chart tables made the page scroll sideways at 375 px
- the seed failed on leftover impersonation rows from backend-core's test workspaces
- `next.config` did not load the root `.env` (`NEXT_PUBLIC_*` values were not inlined)

Known gaps (by design until Wave 3): the web app runs on the mock session and mock data, not the API. There are no sockets yet. Seven test workspaces (`verify-traders-*`) created by backend-core remain in the dev DB.

## Now (scope lock, change #13)

Executing only these two items, in order:
- (a) Industry Packs Part 1: flexible data layer, pack manifest, registry skeleton, migration of existing Leads and pipeline data, green tests.
- (b) Board physics (frontend-physics).

After that: the full check (typecheck, lint, tests, builds, `pnpm smoke:api`, `pnpm smoke:web`) and the report. Wave 2 only on "go"; it now includes the workflow platform (SPEC 27, change #14), which is folded into the docs but not started.

**Awaiting your confirmation** (in change #9, not in the scope lock): the User-Workspace membership refactor (D-036) and deleting the seven `verify-traders-*` dev companies.
## Modules

Status values: not started / in progress / done / blocked. "Verified" = what was checked and where. "Branch" means the owner checked it in their worktree before the merge, not yet on `main`.

| Module (SPEC section) | Owner agent | Phase | Status | Verified |
| --- | --- | --- | --- | --- |
| Foundation: monorepo, contracts, tokens, UI kit, Prisma, seed (2) | orchestrator | Step 0 | done | `main`: typecheck, lint, builds, API health, migrations, seed (1 Super Admin, 3 companies, 2,940 leads); qa-reviewer review, 20 fixes applied |
| Design system and theme modes (4) | orchestrator (tokens, kit), frontend-app (theme system) | 1 | in progress | Branch: System (live) / Light / Dark / Scheduled, saved to the cookie, no flash; screenshots in both themes. Saved to the mock session, not the server yet |
| Roles, permission matrix, data scope (5) | backend-core (API), frontend-app (UI) | 1 | in progress | Branch: API guard enforces permissions and scope (own / team / all); employee gets 403 on admin routes; roles editor UI uses mock state |
| Panels, routing, navigation shells (6) | frontend-app | 1 | done (mock session) | `main`: smoke 28/28 (guards, both themes, 375 px). Branch: three shells, role redirects for all 5 personas, "No access" state, impersonation banner, Super Admin idle timeout |
| Auth and onboarding, workspace (7) | backend-core | 1 | in progress | Branch API: signup provisioning, login, refresh rotation with reuse detection, `/auth/me` parses, invites, Google returns not-connected without config. Web login is mock; not wired to the API |
| Super Admin auth (6.2, 7) | backend-core | 1 | in progress | Branch API: password, TOTP enrolment/verify, replay blocked, idle/absolute timeout, IP allowlist, audience separation both ways. UI is mock |
| Realtime dashboard (8) | backend-core (API), frontend-app (UI) | 4 | in progress | Branch API: summary and `/me/today` parse with shared schemas. UI: KPIs, charts and feed driven by the mock simulator. No sockets yet |
| Leads: Board/Table, filters, bulk, import/export (9) | backend-core (API), frontend-app (page, Table), frontend-physics (Board) | 2-3 | in progress | Branch API: filters, search, cursor paging, scope, CSV/XLSX import and export, version conflicts. Branch UI: view-mode persistence, `?view=`, filters survive a switch, workspace default, mock import/export, 35 Playwright checks. UI not connected to the API |
| Lead detail (10) | frontend-app (UI), backend-core (timeline/notes API) | 2 | in progress | Branch: drawer and page with mock timeline; API timeline and notes built |
| Pipeline Board physics and stages (11) | frontend-physics (Board), backend-core (board, move, stages API) | 3 | in progress | Branch: drag physics, keyboard and menu moves, select mode, quick add, rollback, ~60 fps with 2,500 mock leads, 59 Playwright checks. API board and move built. Not integrated |
| Live Team Floor (12) | frontend-3d (UI), realtime-integrations (snapshot, events) | 8 | in progress | Branch UI: R3F scene driven by the simulator, three.js kept out of the first-load bundle, 200-employee stress test, flat view and accessible list, tier drop. Snapshot API not started |
| Team Floor art target V3 (12.1) | frontend-3d | 8 (brought forward) | done (merged 35e06c8) | `main`: baked Blender GLB office (Day and Evening lightmaps with cross-fade, AO), rigged GLB characters, Small (8), Medium and Large (50) templates from the module kit, collision-free labels, flat SVG plan. Team Floor e2e 18/18, three.js not in the first-load bundle. Leftovers in `docs/POLISH.md` |
| Workflow builder (13.1, 13.2, 13.4) | frontend-physics | 6 | in progress | Branch: builder with depth nodes, rope edges, inspector; the IndiaMART template validates with 0 issues; mock test runs pass the price, catalogue and no-reply paths |
| Workflow engine and compliance guards (13.3) | workflow-engine | 6 | not started | Contracts and skill `vistar-workflow-nodes` ready |
| WhatsApp inbox (14) | realtime-integrations (API), frontend-app (UI) | 5 | in progress (UI on dummy data) | `main` (cab5693): `/app/inbox` and `/me/inbox` on the mock world: 1,132 chats, unread counts, ticks, templates, 24 h window, notes, assign/transfer, quick replies, local composer. Edits reset on reload (REQUESTS #7). No Cloud API yet |
| Calls and telephony (15.1) | realtime-integrations (API), frontend-app (UI) | 7 | in progress (UI on dummy data) | `main` (cab5693): `/app/calls` call log with filters, totals and a mock recording player (4,118 world calls). No telephony adapter or call list API yet |
| Tasks and follow-ups (15.2) | backend-core (API), frontend-app (UI) | 2 | in progress | Branch API: CRUD, snooze, due filters, overdue events. `main` (cab5693): `/app/tasks` my/team tabs, due buckets, optimistic complete and snooze, week view on 2,105 world tasks. UI not wired to the API |
| Reports (15.3) | frontend-app, backend-core | 9 | in progress (UI on dummy data) | `main` (cab5693): funnel, SLA, rep table, source ROI, forecast, call analytics, workflow performance, CSV export. Scheduled email and PDF not built |
| Team, roles and targets (15.4) | backend-core, frontend-app | 1 / 9 | in progress | Roles/teams/users API in branch; roles matrix UI uses mocks. `main` (cab5693): `/app/team` cards and `/app/targets` rings and bars on world data; targets not editable |
| Integrations, webhooks, public API (15.5) | realtime-integrations | 5 | not started | Contracts, signing helpers and `WebhookEndpoint` tables ready; skill `vistar-webhooks-security` still to write |
| Notifications (15.6) | backend-core (API), frontend-app (UI) | 2 | in progress | Branch API: list, read, push subscription storage, overdue notifications. Push sending and email digest not started |
| Company settings, billing, audit (15.7) | frontend-app, backend-core | 1 / 9 | in progress | Branch: settings pages (workspace, hours, theme and Leads defaults, roles, visibility, support access) with mocks; audit service writes entries; billing not started |
| Super Admin panel (16) | superadmin-panel | 9 | in progress (lists on dummy data) | `main` (590708c): overview KPIs and every platform list filled from the mock world (23 companies, plans, usage, flags, health, support, audit). No platform API wiring |
| Employee panel (17) | frontend-app | 2-3 | in progress | Branch: bottom nav, Home today view, status control, profile, preferences, PWA manifest, all on mocks. Offline task list and push not started |
| Image assets (18) | asset-generator | after Wave 1 | blocked | Prompts for hero-login light and dark received (SPEC 18.1, change #15). Fizzly env vars are set. Waiting on manifest approval and three answers: name tags vs "no text in images", how to send the negative prompt, and whether to generate now. Nothing generated, 0 credits spent |
| Realtime backbone (19) | realtime-integrations | 4 | not started | Event bus (Redis pub/sub) and event contract ready; events validated in dev |
| Seed and simulator (20.4) | orchestrator, backend-core | 1 / 4 | done (seed) | `main`: API seed fills every demo model for the 3 companies (2,940 leads, ~37k activities, ~3.2k tasks, ~6.8k calls, ~1.2k chats with ~7.2k messages, ~1k workflow runs, webhooks, audit, notifications, targets), about 25 s, run on the main DB 2026-11-02 after a backup in `.backups/`. Web mock world: 2,500 leads plus tasks, calls, chats, timelines, notifications, runs, audit, Super Admin data; mock DB v2 upgrade. Leads tab has a mock live feed. Open: recent wins too high in the web world; DB counts change by clock hour |
| Tests and QA (20.3) | qa-reviewer | Waves 2, 4 | not started | STEP 0 review done; no test suites yet |
| Deployment docs and CI (20.6) | orchestrator | 10 | not started | Docker Compose for local services exists |
| Industry Packs core: custom objects/fields, labels, configurable stages, manifest, registry (22) | orchestrator (contracts, schema, migration), backend-core (API), frontend-app (settings + registry UI) | 2 | done (Part 1) | `main`: shared 59 tests, API 31 tests (installer idempotency, upgrade keeps admin edits, uninstall/reinstall, adoption of migrated workspaces, tenant isolation, 403/422), `packs:sync` second run all noop on 5 workspaces, smoke:api 37/37 (fields, packs, labels, 422 path, pipeline keys), smoke:web 28/28. Branch UI checks: S 65/65, R 28/29 (lead field reload fixed on main after). UI runs on the mock data layer; not wired to the API yet |
| Generic Sales pack (22.5) | orchestrator | 2 | done | `packs/generic-sales/manifest.json` generated and tested; installed in all seeded and existing workspaces |
| Board physics v2 (11.1) | frontend-physics | 3 | done (merged 9d41dbd) | `main`: shared physics module, depth cards, spring follow and tilt, gap wave, arcs, quality tiers, flat mode, mobile long-press, `/dev/board-physics` lab. Board e2e 26/26 (axe, drag, keyboard, mobile, reduced motion) |
| Real Estate pack (23) | pack-realestate (planned, not created) | after 22 | planned (not started) | n/a |
| Real Estate supplement (24) | pack-realestate (planned, not created) | after 23 | planned (not started) | n/a |
| Live Site-Visit Map / Field Live (25) | frontend-map (planned, not created) | after 23 and Phase 4-5 | planned (not started) | n/a |
| User-Workspace membership (5.4) | backend-core | before Wave 2 | not started (awaiting confirmation) | Design in CONTRACTS.md (D-036) |
| Workflow platform: connections vault, HTTP Request node, SSRF-safe client (27.1, 27.3, 27.7) | realtime-integrations (vault, client), workflow-engine (node) | Wave 2 step 1 | planned (not started; waits for "go") | n/a |
| Workflow platform: webhook, schedule, poll, CRM and sub-workflow triggers (27.2) | workflow-engine, realtime-integrations (inbound endpoint) | Wave 2 step 2 | planned (not started) | n/a |
| Workflow platform: wait-for-event, switch, loops, merge, error branch, approvals (27.4) | workflow-engine | Wave 2 step 3 | planned (not started) | n/a |
| Workflow platform: data picker, pin data, run timeline, replay (27.5, 27.6) | frontend-physics (UI), workflow-engine (API) | Wave 2 step 4 | planned (not started) | n/a |
| Workflow platform: WhatsApp, email, Telegram, SMS/voice mock nodes (27.3) | realtime-integrations (adapters), workflow-engine (nodes) | Wave 2 step 5 | planned (not started) | n/a |
| Workflow platform: connector definitions, library, templates gallery, seed (27.8, 27.9) | realtime-integrations (connectors), frontend-physics (gallery), orchestrator (seed) | Wave 2 step 6 | planned (not started) | n/a |
| Leads Board "Neon Space" skin and event celebrations (28.1) | frontend-physics | after board physics 11.1 is merged (no "go" gate) | done (merged 9292883, aae5a73, fix ff60e46) | `main`: skins Flat / Depth / Neon Space (Aurora in light) with toolbar picker, workspace default, device and FPS fallbacks; backdrop plate; contrast all AA (lowest 5.53:1); drag p95 16.8 ms on GT 710. Celebrations: one capped canvas (peak 140 of 300), new lead stream-in, move ribbon, quote envelope, Won burst (throttled), Lost shards, Full/Subtle/Off setting. Board e2e green on main (103 passed across board, pages, team floor). Leftovers in `docs/POLISH.md` |
| Space Shell, 3D space feel across the app (28.2) | frontend-app (shell), frontend-physics and frontend-3d (scenes) | foundation done; page restyling after 28.1 and 28.3 merge | foundation done (merged 4741bc5) | `main`: motion, spring and depth tokens, Interface style (Classic, Depth, Neon Space) and Motion intensity settings, space background, glass sidebar and top bar, page transitions. Classic stays the default. Settings still use a localStorage adapter; switch to the D-052 session settings next. Merged ahead of 28.1 and 28.3 at the user's request |
| Team Floor multi-map and auto-upgrade by headcount (28.3) | frontend-3d, backend-core (backend) | after 12.1 is finished (no "go" gate) | ready to start | Prerequisite met: 12.1 merged (35e06c8). Backend schema spec (seats, layouts, tiers, audit) still to write |
| Settings contracts for skins, interface style and motion (28.1, 28.2) | backend-core | now | done (merged a629b15) | `main`: D-052 setting keys and fields, resolvers in `appearance.ts`, audited workspace defaults; shared 80 and API 41 tests |
