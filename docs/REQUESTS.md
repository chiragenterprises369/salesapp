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
| 3 | 2026-11-02 | frontend-3d | orchestrator | `.claude/skills/vistar-3d-floor/SKILL.md` | Update for the GLB pipeline, template format, characters, label layer and QA hook | Skill describes the old procedural floor | open |
