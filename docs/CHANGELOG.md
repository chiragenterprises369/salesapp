# Spec changelog

Every spec message, in the order received, and the `docs/SPEC.md` sections it touched.
Code and contract changes are tracked in `CONTRACTS.md` (change log) and `DECISIONS.md`.

| # | Date | Change | Sections in SPEC.md | Overrides |
| --- | --- | --- | --- | --- |
| 1 | 2026-11-01 | **Master spec**: Vistar CRM + automation + live team monitoring; stack, design system and theme modes, 15 modules, realtime architecture, data model, security and tests, seed data, 10-phase build order, deliverables | 1, 3, 4, 7-15, 19, 20 | (baseline) |
| 2 | 2026-11-01 | **Multi-agent execution mode**: orchestrator role, Step 0 foundation, 7 agents with owned folders, rules for all agents, 4-wave parallel plan, wait for "go" between waves, credit-saving rules | 2.1, 2.2, 2.3, 2.5, 2.6 | Execution model for the build order |
| 3 | 2026-11-01 | **Skills + Fizzly assets**: mandatory skills (`SKILLS.md`, read before every task, "Skills used" in summaries), project skills (`vistar-conventions`, `vistar-theming`, `vistar-realtime-events`, later `vistar-webhooks-security`, `vistar-workflow-nodes`, `vistar-3d-floor`), qa-reviewer skill review; new asset-generator agent with Fizzly Workflows API, credit safety and manifest | 2.2, 2.3, 2.4, 18 | Adds a rule to "Rules for all agents" |
| 4 | 2026-11-01 | **Leads view defaults**: Leads page with Board (default, WorkDo-style) and Table (optional) views, header toggle, persistence (server `leads.viewMode`, localStorage, workspace default, `?view=`), shared filters/selection/scroll, per-view behaviour, mobile behaviour, quality and e2e requirements, contract keys | 9, 11, 15.7, 17, 20.3 | Master module 5 (Pipeline) becomes the Leads Board view; master module 3 table becomes the optional Table view |
| 5 | 2026-11-01 | **Three panels, roles and navigation map**: roles SUPER_ADMIN / COMPANY_ADMIN / MANAGER / EMPLOYEE / VIEWER, permission matrix enforced by guards, route groups `/super-admin`, `/app`, `/me`, separate Super Admin auth (2FA, timeout, IP allowlist, `/api/super`, separate audience), full navigation map, role visibility, Super Admin details (impersonation, plans, audit), company panel additions (custom roles, data visibility, support access), Employee panel (PWA), Leads page restated for all panels, quality/tests, seed (1 super admin, 3 companies), Phase 1 expanded, Employee panel after Leads; new superadmin-panel agent. Ended with "also add this additional feature" without content | 2.2, 4.1, 4.2, 5, 6, 7, 8, 9, 12, 13.5, 14, 15, 16, 17, 20.3, 20.4, 20.5 | Replaces the master roles (admin, manager, sales rep, viewer); expands Phase 1; seed data extended |
| 6 | 2026-11-01 | "go" (start Wave 1) | none (process) | |
| 7 | 2026-11-01 | **Consolidate specs**: single `docs/SPEC.md`, this changelog, `docs/STATUS.md`; agents read only their SPEC sections plus `CONTRACTS.md`; update `OWNERSHIP.md` | Preamble ("How agents use this file"), 2.3 | Agents no longer use chat history as spec |

## Referenced but not received

The consolidation request (#7) listed these spec changes. Their content was never received, so they
are not in `SPEC.md` (see SPEC section 21.1):

- Board physics (as a separate change)
- Industry packs
- Real estate pack
- Real estate supplement
- Live site-visit map
- The "additional feature" at the end of change #5
