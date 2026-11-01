# Vistar: consolidated specification

Single source of requirements. It merges the master spec and every later change received, keeping
only the final version where a later change overrides an earlier one. History: `docs/CHANGELOG.md`.
Progress: `docs/STATUS.md`.

**How agents use this file:** read only the sections listed for your agent in `OWNERSHIP.md`, plus
`CONTRACTS.md` and the skills listed in `SKILLS.md`. Do not rely on chat history. Where this spec
and `CONTRACTS.md` disagree, raise it with the orchestrator; `CONTRACTS.md` describes the agreed
technical shape, this file describes required behaviour.

Clarifications the orchestrator adopted for ambiguous points are marked *(decision D-0xx)* and
explained in `DECISIONS.md`. Open questions are in section 21.

---

## 1. Product

- **Vistar**: production-grade, multi-tenant Sales Management System (CRM + automation + live team
  monitoring) for Indian SMEs.
- Work phase by phase (section 19). Each phase must run end to end before the next starts. After each
  phase (wave), summarise what works and what is next.
- Ask before any decision that changes scope; otherwise choose a sensible default and record it in
  `DECISIONS.md`.

## 2. Delivery process (orchestrator; agents read 2.3 and 2.4)

### 2.1 Orchestration
- Multi-agent, parallel. The orchestrator plans, splits work, delegates to specialist agents running
  in parallel, then integrates and verifies. It writes little feature code itself.
- Agent definitions live in `.claude/agents/`. Each agent works on its own branch in its own git
  worktree, so parallel agents never edit the same files.
- **Step 0** (orchestrator, before any parallel work): monorepo skeleton; `packages/shared` (types,
  zod schemas, realtime event contract, REST contract / OpenAPI draft, error codes); design tokens
  (light/dark CSS variables) and base UI kit (Button, Input, Card, Table, Chip, Dialog, Toast);
  Prisma schema and seed/simulator skeleton; `CONTRACTS.md` and `OWNERSHIP.md`.
- Agents read contracts but never change them. A needed change is reported to the orchestrator, who
  updates the contract and notifies the other agents.

### 2.2 Agents
| Agent | Scope |
| --- | --- |
| backend-core | auth, RBAC, tenants, leads, tasks, pipeline APIs (+ workspace, notifications, dashboard API) |
| realtime-integrations | Socket.IO, event bus, webhooks (inbound/outbound, HMAC, replay), IndiaMART and WhatsApp Cloud API adapters, telephony, calls |
| workflow-engine | BullMQ engine, node executors, compliance guards, test runs |
| frontend-app | app shell, theme system, panel shells, leads, lead detail, dashboard, reports, settings, employee panel |
| frontend-physics | Leads Board (kanban physics) and workflow builder (React Flow, spring physics, rope edges) |
| frontend-3d | Live Team Floor (R3F isometric office, characters, pathfinding, event-driven animation, flat fallback) |
| qa-reviewer | tests (unit, API integration, Playwright e2e), accessibility and both-theme checks, reviews every agent's diff against the skills; read-only on source except test folders |
| asset-generator | Fizzly image generation (section 18); runs once after Wave 1, only after the manifest is approved |
| superadmin-panel | Super Admin panel UI and `/api/super` features (section 16); Phase 9 unless the user says earlier |

Folder ownership: `OWNERSHIP.md`.

### 2.3 Rules for all agents
- Stay inside your owned folders; never edit another agent's files. Request changes through the orchestrator.
- Build against `packages/shared` and mock data first so you never wait for another agent; mocks are replaced with real APIs at integration.
- Small commits on your own branch. Every task ends with: runs without errors, typecheck passes, lint passes, and a 5-line summary.
- No new dependencies without listing them in the summary; prefer the existing stack.
- Keep responses short; do not paste whole files in chat; write them to disk.
- Do not repeat work another agent already did; check the repo first.
- **Before starting a task, read the relevant skills listed in `SKILLS.md`. End every summary with `Skills used: ...`.** Summaries without it are sent back.
- Read only your module sections of this file plus `CONTRACTS.md` (section 2.4).

### 2.4 Skills
- `SKILLS.md` lists every installed skill (project `.claude/skills`, user `~/.claude/skills`, installed plugins); never invent skills; report missing useful ones.
- Mandatory reading per task: frontend-design for all UI work; any Three.js / R3F skill for the Team Floor; any NestJS / Prisma / testing skill for backend and QA.
- Project skills (under 150 lines each, referencing `packages/shared` rather than duplicating): `vistar-conventions`, `vistar-theming`, `vistar-realtime-events`; and, just before the phase that needs them, `vistar-webhooks-security`, `vistar-workflow-nodes`, `vistar-3d-floor`.
- qa-reviewer reviews what is built against these skills (design quality, both themes, accessibility, conventions) and returns a short fix list; owning agents fix only what fails and do not rewrite passing files.

### 2.5 Waves
- Wave 1 (parallel): backend-core, frontend-app (shell, theme, design system pages with mock data), frontend-physics (board and builder with mock data), frontend-3d (floor with simulated events).
- Wave 2 (parallel): realtime-integrations, workflow-engine, qa-reviewer (tests for Wave 1).
- Wave 3 (orchestrator): integration: connect frontends to real APIs and sockets, remove mocks, run the event simulator, fix contract mismatches.
- Wave 4 (parallel): qa-reviewer full e2e and accessibility pass, performance pass, bug fixes by owning agents.
- After each wave: merge branches, run the full test suite, run the app, show a short status (done, broken, next), and **wait for the user's "go"** before the next wave.
- The asset-generator runs after Wave 1 (section 18). superadmin-panel joins in Phase 9.

### 2.6 Saving time and credits
- Run independent agents in parallel, never serially.
- Give each agent only the context it needs (its spec sections + `CONTRACTS.md`).
- Reuse generated components; do not regenerate files that work.
- Stop and ask only for decisions that change scope; otherwise default and note it in `DECISIONS.md`.

## 3. Tech stack and platform rules

- Frontend: Next.js (App Router) + TypeScript, Tailwind CSS, shadcn/ui style components, TanStack Query, Zustand, Framer Motion (`motion`) for UI and react-spring for physics, React Flow (workflow graph), React Three Fiber + drei (3D), Recharts (charts).
- Backend: NestJS + TypeScript, PostgreSQL + Prisma, Redis + BullMQ (jobs, delays, retries), Socket.IO (realtime), S3-compatible storage (recordings, files).
- Auth: email/password + Google, JWT access + refresh, RBAC (section 5), strict tenant isolation on every query.
- Monorepo (pnpm workspaces): `apps/web`, `apps/api`, `packages/shared` (types, zod schemas, event names).
- Secrets only in server env. Never expose any API key to the browser.
- Exact versions: `DECISIONS.md` D-001.

## 4. Design system and theming (non-negotiable)

### 4.1 Look
- Clean enterprise look (Linear / HubSpot / Stripe). Not cartoonish, no neon, no glassmorphism, no decorative gradients.
- Font Inter; body 13-14 px. Radius 8 px (cards 12 px). Thin line icons (Lucide). Avatars are initials circles.
- One accent: indigo `#4F46E5`. Status colours only in soft chips: on call = blue, idle/available = green, busy = amber, offline = grey, error = red.
- All colours are CSS variables (design tokens) with two complete palettes:
  - Light: bg `#F6F7F9`, surface `#FFFFFF`, border `#E5E7EB`, text `#0F172A`, muted `#64748B`.
  - Dark: bg `#0F1115`, surface `#171A21`, border `#262A33`, text `#E8ECF6`, muted `#8B96B3`.
- The same tokens and both themes apply to all three panels (section 6).

### 4.2 Theme modes
- User setting, saved per user on the server: **System** (default, follows `prefers-color-scheme` live), **Light**, **Dark**, **Scheduled** (auto dark between user-chosen hours, e.g. 7 pm-7 am, in the workspace timezone).
- Apply the theme before first paint (no flash). Theme toggle in the top bar of every panel; also in Employee "Notifications and theme" preferences.
- Company admins set a workspace default theme in Settings; a webhook or schedule can switch a workspace's default theme (theme automation hook, section 13).
- Every screen, chart, 3D scene and email template must look correct in both themes.

### 4.3 Motion
- Purposeful and fast (150-250 ms). Numbers tick up smoothly, new table rows slide in with a brief highlight, sparklines update live, skeleton loaders everywhere.
- Respect `prefers-reduced-motion` (and the user's reduced-motion setting).

### 4.4 Responsive
- Full desktop layout, tablet, and a proper mobile layout (bottom nav). The Employee panel is mobile-first (section 17).
- On mobile and low-end devices, 3D views fall back to flat views automatically.
- No horizontal scroll at mobile widths except Board columns.

### 4.5 Accessibility
- WCAG AA contrast in both themes, full keyboard navigation, visible focus rings. Every drag-and-drop has a keyboard alternative. Charts and the 3D floor have text equivalents.

## 5. Roles, permissions and tenancy

### 5.1 Roles (final; replaces the original admin / manager / sales rep / viewer)
| Role | Scope | Panel |
| --- | --- | --- |
| SUPER_ADMIN | Platform owner, not tied to a workspace | Super Admin `/super-admin` |
| COMPANY_ADMIN | Whole workspace | Company `/app` |
| MANAGER | Their team(s) | Company `/app`; may also open Employee `/me` for their own work |
| EMPLOYEE (sales rep) | Own records | Employee `/me` |
| VIEWER | Read-only | Company `/app` (Dashboard, Leads, Reports) |

### 5.2 Permission matrix
- Role x resource x action, kept in config (`packages/shared/src/rbac.ts`) and enforced by backend guards.
- The UI hides what the API would reject, but the API is the source of truth.
- Company admins create custom roles from the matrix and set data visibility per role: own leads / team leads / all.

### 5.3 Visibility by role (Company panel)
- COMPANY_ADMIN: everything.
- MANAGER: Work (Dashboard, Leads, Inbox, Calls, Tasks), Team Floor, Team and Targets, Reports for their team only; Workflows read-only by default, edit only when an admin grants it through the permission matrix. Manager scope applies to dashboard, reports, floor and leads.
- VIEWER: Dashboard, Leads, Reports, read-only.
- EMPLOYEE (Employee panel) never sees: integrations, billing, roles, workflow editing (unless granted), other people's private data, bulk delete and import/export (unless granted).

### 5.4 Tenancy
- Every table carries `workspaceId`; strict tenant isolation on every query. Platform tables (Super Admin) are separate.
- One user belongs to one company for now, modelled through a **User-Workspace membership** join table so multi-company users can be added later without a painful migration. Super Admins stay separate (platform tables).

## 6. Panels, routing and navigation

### 6.1 Routing
- One Next.js app, route groups, shared design system, both themes:
  - `/super-admin/*` Super Admin panel
  - `/app/*` Company panel (COMPANY_ADMIN, MANAGER, VIEWER)
  - `/me/*` Employee panel (EMPLOYEE; managers can also open it for their own work)
- Redirect by role after login. Each area has its own layout, navigation and guards.

### 6.2 Super Admin authentication
- Separate from workspace auth: mandatory 2FA, session timeout, optional IP allowlist, API prefix `/api/super`, separate JWT audience.
- A workspace token can never call `/api/super` (and a platform token cannot call workspace APIs).

### 6.3 Navigation map
**Super Admin panel** (sidebar, dense table-first layout, same tokens): Overview; Companies; Plans and Billing; Usage; Feature Flags; Platform Health; Analytics; Support; Content; Audit Log; System Settings. Details: section 16.

**Company panel** (grouped sidebar):
- Work: Dashboard, Leads (Board default, Table optional), Inbox (WhatsApp), Calls, Tasks
- Automate: Workflows (builder, runs, templates), Webhooks and Logs
- Team: Live Team Floor, Team and Roles, Targets
- Insights: Reports
- Admin: Integrations, Billing and Usage, Settings (workspace, branding, business hours, pipeline stages, custom fields, tags, templates, roles and permissions, data visibility, lead routing, support access, theme default, audit log)

**Employee panel** (mobile-first bottom navigation: Home, Leads, Calls, Inbox, More). Details: section 17.

## 7. Module: Auth and onboarding
- Sign up, workspace creation, invite team by email or link, role assignment, timezone, business hours, working-day calendar (holidays).
- Email/password and Google sign-in; JWT access + rotating refresh; logout.
- Role-based redirect after login (section 6.1).
- Super Admin auth per section 6.2. Super Admin login, 2FA and the platform guard are built in **Phase 1**; the Super Admin panel features in **Phase 9**.

## 8. Module: Realtime dashboard
- KPI cards updating live over WebSocket: new leads, calls today, answered %, conversion %, revenue in INR, average response time.
- Funnel by stage; leads by source (IndiaMART, website, WhatsApp, manual, webhook); calls per hour; leaderboard with podium; live activity feed (lead assigned, call ended, stage moved); "Needs attention" panel (hot leads unassigned, overdue follow-ups, failed workflow runs).
- Date range and team filters. Manager sees team data only; Viewer read-only.

## 9. Module: Leads (Board default, Table optional)

### 9.1 Views and toggle
- The Leads page has two views: **Board** (default) and **Table** (optional). The same page serves all panels (`/app/leads`, `/me/leads`), scoped to the data the user may see.
- Toggle in the page header: segmented control `Board | Table`, same position at every screen size.

### 9.2 Persistence
- First visit: the workspace default if an admin set one, otherwise Board.
- Remember each user's last choice server-side in user settings (`leads.viewMode`, follows them across devices), with localStorage as an instant fallback.
- Optional workspace-level default set by admins in Settings (`leads.defaultViewMode`). A user's own choice (server setting or local fallback) overrides both the workspace default and Board.
- URL param `?view=board|table` lets a view be shared by link; it wins for that visit.

### 9.3 Shared across both views (no reset when switching)
- Search, filters, owner dropdown ("All users"), date range, saved views, selected lead count.
- Switching views cross-fades (200 ms, respects reduced motion) and preserves scroll position and open filters.
- Both views share one data hook (one TanStack Query cache) as the single source of truth.
- Both open the same Lead detail drawer/page and use the same quick actions (call, WhatsApp, note).

### 9.4 Board view
- WorkDo-style kanban: soft tinted stage columns, coloured dot, stage name, count chip, stage total in INR, "+" add button, compact cards.
- Cards show name, company, value in INR, owner avatar, tags, next follow-up.
- Drag and drop moves the stage with real spring physics (section 11.1), realtime sync across users, optimistic updates with rollback.
- Bulk selection through a "Select" mode with a bulk-actions bar.
- Mobile: Board stays default, horizontal column scroll, compact cards.

### 9.5 Table view
- Dense table with sticky header, column chooser, saved views, filters (source, stage, owner, tags, date, score), full-text search.
- Stage changes via inline dropdown.
- Bulk actions bar: assign, WhatsApp template, change stage, tag, delete.
- CSV/Excel import with column mapping and duplicate detection; export.
- Hover quick actions: call, WhatsApp, note.
- Mobile: renders as a card list (one card per lead) with the same fields; the toggle stays available.

### 9.6 Scoring and permissions
- Lead score: rules-based now, AI-ready.
- Bulk delete and import/export are hidden for employees unless granted.

## 10. Module: Lead detail
- Profile card, score ring, deal value, stage progress bar, owner.
- Unified timeline: calls with recordings, WhatsApp messages, notes, emails, stage changes, workflow steps taken.
- Tasks, files, tags, custom fields. "Run workflow" button. Merge duplicates.
- Opened as a drawer from both Leads views or as a full page.

## 11. Module: Pipeline (Board behaviour and stages)
The pipeline is the **Board view of the Leads page** (section 9.4); there is no separate Pipeline page. Stages are managed in Settings > Pipeline stages.

### 11.1 Board physics
- Lift on pick-up (scale + growing shadow); tilt from pointer velocity (max ~8 degrees, smoothed); inertia on release, then snap to the slot with a slight overshoot; dashed placeholder at the origin; target column highlight; neighbours nudge apart.
- Optimistic update with rollback on error; realtime sync across users.
- Keyboard-accessible alternative (move with a menu).

### 11.2 Stages
- Configurable stages (default: New, Contacted, Interested, Quote sent, Won, Lost) managed in Settings > Pipeline stages. Column totals in INR.
- New leads (create, quick add, import, webhooks) appear at the TOP of their stage column. Moves without neighbours (e.g. Table inline stage change) go to the end of the target column.

## 12. Module: Live Team Floor (signature feature, Three.js)
Reference: an isometric 2.5D animated office dashboard where each worker visibly works in real time, with a KPI strip on top and a "Needs you" side panel (game-style ops view), styled to this product's clean theme.

- React Three Fiber, orthographic camera at a fixed isometric angle (~35 degrees), limited pan/zoom, no free orbit. Soft shadows, baked-look lighting.
- Light theme = bright daylight office; dark theme = evening office with warm lamp glow and glowing monitors. The scene reacts when the theme changes.
- Rooms: sales floor with desks, glass calling room, manager cabin, lounge (idle area), central "Lead Hub" machine where new leads arrive.
- Employees: stylised low-poly rigged characters (GLB, shared skeleton) with clips idle, typing, talking on phone, walking, sleeping/away. Name tag above each head with status dot and call timer for active calls. Avatars customisable (skin, hair, outfit colours). Until GLB assets exist, characters are procedural behind a swappable character-model interface.
- Driven by realtime events, not fake timers:
  - `employee.status_changed` -> clip changes (on call: phone + pulse ring; busy: typing; idle: lounge or waving; offline: sleeping or empty chair)
  - `lead.created` -> glowing parcel appears at the Lead Hub
  - `lead.assigned` -> parcel travels to the assigned employee's desk; employee turns and receives it
  - `call.started` / `call.ended` -> sound-wave rings and timer; on end an outcome popup (answered / missed / interested)
  - `task.overdue` or hot lead -> "Needs you" speech bubble above the employee or manager, clickable to resolve
- Characters walk between desk, calling room and lounge using grid-based A* pathfinding.
- Click an employee: side panel with live status, current lead, calls today, average talk time, targets, recent activity, actions (reassign lead, message, view recordings if permitted).
- Top KPI strip (active, on call, idle, busy, calls today, leads waiting) and an accessible text list of all employees mirroring the 3D state (screen readers and fallback).
- Performance: instanced meshes for repeated props, LOD, max 200 employees, adaptive quality tiers (auto-detect GPU, FPS monitor lowers quality), lazy-load the whole Three.js bundle only when this page opens, pause rendering when the tab is hidden.
- Settings toggle "3D mode / Flat mode"; default flat on mobile and with `prefers-reduced-motion`.
- Manager sees their team; the Employee panel shows the floor read-only and flat by default. Feature flag `team_floor_3d` per plan/company (section 16).

## 13. Module: Workflow automation (builder + engine)

### 13.1 Builder (n8n-like)
- React Flow canvas with a "depth UI" look: node cards with layered shadows, thickness edge, perspective, hover lift. Dotted grid, minimap, zoom/pan/fit, undo/redo, copy/paste, multi-select, auto-layout, keyboard shortcuts.
- Drag physics as on the Board: lift, velocity-based tilt, inertia, snap with overshoot, neighbour repulsion.
- Rope-like edges (verlet simulation, ~12 points) that sag and swing, with animated data packets during runs. Pause simulation when idle. Flat mode toggle for low-end devices.
- Right panel: node settings with template picker, variable picker (`{{lead.name}}`), message preview, validation errors.

### 13.2 Node types
- Triggers: IndiaMART lead, website form, inbound webhook, WhatsApp message received, new contact, stage changed, call missed, schedule (cron).
- Actions: create/update contact, send WhatsApp template, send WhatsApp free-form (only within the 24 h window), send email/SMS, create task, create call task, assign owner (round-robin, least-busy, by rule), add tag, change stage, call outbound webhook, update custom field.
- Logic: wait (minutes/hours/days, business-hours aware), condition (replied?, keyword match, field compare), branch/switch (source, city, deal value), loop limit, stop.
- AI node (behind the `ai_node` flag, **off by default** on every plan and globally via `FEATURE_AI_NODE`): classify reply intent (price, catalog, not interested, other). For now the classifier is **keyword/rule-based**, behind an intent-classifier provider adapter interface; no AI provider is chosen yet.

### 13.3 Engine
- Workflow JSON `{nodes, edges, version}`. Runs on BullMQ with persistent delays, retries with backoff, idempotency, concurrency limits.
- Per-lead execution log (node, time, result, message sent).
- Test run with a dummy lead showing pass/fail per node live on the canvas.
- Draft/Active toggle, version history, rollback, duplicate. Run view: packets travel through nodes in real time.
- Compliance guards: opt-in/opt-out (DND) check before every message, approved templates only for first contact, 24 h window enforcement, quiet hours, rate limits per number.

### 13.4 Templates to ship
- **IndiaMART nurturing** (example): IndiaMART lead -> dedupe -> create contact + deal -> WhatsApp welcome template -> wait 2 hours -> replied? YES: intent switch (price: send price list + create task for rep; catalog: send catalog; not interested: mark lost) / NO: wait 1 day -> follow-up 1 -> wait 2 days -> create call task -> mark cold.
- Missed-call follow-up, quote reminder, inactive lead revival.

### 13.5 Access
- Employees cannot edit workflows unless granted. Managers are read-only by default; admins grant edit through the permission matrix (section 5.3).

## 14. Module: WhatsApp inbox
- Official WhatsApp Cloud API only.
- Conversation list, chat view, template messages, quick replies, attachments, assign/transfer, internal notes, unread counts, delivery/read status via webhooks, 24 h window indicator, opt-in tracking.
- Employees see their own conversations (team inbox if granted).

## 15. Modules: Calls, Tasks, Reports, Team, Integrations, Notifications, Settings

### 15.1 Calls
- Click-to-call via a telephony provider adapter interface so providers are swappable. **Only the mock adapter is built for now**; Exotel is the first real adapter later, behind the same interface.
- Call logs table with duration, outcome chips, recording player with waveform, notes, disposition (also after a call in the Employee panel).
- Live call events feed the dashboard and Team Floor.

### 15.2 Tasks and follow-ups
- My tasks, team tasks, due/overdue, reminders (in-app + push + email), call tasks created by workflows, snooze, calendar view.
- Employee panel: offline-tolerant task list.

### 15.3 Reports
- Conversion funnel, source ROI, team and rep performance, response-time SLA, call analytics, workflow performance, revenue forecast.
- Date ranges, comparisons, scheduled email reports, CSV/PDF export. Manager: team only; Viewer: read-only.

### 15.4 Team, roles and targets
- Employee cards, status, monthly targets with progress rings, permissions matrix, teams/groups, working hours, lead routing rules.
- Company admin: custom roles from the matrix, data visibility (own / team / all), routing rules, working hours, holidays, branding.

### 15.5 Integrations and webhooks (first-class)
- Integration hub with connect/test/status for IndiaMART (Lead Manager API/webhook), WhatsApp Cloud API, telephony provider, email (SMTP), Google Calendar.
- Inbound webhooks: unique URL per source per workspace (`POST /api/hooks/{workspaceId}/{sourceKey}`), HMAC-SHA256 signature verification, timestamp tolerance, idempotency key, payload mapping UI (incoming fields -> lead fields) with sample payload preview. A webhook can start a workflow or just create a lead.
- Outbound webhooks: subscribe to events (lead.created, lead.updated, lead.assigned, stage.changed, call.ended, message.received, task.overdue, workflow.failed), signed payloads, retries with exponential backoff, dead-letter queue.
- Webhook log UI: every delivery with status, payload, response, latency, one-click replay.
- Public REST API with API keys (scoped, rotatable, shown once) and OpenAPI docs.
- Theme automation hook: user-level setting API plus scheduled theme mode, so a webhook or schedule can switch a workspace's default theme.

### 15.6 Notifications
- In-app centre, web push, email digest. Per-user preferences. Realtime toasts for assignments and replies.

### 15.7 Company settings, billing and admin
- Settings: workspace profile, branding (logo, accent colour applied within contrast limits), business hours, holidays, custom fields, pipeline stages, tags, templates, roles and permissions, data visibility, lead routing, support access (toggle with expiry), theme default, Leads default view, audit log.
- Billing and Usage: subscription plan and usage metering against plan limits; payment via Razorpay (adapter) or manual invoice (section 16).
- Data export, data retention, delete-my-data.
- Audit log (who did what, when). Every sensitive action (role change, impersonation, plan change, export, delete) writes an audit entry; impersonation is visible to the company.

## 16. Module: Super Admin panel (superadmin-panel, Phase 9 unless brought forward)
1. Overview: platform KPIs (active companies, MRR, signups, churn), health summary.
2. Companies: list, create, edit, suspend/reactivate, delete; detail (users, leads, usage, last active, plan, flags).
3. Plans and Billing: plan catalogue and limits, assign/change plan, trials, invoices, payments, coupons. Payments use **Razorpay behind a payment-provider adapter**, with **manual invoices** as the fallback. No Stripe.
4. Usage: per-company and platform metering, limit alerts.
5. Feature Flags: per company and per plan (Live Team Floor 3D, AI node, telephony, API access).
6. Platform Health: queue monitor, failed jobs, webhook failures across tenants, integration status, error rate.
7. Analytics: signups, MRR, churn, feature adoption.
8. Support: time-limited "View as company" impersonation.
9. Content: workflow template library, default pipeline stages, WhatsApp template suggestions, announcements and banners.
10. Audit Log.
11. System Settings: default theme, email sender, rate limits, super admin users.

Details:
- Impersonation: time-limited (default 30 min), requires a reason, persistent banner, read-only by default, never exposes message or call-recording content unless the company enabled Support access, fully written to the audit log and visible to the company.
- Plans: limits for seats, leads, WhatsApp messages, workflow runs, storage; usage enforced in the API; overage rules.
- Every Super Admin action is audit logged. Handles data export and delete-my-data requests.
- Auth: section 6.2.

## 17. Module: Employee panel (built right after Leads, Phase 2-3)
- Mobile-first bottom navigation: Home, Leads, Calls, Inbox, More.
- Home: today view (tasks due, follow-ups, calls to make, new assigned leads), targets with progress rings, today's stats.
- Leads: the same Leads page (Board default, Table optional) scoped to visible data.
- Calls: click-to-call, call log, notes and disposition after a call.
- Inbox: own WhatsApp conversations (team inbox if granted), templates, quick replies.
- More: Tasks and Reminders; My Performance (rank can be disabled by the company); Team Floor (read-only, flat by default); Status control (Available, On call, Break, Offline; feeds the floor and presence); Profile and avatar customisation; Notification and theme preferences (System/Light/Dark/Scheduled).
- Requirements: installable PWA, large touch targets, fast first load, offline-tolerant task list, push notifications, no horizontal scroll except Board columns.
- Hidden items: section 5.3.
- Status mapping: Available = `idle`, On call = `on_call`, Break = `away`, Offline = `offline`. Busy is set automatically from activity. Error is a system state (red chip for failures), not a selectable employee status.

## 18. Module: Image assets (Fizzly Workflows API, asset-generator)
- Runs once, after Wave 1, and only after the user approves the manifest.
- Credentials only from server env: `FIZZLY_API_KEY`, `FIZZLY_WORKFLOW` (`username/slug`; the workflow id always comes from this env var), `FIZZLY_MAX_CREDITS`. Never hardcode, print, commit or send the key to the browser. `.env` is gitignored; `.env.example` has empty values. If a variable is missing, stop and ask.
- API: base `https://queue.fizzly.ai/workflows/{username}/{slug}`, header `Authorization: Key $FIZZLY_API_KEY`. `POST {"inputs": {...}}` returns `request_id`, `status_url`, `response_url`, `cancel_url`. Poll `status_url` every 2 s until `COMPLETED` or `FAILED` (reports progress and `credits_used`). `GET response_url` returns `images[]` (url, width, height) and `metrics.credits_used`. `POST cancel_url` cancels. **Never guess input field names.**
- **Input fields** (confirmed from the workflow's sample payload): `prompt`, `aspect_ratio`, `model`, `resolution`, `guidance_scale`, `num_images`, `mock_mode`. **Omit** `character_id`, `reference_image_ids` and `reference_images` (they belong to a character workflow). Never store sample reference URLs or character ids in the repo.
- Defaults: `model: "nano-banana-2"`, `num_images: 1`, `aspect_ratio` per asset. Smallest size (test image) = `resolution: "1K"`. `guidance_scale`: leave it out unless the API requires it; if it does, ask for the value.
- Dry run: try `mock_mode: true` first, but verify from `credits_used` (status and response) that it spends **zero** credits before relying on it; if it spends credits, stop and report.
- `scripts/assets/generate.mjs` (Node, no extra deps): manifest-driven, polling with timeout and retries, downloads to `apps/web/public/generated` as `.webp`, writes `assets.json` (id, path, size, prompt, credits used).
- Credit safety: (1) dry run first: print manifest, image count, estimated credits, wait for approval; (2) generate ONE test image at the smallest size and show credits used; (3) track cumulative credits and abort if the next image would exceed `FIZZLY_MAX_CREDITS`; (4) skip assets that exist, regenerate only with `--force <id>`; (5) sequential, max 2 parallel, stop on the first `FAILED`.
- Manifest (max 10; consistent style: clean modern B2B SaaS, soft indigo `#4F46E5`, no text inside images): hero-login (isometric office, 16:9, light and dark variants), empty-leads, empty-calls, empty-workflows (simple isometric spot illustrations), dashboard-banner (subtle data-flow art), icon-set (leads, calls, workflows, reports as clean 3D-style icons), team-avatars (6 friendly stylised employee portraits; cartoon allowed only here).
- The UI must work without these images: CSS/SVG fallbacks, lazy-loaded with `next/image`.

## 19. Realtime architecture
- Socket.IO with rooms per workspace and per user. Typed event contract in `packages/shared`.
- Server emits domain events after DB commit. Clients update the TanStack Query cache from events (no polling).
- Reconnect with backoff and state resync. Presence (online/idle/on-call) computed from heartbeats and call events, plus the Employee status control.

## 20. Data, security, quality, seed, build order, deliverables

### 20.1 Data model (Prisma; all tenant tables carry workspaceId)
Workspace, User, Role, Team, Lead, Contact, Company, Deal, Stage, Pipeline, Activity (timeline), Call, Message, Conversation, Template, Task, Workflow, WorkflowVersion, WorkflowRun, WorkflowRunStep, Integration, WebhookEndpoint, WebhookDelivery, ApiKey, Notification, AuditLog, Target, Setting (incl. theme preferences, `leads.viewMode`, `leads.defaultViewMode`), ConsentRecord; plus platform tables for Super Admin, plans, usage, feature flags and impersonation sessions. Current schema: `apps/api/prisma/schema.prisma`.

### 20.2 Security
- Tenant isolation tests, RBAC guards, input validation (zod), rate limiting, encrypted integration secrets, signed URLs for recordings, CORS and CSP, audit logs, consent tracking (opt-in/opt-out), PII-safe logging. Secrets only in server env.

### 20.3 Tests and quality bar
- Unit: workflow engine, webhook signature verification.
- API integration tests, including tenant isolation for every role; EMPLOYEE cannot reach `/app` or `/super-admin` routes or APIs; COMPANY_ADMIN cannot reach `/super-admin`; a workspace token cannot call `/api/super`; impersonation banner and expiry.
- Playwright e2e: login (role-based redirect), route guards, lead import, pipeline drag, workflow test run, employee mobile viewport flow, Leads view mode (default Board on first visit, choice persists after reload and in another browser session, URL param override, filters survive a view switch, workspace default respected).
- WCAG AA contrast in both themes (all three panels), full keyboard navigation, focus rings.
- Lighthouse performance 85+ on core pages (3D page excluded from the budget but lazy-loaded).

### 20.4 Seed data and simulator
- 1 Super Admin; 3 companies on different plans, each with an admin, managers and employees, so all three panels can be demoed.
- Realistic Indian data in the main company: 2,500 leads across IndiaMART / WhatsApp / Website, INR deal values, 12 employees with varied statuses, calls, conversations, 4 ready workflows.
- Simulator script emitting live events (new leads, calls starting and ending, replies) so the dashboard and Team Floor animate without real integrations.

### 20.5 Build order (final)
| Phase | Scope |
| --- | --- |
| 1 | Monorepo, design tokens, light/dark/system/scheduled theme, auth, layout shell, RBAC; **role model, permission matrix, guards, the three route groups with navigation shells** |
| 2 | Leads, lead detail, import/export, tasks, notifications; **Employee panel right after Leads (Phase 2-3)** |
| 3 | Leads Board with spring-physics drag and drop, realtime sync |
| 4 | Realtime backbone (Socket.IO, events), live dashboard, event simulator |
| 5 | Integrations hub, inbound/outbound webhooks with logs and replay, IndiaMART and WhatsApp Cloud API adapters, WhatsApp inbox |
| 6 | Workflow engine (BullMQ) and the depth-UI builder with test runs and templates |
| 7 | Telephony, call logs, recordings |
| 8 | Live Team Floor (R3F isometric office, animated characters, event-driven) |
| 9 | Reports, team targets, billing, audit log; **Super Admin panel** |
| 10 | Hardening, performance, accessibility, e2e tests, deployment docs (Docker Compose, env vars, CI) |

Waves (section 2.5) run the frontends of later phases early against mocks; backends follow the phase order.

### 20.6 Deliverables
- Full source code; README with setup in under 10 minutes; `.env.example`; seed and simulator scripts; OpenAPI spec; a short architecture doc.

## 21. Pending specs and resolved questions

### 21.1 Pending specs (arrive after the Wave 1 check report; do not design or build anything for them yet)
- Industry packs
- Real estate pack
- Real estate supplement
- Live site-visit map
- Board physics (a separate message that will be resent). Until then the physics in sections 9.4 and 11.1 apply.

The "also add this additional feature" fragment in change #5 is void; no extra feature was intended.

### 21.2 Resolved questions (2026-11-01)
| # | Question | Answer (applied in) |
| --- | --- | --- |
| 4 | Pipeline page vs nav map | Pipeline = Board view of Leads; stages in Settings (11) |
| 5 | First-visit view vs workspace default | Workspace default if set, else Board; user's own choice overrides both (9.2) |
| 6 | Status labels | Available = idle, Break = away, Busy automatic, Error is a system state (17) |
| 7 | Super Admin timing | Login, 2FA, guard in Phase 1; panel in Phase 9 (7, 16) |
| 8 | Phases vs waves | Builder and Team Floor frontends early on mocks; backends follow phase order; wiring in Wave 3 (2.5, 20.5) |
| 9 | Manager workflow access | Read-only by default; admins grant edit via the matrix (5.3, 13.5) |
| 10 | One user, one company | Yes for now, modelled as a User-Workspace membership join table (5.4) |
| 11 | Payments | Razorpay behind a payment adapter + manual invoices; no Stripe (15.7, 16) |
| 12 | Telephony | Mock adapter only; Exotel first real adapter later (15.1) |
| 13 | AI node | Off by default; keyword/rule-based classifier behind a provider adapter (13.2) |
| 14 | Fizzly inputs | Field names, defaults, smallest size, mock_mode check (18) |
