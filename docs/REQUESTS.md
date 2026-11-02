# Change requests

Requests for files an agent does not own (change #18). Owners:
- Tokens (`packages/shared/src/design/tokens.ts`, `apps/web/styles/tokens.css`, the vistar-theming skill) and the shell layout: **frontend-app**.
- `packages/shared` contracts (schemas, routes, events, enums, rbac, navigation) and the Prisma schema and migrations: **backend-core**.
- Everything else: the owner listed in `OWNERSHIP.md`.

Format: one entry per request. Keep working on whatever does not depend on the request. The owner marks it `done (<commit>)` or `declined (<reason>)`; the orchestrator resolves conflicts.

| # | Date | From | To | File(s) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-02 | orchestrator | backend-core | `packages/shared/src/schemas/workspace.ts`, `apps/api/src/modules/workspace/**` | Setting keys and fields from D-052 | 28.1 board skins and 28.2 interface style and motion intensity | done (4f72172) |
| 2 | 2026-11-02 | frontend-3d | orchestrator | `e2e/playwright.config.ts` | Include `e2e/team-floor` (testMatch already covers `**/*.spec.ts`; check that the projects suit 3D shots) | Team Floor e2e | done (testMatch covers it; comment updated) |
| 3 | 2026-11-02 | frontend-3d | orchestrator | `.claude/skills/vistar-3d-floor/SKILL.md` | Replace the skill with the drafted text in `scripts/team-floor/skill-update.md` (GLB pipeline, templates and module kit, Day/Evening cross-fade, glow cards, label rules, flat SVG plan, QA hook, done checklist) | Skill describes the old procedural floor; 28.3 builds on the 12.1 floor | open (draft ready) |
| 4 | 2026-11-02 | frontend-physics | orchestrator | `e2e/playwright.config.ts` | Read the worker count from `E2E_WORKERS` (local default 2) instead of half the cores | With other worktrees building on the same machine, 8 workers made board specs time out at app boot ("Loading Vistar"); `--workers=2` runs 26/26 green | done (d0de84d) |
| 5 | 2026-11-02 | frontend-physics | frontend-app | `packages/shared/src/design/tokens.ts` (`elevation-drag`, dark palette) | Slightly stronger dark drag shadow | The lifted Board card and builder node read flat in dark (POLISH.md, Board physics v2) | open |
| 6 | 2026-11-02 | frontend-app (pages) | frontend-app (lib/world) | `apps/web/lib/world/read.ts`, `hooks.ts` | Add `forecastByStage(v)` (open pipeline per stage: leads, value, probability, weighted value; same scope rule as `reportSummary().forecastInr`) and a `useForecast()` hook | Reports > Revenue forecast shows the stage breakdown; it lives in `components/reports/logic.ts` + `data.ts` until lib/world has it | open |
| 7 | 2026-11-02 | frontend-app (pages) | frontend-app (lib/world) | `apps/web/lib/world/read.ts` | `listCalls`: accept `direction` (inbound / outbound), like `CallListQuerySchema` gets it later; `listTasks`/`listCalls`/`listConversations`: mutations (`completeTask`, `snoozeTask`, `sendMessage`, `assignConversation`) persisted in the mock DB | The Calls page filters direction on the client; task, chat and assignment edits live in page stores (`components/{tasks,inbox}/data.ts`) and reset on reload | open |
