# Status

Updated 2026-11-01, after the Wave 1 merge and before the Wave 1 post-merge checks.

## Current state

- STEP 0 is done and verified on `main` (typecheck, lint, web and API builds, API `/api/health` with DB and Redis, migrations, seed).
- All 7 Wave 1 branches were merged into `main` without conflicts (`87ae653`). Each stayed inside its owned paths.
- **Not yet verified on `main`:** full typecheck, lint, tests, builds and a running app after the merge. Each agent verified its work only in its own worktree. This check is paused while the specs are consolidated.
- **Wave 1 contract requests are partly applied and uncommitted** (paused by the "do not change code" instruction):
  - boolean query params use `z.stringbool`
  - `InviteAcceptSchema.email`
  - `API_KEY_PREFIX`
  - duplicate Board "Select" toggle removed from the Leads page header
  - migration `20261101120000_wave1_contract_requests`: `SavedView.viewMode`, `pg_trgm` trigram indexes, `Lead.position COLLATE "C"`. This one is **already applied to the local DB**.
- Still to do in Wave 1 wrap-up:
  - move `ScheduleModule.forRoot()` to AppModule
  - session actions `updateProfile` / `setStatus` / `updateSupportAccess`
  - `next.config` env inlining for `NEXT_PUBLIC_*`
  - dev builder preview as company admin
  - routes for resolving attention and manager-to-employee messages
  - new leads placed at the top of their column
  - re-seed so roles get `leads.merge`
  - then the full check on `main` and the wave report

## Modules

Status values: not started / in progress / done / blocked. "Verified" = what was checked and where. "Branch" means the owner checked it in their worktree before the merge, not yet on `main`.

| Module (SPEC section) | Owner agent | Phase | Status | Verified |
| --- | --- | --- | --- | --- |
| Foundation: monorepo, contracts, tokens, UI kit, Prisma, seed (2) | orchestrator | Step 0 | done | `main`: typecheck, lint, builds, API health, migrations, seed (1 Super Admin, 3 companies, 2,940 leads); qa-reviewer review, 20 fixes applied |
| Design system and theme modes (4) | orchestrator (tokens, kit), frontend-app (theme system) | 1 | in progress | Branch: System (live) / Light / Dark / Scheduled, saved to the cookie, no flash; screenshots in both themes. Saved to the mock session, not the server yet |
| Roles, permission matrix, data scope (5) | backend-core (API), frontend-app (UI) | 1 | in progress | Branch: API guard enforces permissions and scope (own / team / all); employee gets 403 on admin routes; roles editor UI uses mock state |
| Panels, routing, navigation shells (6) | frontend-app | 1 | done (mock session) | Branch: three shells, role redirects for all 5 personas, "No access" state, impersonation banner, Super Admin idle timeout |
| Auth and onboarding, workspace (7) | backend-core | 1 | in progress | Branch API: signup provisioning, login, refresh rotation with reuse detection, `/auth/me` parses, invites, Google returns not-connected without config. Web login is mock; not wired to the API |
| Super Admin auth (6.2, 7) | backend-core | 1 | in progress | Branch API: password, TOTP enrolment/verify, replay blocked, idle/absolute timeout, IP allowlist, audience separation both ways. UI is mock |
| Realtime dashboard (8) | backend-core (API), frontend-app (UI) | 4 | in progress | Branch API: summary and `/me/today` parse with shared schemas. UI: KPIs, charts and feed driven by the mock simulator. No sockets yet |
| Leads: Board/Table, filters, bulk, import/export (9) | backend-core (API), frontend-app (page, Table), frontend-physics (Board) | 2-3 | in progress | Branch API: filters, search, cursor paging, scope, CSV/XLSX import and export, version conflicts. Branch UI: view-mode persistence, `?view=`, filters survive a switch, workspace default, mock import/export, 35 Playwright checks. UI not connected to the API |
| Lead detail (10) | frontend-app (UI), backend-core (timeline/notes API) | 2 | in progress | Branch: drawer and page with mock timeline; API timeline and notes built |
| Pipeline Board physics and stages (11) | frontend-physics (Board), backend-core (board, move, stages API) | 3 | in progress | Branch: drag physics, keyboard and menu moves, select mode, quick add, rollback, ~60 fps with 2,500 mock leads, 59 Playwright checks. API board and move built. Not integrated |
| Live Team Floor (12) | frontend-3d (UI), realtime-integrations (snapshot, events) | 8 | in progress | Branch UI: R3F scene driven by the simulator, three.js kept out of the first-load bundle, 200-employee stress test, flat view and accessible list, tier drop. Snapshot API not started |
| Workflow builder (13.1, 13.2, 13.4) | frontend-physics | 6 | in progress | Branch: builder with depth nodes, rope edges, inspector; the IndiaMART template validates with 0 issues; mock test runs pass the price, catalogue and no-reply paths |
| Workflow engine and compliance guards (13.3) | workflow-engine | 6 | not started | Contracts and skill `vistar-workflow-nodes` ready |
| WhatsApp inbox (14) | realtime-integrations | 5 | not started | Placeholder pages only |
| Calls and telephony (15.1) | realtime-integrations | 7 | not started | Placeholder pages only |
| Tasks and follow-ups (15.2) | backend-core (API), frontend-app (UI) | 2 | in progress | Branch API: CRUD, snooze, timezone due filters, overdue scheduler publishes events. UI uses mocks |
| Reports (15.3) | frontend-app, backend-core | 9 | not started | Placeholder page |
| Team, roles and targets (15.4) | backend-core, frontend-app | 1 / 9 | in progress | Roles/teams/users API in branch; roles matrix UI uses mocks; targets not started |
| Integrations, webhooks, public API (15.5) | realtime-integrations | 5 | not started | Contracts, signing helpers and `WebhookEndpoint` tables ready; skill `vistar-webhooks-security` still to write |
| Notifications (15.6) | backend-core (API), frontend-app (UI) | 2 | in progress | Branch API: list, read, push subscription storage, overdue notifications. Push sending and email digest not started |
| Company settings, billing, audit (15.7) | frontend-app, backend-core | 1 / 9 | in progress | Branch: settings pages (workspace, hours, theme and Leads defaults, roles, visibility, support access) with mocks; audit service writes entries; billing not started |
| Super Admin panel (16) | superadmin-panel | 9 | not started | Shell and placeholder pages only (frontend-app) |
| Employee panel (17) | frontend-app | 2-3 | in progress | Branch: bottom nav, Home today view, status control, profile, preferences, PWA manifest, all on mocks. Offline task list and push not started |
| Image assets (18) | asset-generator | after Wave 1 | blocked | Needs your manifest approval and the exact Fizzly `inputs` field names |
| Realtime backbone (19) | realtime-integrations | 4 | not started | Event bus (Redis pub/sub) and event contract ready; events validated in dev |
| Seed and simulator (20.4) | orchestrator | 1 / 4 | in progress | Seed done; the simulator publishes events but does not save rows yet |
| Tests and QA (20.3) | qa-reviewer | Waves 2, 4 | not started | STEP 0 review done; no test suites yet |
| Deployment docs and CI (20.6) | orchestrator | 10 | not started | Docker Compose for local services exists |
| Industry packs, real estate pack and supplement, live site-visit map (21.1) | unassigned | ? | blocked | Spec content not received |
