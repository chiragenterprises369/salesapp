# Skills

Rule for every agent: **before starting a task, read the relevant skills listed here and follow them. End every summary with `Skills used: ...`.** Summaries without it are sent back.

## Project skills (`.claude/skills`, installed)

- `vistar-conventions` — repo structure, contracts, API/web coding rules, commit and summary format. Read for every task.
- `vistar-theming` — tokens, both themes, motion, accessibility, UI kit usage. Read for all UI work.
- `vistar-realtime-events` — event envelope, publish-after-commit, cache patching, rooms, presence. Read for any realtime or cache work.
- Planned (created just before their phase): `vistar-webhooks-security` (Phase 5), `vistar-workflow-nodes` (Phase 6), `vistar-3d-floor` (Phase 8).

## User skills (`~/.claude/skills`)

- None installed.

## Installed Claude Code plugins

- None installed. The official marketplace is cloned at `~/.claude/plugins/marketplaces/claude-plugins-official`, but no plugin is enabled.
- Available there and useful (read by path, not installed): `plugins/frontend-design/skills/frontend-design/SKILL.md` — design guidance; use for all UI work, but the Vistar design system wins where they differ.

## Kiro powers (installed in this environment)

- `ggshield` skills: `scan-secrets`, `install-hooks`, `create-honeytokens`, `check-hmsl`, `scan-machine`, `triage-incidents` — use `scan-secrets` before commits that touch env, integrations or webhooks.
- `context7` — current library docs (Next 16, Nest 12, Prisma 7, R3F, React Flow).

## Missing skills (not installed anywhere)

- Three.js / React Three Fiber
- NestJS
- Prisma
- Testing (Playwright, Vitest)
- Accessibility (WCAG) review

Until these exist, agents use `context7` for library docs and the project skills above.

## Which skills each agent reads

| Agent | Skills |
| --- | --- |
| backend-core, realtime-integrations, workflow-engine, superadmin-panel (API) | vistar-conventions, vistar-realtime-events; ggshield scan-secrets for auth/integration work |
| frontend-app, frontend-physics, superadmin-panel (UI) | vistar-conventions, vistar-theming, frontend-design (by path), vistar-realtime-events when touching caches |
| frontend-3d | vistar-conventions, vistar-theming, frontend-design (by path), vistar-3d-floor (Phase 8) |
| qa-reviewer | all project skills (reviews against them), frontend-design (by path) |
| asset-generator | vistar-conventions, vistar-theming (style), ggshield scan-secrets |
