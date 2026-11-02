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
| pack-realestate | **Planned, not created.** Real Estate pack (sections 23, 24): owns `apps/web/features/realestate`, `apps/api/src/modules/realestate`, `packs/realestate` |
| frontend-map | **Planned, not created.** Live Site-Visit Map (section 25): owns `apps/web/features/map`, `apps/api/src/modules/tracking` |

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

### 11.1 Board physics and motion (final version: board physics change #12, replaces the earlier summary)
Goal: the Leads Board feels like a physical, premium product. Cards behave like real thick cards with weight, momentum and depth, at 60 fps on a mid-range phone. It still looks clean and professional (Linear / Stripe level), not playful or neon, in light and dark themes.

**Stack:** React + TypeScript, Pointer Events, react-spring (or Motion) springs, transform/opacity only. `@dnd-kit` optional and only for accessibility, sensors and collision detection; the dragged card is rendered and animated by our own spring layer. No heavy physics engine: spring dynamics with real velocity, mass and damping.

**Card depth (always on)**
- Perspective on the board (~1200 px). Cards have layered soft shadows (contact + ambient), a 1 px top highlight edge and a subtle thickness edge so they read as thick cards.
- Idle: slight hover lift on desktop (translateZ + shadow growth, 150 ms) and a very subtle specular sheen that follows the pointer (desktop only).

**Drag behaviour**
1. Pick-up: desktop on pointer down after 4 px movement; touch after a 180 ms long-press with a haptic tick (`navigator.vibrate` where available). The card lifts on a spring (stiffness ~320, damping ~22, mass 1): scale 1.05, translateZ, shadow grows and blurs, neighbours dim slightly (opacity 0.9).
2. While dragging: the card follows the pointer with a light spring lag (weight). Pointer velocity is low-pass filtered; rotateZ and rotateX/rotateY follow velocity, clamped to ~8 degrees, smoothed by a spring, levelling out when the pointer stops. The shadow offset moves opposite to the motion; the specular highlight shifts with tilt.
3. Placeholder: dashed outline slot at the origin. Over a column, a gap opens at the target index with a spring; other cards slide apart with staggered springs (no instant jumps). The target column gets a soft highlight and its count chip pulses.
4. Edge auto-scroll: vertical inside a column and horizontal for the board near edges; speed ramps with proximity; smooth and cancelable.
5. Drop: inertia from the release velocity carries the card a little, then a spring snaps it into the slot with a small overshoot; scale returns to 1, shadow settles, tilt levels. A 400 ms ring/glow pulse in the stage colour confirms the move; the stage total animates (number tick). Dropped outside a column, it springs back to the origin with a gentle bounce.
6. Optimistic update immediately; rollback animation plus toast on API error. Realtime: a card moved by another user animates along an arc (spring) to its new place instead of teleporting; a new realtime lead drops into the "New" column from above with a soft landing and highlight.
7. Multi-select drag (optional, if time): selected cards stack like a deck with a count badge.

**Motion polish**
- Staggered entrance of columns and cards on first load (fast, 40 ms stagger, once only).
- Count chips and INR totals use animated number ticks.
- Card hover actions (call, WhatsApp, note) slide in with a spring; on mobile a long-press opens them.
- Skeleton loaders with a subtle shimmer; cards re-flow with springs when filters change.
- Column header shows a thin progress bar of the stage's share of total value.
- UI durations 150-250 ms; springs for physical motion; no animation without purpose.

**Performance**
- Animate only transform and opacity; `will-change` on the dragged card during drag only.
- Dragged card rendered in a portal overlay (no column layout thrash); columns over ~50 cards are virtualised and drag still works.
- Idle animations pause when the tab is hidden. Target 60 fps on a mid Android phone; adaptive quality reduces tilt, shadows and sheen if FPS drops under 45.
- "Reduce motion / Flat mode" setting and `prefers-reduced-motion`: no tilt, sheen, overshoot or stagger; a simple fade-move transition remains.

**Accessibility**
- Keyboard: Space picks up, arrow keys move between positions and columns, Space drops, Esc cancels; live-region announcements ("Moved Ryan Murphy to Contacted, position 2").
- A "Move to..." menu on every card as the non-drag alternative. Visible focus rings. Touch targets at least 44 px.

**Quality**
- Spring constants and limits in one config file (`board-physics.config.ts`), tunable without code changes.
- A demo page with sliders for stiffness, damping and tilt limit, plus a "slow motion" toggle.
- Playwright e2e: drag between columns, drop outside (spring back), keyboard move, rollback on API failure, reduced-motion mode.
- The same physics module is reused by workflow builder node dragging (extracted to `features/shared/physics`).

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

### 12.1 Art target V3 (change #16, received 2026-11-01) — ACTIVE (frontend-3d)
Applies on top of the current floor (Wave 1 build and its polish commits). The message says "on top of the second polish pass", but no second polish pass spec was received; its label rules are restated in 12.1.5 below. All event handling, the KPI strip, the "Needs you" panel and permissions stay unchanged.

**Reference**: an AI-generated concept render (`docs/screenshots/team-floor-v3/reference.jpg`, 1344x768). Use it for comparison only; never ship it in the product. Match its composition, colour richness, material quality and character readability as closely as real-time rendering allows:
- L-shaped open office, thick walls with trim, warm wood floor with visible grain, teal and dark-slate wall bases, warm sconces.
- Distinct rooms:
  - Open sales floor with fewer, well-spaced desks (one person per desk, never a dense wall of desks).
  - Glass-walled calling room with 3 booths.
  - Dark-wood manager cabin with a bookshelf, lamp and desk.
  - Lounge with a green sofa, rug, coffee table, window and plants.
  - Reception desk with a glowing blue edge at the entrance.
  - Props: printer corner, whiteboard with sticky notes, water cooler, cabinets, many plants of different sizes.
- Central "LEAD HUB" cylinder machine with a glowing blue ring on the floor.
- Characters about 1.5x larger than before relative to desks, clearly readable, in natural poses with varied clothes and hair: typing, on a phone call (blue ring under the chair), waving in the lounge, sleeping or resting at reception, walking with a document.
- A name tag with a coloured status dot above each head: short, clean, no overlap. A status ring on the floor for active calls.
- Soft warm daylight, soft shadows, ambient occlusion, emissive monitors.

**Approach** (real 3D, stylised, high polish):
1. **Scene authoring**: modular GLB scene (rooms, walls, floors, furniture, props) built in Blender (Blender MCP is installed: live Blender on `127.0.0.1:9876`; scripted `blender --background` runs are preferred so the scene can be rebuilt from the repo). CC0 or permissively licensed packs (e.g. Kenney, Quaternius, Poly Pizza) may be used; every license goes in `docs/ASSETS.md`. Custom geometry has bevels. Export an optimised GLB (Draco or meshopt; KTX2 or WebP textures).
2. **Lighting**: bake ambient occlusion and a lightmap per theme (Day and Evening). Add one soft directional light for dynamic shadows, emissive monitors and lamps, and restrained bloom on emissive surfaces only. Light theme = Day; Dark theme = Evening with warm lamp pools and cool window light. Switching theme cross-fades between the two baked variants.
3. **Characters**: rigged GLB with a shared skeleton. Clips: idle, typing, phone call, walking, wave, sleeping or resting. Outfit, skin and hair variants come from avatar settings. Soft rim light and a thin outline for separation.
4. **Layout as data**: the office is a JSON floor template (rooms, seat slots with position and facing, calling booths, lounge spots, walking graph, hub position).
   - Three templates in the same style: Small (up to 8 seats), Medium (up to 20) and Large (up to 50).
   - Employees are assigned to seats from the data. Extra people use lounge or "hot desk" spots.
   - Offline people sit asleep at their desk, or the chair is empty.
   - Pathfinding runs on the walking graph.
5. **Labels**: a collision-avoiding layer with zero overlaps in the default view:
   - Labels are placed in priority order, with leader lines when a label has to move.
   - When crowded, a label shrinks to the status dot plus initials.
   - "Needs you" and "Missed" bubbles get their own lane.
6. **Camera**: auto-fit the whole office at an isometric angle similar to the reference, with eased zoom and pan limits, click-to-focus fly-to, and a Fit button.
7. **Flat view**: a clean 2D plan with the same room colours, seat dots and status rings. Used on mobile, on low-end devices and with reduced motion.
8. **Performance**:
   - Instanced repeated props and merged static meshes.
   - The scene and characters lazy-load only on this page.
   - Adaptive quality tiers with an FPS monitor.
   - Target 60 fps on a mid laptop with 30 employees.
   - Pause rendering when the tab is hidden.

**Order**: Medium template first (it matches the reference), Day variant first, then Evening, then Small and Large.

**Verify (mandatory loop)**:
- Playwright screenshots of the Medium template at 1440x900 and 1920x1080, DPR 1 and 2, light and dark, plus a zoomed calling-room shot and a mobile Flat shot.
- A side-by-side comparison sheet: the reference on the left, our screenshot on the right.
- Self-critique on colour richness, room distinctness, character readability, label cleanliness and lighting; fix and repeat, up to 8 iterations.
- Save everything to `docs/screenshots/team-floor-v3/`.

**Report** (8 lines): what was built, asset list with licenses, screenshot paths, FPS, gaps versus the reference, and which additional models or characters would close those gaps.

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

### 18.1 hero-login prompts (change #15, received 2026-11-01)
The user sent a reference render (light theme) plus the prompts below for `hero-login`. Use them verbatim as the `prompt` input; do not reword them.
- Reference render (seen in chat, not stored in the repo): isometric cutaway office on a light-grey background. It has a glass calling room with three agents, a walnut manager cabin, a lounge with a teal sofa, a white reception desk with an indigo underglow, a central cylindrical "lead hub" with a blue floor ring, about 15 people with first-name tags and status dots, and blue pulse rings under people on calls. It shows readable text ("LEAD HUB", name tags) and a logo on the reception desk.
- **hero-login-light** (16:9): "Isometric 2.5D cutaway view of a modern sales office floor, shown as a polished 3D game-style diorama, viewed from a fixed 35-degree isometric angle, the whole office floating on a plain soft light-grey background. Clean enterprise style, not cartoonish, not neon. Layout: one large open sales floor with rows of white desks, ergonomic chairs and glowing monitors; a glass-walled calling room with acoustic panels; a darker wood manager cabin; a lounge with a rug, sofas and plants; a reception desk; a round glowing "lead hub" machine in the center with a soft blue ring on the floor. Thick walls with trim, large windows, doors, a whiteboard, shelves, a water cooler, printers, potted plants of different sizes, ceiling lamps. Materials and color: warm light-wood floors on the sales floor, soft grey carpet in the calling room, dark walnut in the manager cabin, deep teal and warm beige accents, indigo (#4F46E5) highlights, clear contrast between floor, furniture and people. No white-on-white. People: 12 stylized low-poly employees, clearly readable at this zoom, diverse Indian men and women in smart casual clothes: some typing at desks, some on phone calls with a small blue pulse ring on the floor, one waving in the lounge, one asleep at a desk, one walking with a document. Small floating name tags with a colored status dot (blue, green, amber, grey), no readable text beyond short first names. Lighting: bright warm daylight from the upper left, soft realistic shadows, ambient occlusion, emissive monitor screens, subtle depth and bevels on every object, high detail, crisp edges, 3D render quality like a premium isometric game or Monument Valley meets a modern SaaS dashboard. 16:9, sharp, high resolution."
- **hero-login-dark** (16:9): "Same isometric 2.5D sales office diorama and layout as before (open sales floor with desks and monitors, glass calling room, manager cabin, lounge, reception, central glowing lead hub), now in an evening dark theme: deep navy background (#0F1115), warm lamp glow over desks, cool blue light through the windows, glowing monitor screens, warm wood floors and walnut cabinet tones still visible, soft rim light on the characters so they stand out, subtle bloom only on lights and screens, status rings in blue, green, amber and grey. 12 diverse stylized low-poly employees working (typing, on calls, one asleep, one waving, one walking). Premium isometric 3D render, crisp, high detail, 16:9." The dark prompt says "same ... as before", but each request is independent, so the dark image may not match the light one unless the layout part of the light prompt is repeated (open question).
- **Negative prompt** (both): "photorealistic people, blurry, low resolution, washed-out white on white, flat 2D, cartoon children style, neon cyberpunk, text paragraphs, watermark, logo, extra fingers, distorted faces, messy clutter, top-down flat plan, fisheye, noise". `negative_prompt` is not one of the confirmed workflow input fields, so it must not be sent as a field until the user confirms the field name (open question).
- Open questions, also in `docs/STATUS.md`:
  - The name tags conflict with the manifest rule "no text inside images".
  - How to pass the negative prompt.
  - Whether this render is also the visual target for the Live Team Floor (section 12).
- Generation still follows the credit-safety steps above: dry run, one 1K test image, then approval.

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
- Industry packs: install / upgrade / uninstall idempotency; migration of existing data; custom field validation and per-field permissions; tenant isolation of custom objects and records.
- Board physics e2e: drag between columns, drop outside (spring back), keyboard move, rollback on API failure, reduced-motion mode.
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
| 2 | Leads, lead detail, import/export, tasks, notifications; **Industry Packs core: flexible data layer, pack manifest, registry (section 22)**; **Employee panel right after Leads (Phase 2-3)** |
| 3 | Leads Board with spring-physics drag and drop, realtime sync |
| 4 | Realtime backbone (Socket.IO, events), live dashboard, event simulator |
| 5 | Integrations hub, inbound/outbound webhooks with logs and replay, IndiaMART and WhatsApp Cloud API adapters, WhatsApp inbox |
| 6 | Workflow engine (BullMQ) and the depth-UI builder with test runs and templates |
| 7 | Telephony, call logs, recordings |
| 8 | Live Team Floor (R3F isometric office, animated characters, event-driven) |
| 9 | Reports, team targets, billing, audit log; **Super Admin panel** |
| 10 | Hardening, performance, accessibility, e2e tests, deployment docs (Docker Compose, env vars, CI) |

Waves (section 2.5) run the frontends of later phases early against mocks; backends follow the phase order.
Industry pack work after the core (all planned): Real Estate basics -> Real Estate supplement (section 24 order) and, after the realtime backbone, the Field Live map (section 25). See section 26.

### 20.6 Deliverables
- Full source code; README with setup in under 10 minutes; `.env.example`; seed and simulator scripts; OpenAPI spec; a short architecture doc.

## 21. Pending specs and resolved questions

### 21.1 Pending specs
- None pending. Industry Packs (22), Real Estate pack (23), Real Estate supplement (24), Live Site-Visit Map (25) and board physics (11.1) were received on 2026-11-01.

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

## 22. Industry Packs architecture (Part 1) — ACTIVE (executing now)

Goal: the core CRM stays the same for every business; an **Industry Pack** adds industry-specific data and screens on top. Packs are add-ons that the Super Admin enables per company or per plan (entitlement + billing), and the company admin activates in **Settings > Industry**. The orchestrator builds the architecture first, updates `packages/shared`, `CONTRACTS.md`, `OWNERSHIP.md`, and creates the skill `vistar-industry-packs`.

### 22.1 Flexible data layer (must exist before packs)
- **Custom objects**: name, fields, relations.
- **Custom fields on every core entity**.
- **Configurable pipeline stages** and **configurable labels** (e.g. "Lead" displayed as "Enquiry").
- All of it is stored in the database, not in code.
- Field types: text, number, money (INR), date, select, multi-select, user, relation, file, geo-point.
- Validation; permissions per field; show/hide per role.

### 22.2 Pack manifest (JSON, versioned)
Declares objects and fields, pipeline stages and labels, workflow templates, WhatsApp template suggestions, dashboard widgets, reports, import mappings, roles/permissions, navigation items and map layers.
Installing a pack = applying its manifest to a workspace: **idempotent, upgradeable, removable without deleting user data**.

### 22.3 Pack registry (Super Admin panel)
List packs and versions, enable per company / per plan, preview a manifest, usage per pack.

### 22.4 No forks of core code
New screens plug in through a **route/menu extension point** and **widget slots**.

### 22.5 First packs
- Build **"Generic Sales"** (default) as the example now.
- "Real Estate" is the second example; with the scope lock its manifest belongs to section 23 (planned).
- Later, in the same manifest format: education, insurance, finance/DSA, auto dealers, travel, interior/solar, recruitment, wholesale/IndiaMART, clinics (enquiry only).

### 22.6 Order and migration
- Industry Packs core is Phase 2 work. Leads is already built, so existing Leads and pipeline data are migrated carefully without breaking anything (tests must stay green).

### 22.7 Quality
- Tests for pack install / upgrade / uninstall idempotency.
- Tests for the migration of existing Leads and pipeline data.
- Both themes and WCAG AA on every new settings and registry screen.

## 23. Real Estate pack (Part 2) — PLANNED (not started; no agent created)

Owner when started: new agent **pack-realestate** (owns `apps/web/features/realestate`, `apps/api/src/modules/realestate`, `packs/realestate`). Follows the design system and both themes. Starts after Industry Packs core (section 22).

### 23.1 Data model
Custom objects from the pack manifest, all with `workspaceId`:
- **Project**: name, developer, location (geo-point and polygon), RERA number, status, possession date, amenities, brochure and media, price list.
- **Tower/Phase** and **Unit**: tower, floor, number, type/BHK, carpet and built-up area, facing, price, status (Available, Hold, Booked, Sold, Blocked); inventory history.
- **Lead requirement**: budget range in INR, locations, BHK, possession timeline, purpose (self use or investment), loan needed. Matched to units.
- **Channel partner / broker**: firm, contact, RERA ID, commission rules, leads sourced, payouts.
- **Site visit**: lead, project, agent, scheduled time, status, geofence check-in/out, feedback, outcome, next step.
- **Booking**: lead, unit, token amount, agreement value, payment schedule/milestones, demand letters, documents, status.
- **Commission and payout records**.

### 23.2 Pipeline and pages
- Default stages (editable): New Enquiry, Contacted, Site Visit Scheduled, Site Visit Done, Negotiation, Booked, Agreement, Closed Won, Lost.
- Pages (menu items injected by the pack):
  - Projects
  - Inventory: stack plan grid by tower and floor, units coloured by status, hold with expiry, realtime updates
  - Site Visits: calendar, list, live map
  - Channel Partners
  - Bookings and Payments
  - Real Estate Reports

### 23.3 Features
- **Unit matching**: suggest units from a lead's requirements; send a WhatsApp shortlist (project brochure plus selected units).
- **Unit hold/lock** for a lead, with an expiry and an auto-release job (BullMQ).
- **Site visit flow**:
  1. Schedule the visit.
  2. WhatsApp template reminder to the lead and the agent.
  3. The agent taps "Start visit"; live tracking starts.
  4. Geofence arrival check-in.
  5. Visit feedback form.
  6. "Check out".
  7. Auto-create a follow-up task and trigger a workflow.
- **Lead sources**: 99acres, MagicBricks, Housing.com, Meta/Google lead ads, website forms, walk-in, channel partners. They arrive through inbound webhooks and import mappings.
- **Workflow templates**:
  - Main cadence: enquiry -> welcome with brochure -> visit invite -> reminders 24 h and 2 h before -> post-visit feedback -> follow-up cadence -> booking reminder -> payment milestone reminders.
  - "No-show revival".
  - "Channel partner lead acknowledgment".
- **Dashboard widgets**: visits today, no-shows, unit availability by project, bookings this month, pipeline value, partner leaderboard, collections due.
- **Reports**: visit-to-booking funnel, source ROI by cost per booking, agent conversion, partner performance, inventory aging, collections.
- **Documents**:
  - Brochure and price sheet.
  - Cost sheet generator: base price + PLC + floor rise + GST + stamp duty + registration. Formula-driven and editable per project.
  - PDF export and share on WhatsApp.
- **Roles**: Sales Head, Sales Executive, Site Manager, Channel Partner (limited portal: add leads, see own leads, their status and payouts only), Accounts.

### 23.4 Quality and seed
- **Tests**:
  - Unit hold expiry job.
  - Cost sheet formula tests.
  - Permission tests: a channel partner sees only own data; other tenants never see anything.
- **Seed**: a real estate company with 3 projects (towers and units), 40 leads, 12 channel partners and 15 site visits.
- **Super Admin**: entitlement "pack-realestate".

## 24. Real Estate pack supplement — PLANNED (not started)

Applies on top of section 23 (owner pack-realestate). Build after Real Estate basics, in this order:
1. CP deep features and lead protection
2. Telecaller handover and walk-in
3. Approvals engine
4. Booking, collections and loan tracker
5. Pricing and inventory extensions
6. Broker mode
7. Marketing and referrals
8. Incentives
9. Customer portal

### 24.0 Modes
- Chosen at activation; both can be enabled:
  - **DEVELOPER** mode: new projects, inventory, bookings, collections.
  - **BROKER** mode: resale and rental listings, owners and buyers/tenants.
- Navigation and objects adapt to the mode.

### 24.1 Channel partner (CP) management
- **Onboarding**:
  - Registration form, KYC documents, RERA ID, agreement upload.
  - Optional e-sign provider adapter.
  - Admin approval workflow; status Pending, Active or Suspended.
- **Hierarchy**: CP firm, CP agents under a firm, and an internal CP relationship manager who owns each CP.
- **Lead registration** by a CP (portal, WhatsApp or API) with **lead protection**:
  - The lead is locked to that CP for a configurable validity period (default 90 days, per project), with renewal rules.
  - Duplicate check by normalised phone/email, showing "already registered by X on date".
  - Rule-based resolution: first-come wins, or a conflict queue for manager review with evidence (timestamps, source, activity).
  - Every decision is audit logged and visible to both parties as allowed.
- **Commission engine**:
  - Rules per project and unit type: flat or percentage, or slabs (tiers by bookings count or value in a period).
  - Bonus and incentive schemes.
  - Payout stages: on booking, on agreement, on collection milestones.
  - Clawback on cancellation.
  - TDS and GST fields, PDF payout statements, payment status tracking.
- **CP portal**: limited role, mobile-first, own login.
  - Register a lead; track own leads and visit status.
  - View allowed inventory and price sheets; download brochures.
  - Schedule a visit for their lead; see commission earned and payout status; raise queries.
  - No access to other partners' data, or to customer PII beyond their own leads.
- **CP analytics**: leads submitted, visit rate, booking rate, revenue, payout due, leaderboard (can be disabled), inactive-CP alerts and a revival workflow.

### 24.2 Lead management specifics
- **Source tagging**: direct, CP, portal (99acres, MagicBricks, Housing.com), Meta/Google ads, walk-in, referral, hoarding/QR, event.
- **Ownership and routing**:
  - By project, source, city or language; round-robin and least-busy.
  - Reassign inactive leads after N hours.
  - Lead aging and SLA alerts (first response time).
- **Pre-sales handover**:
  - The telecaller team qualifies leads with a qualification form (budget, location, timeline, purpose, loan).
  - Qualified leads go to a Sales Executive with the form attached and a visit-scheduling task.
  - Handover SLA; rejection with a reason loops back to the telecaller.
- **Walk-in registration**:
  - Reception/kiosk form or QR code at the site office, with an instant duplicate check.
  - Assignment to the available sales executive from a queue.
  - Printed or WhatsApp visitor token.
- **Requirement matching score**: rank available units against the lead's requirements; show the best 3 on the lead page.
- Dormant-lead revival workflows and "lost reason" analytics.

### 24.3 Site visit extensions
- Visit types: first visit, revisit, family visit, virtual visit. Multiple visits per lead.
- Visits with a CP: the CP is notified and credited.
- Pickup/cab coordination fields, simple driver assignment, and visit incentives for agents.
- Visit feedback form (liked/disliked, budget fit, decision timeline, objections) that feeds the lead score.
- Uses the Field Live map (section 25) unchanged.

### 24.4 Inventory and pricing extensions
- **Price lists**: effective dates and revision history, PLC, floor rise, parking, club membership, schemes and offers with validity, cost sheet versions.
- **Unit hold approval workflow**:
  - Rules for who can hold, max holds per person and hold duration.
  - Extension requests need manager approval.
  - Auto-release job with notifications.
- **Viewers and media**: stack plan and floor plan viewer, project gallery, 360/virtual tour links, brochure tracking through tracked share links (who opened which file).
- **Optional microsite / landing page generator**: its form feeds leads with source and campaign.

### 24.5 Booking, sales and collections (developer mode)
- **Booking**:
  - Booking form with applicant and co-applicant details.
  - KYC document checklist and status; token receipt.
- **Loan assistance tracker**: bank partners; applied, sanctioned and disbursed stages; documents; reminders.
- **Agreement and registration tracking**: draft, signed, stamp duty paid, registered, with dates and document uploads.
- **Payments and collections**:
  - Payment schedule per booking, construction-linked or time-linked.
  - Demand letter PDFs sent on WhatsApp; receipts.
  - Outstanding/overdue dashboard and delay-interest calculation.
  - Reminders through workflows and collection follow-up tasks.
- **Changes**: cancellation, transfer and refund flows with approvals and an audit trail.
- **Possession and post-sales**: handover checklist, snag list with photos and status, service requests, customer feedback.
- **Accounting export**:
  - CSV and Tally-compatible export of receipts and invoices.
  - GST/TDS fields; values are user-entered or formula-configured (no tax advice built in).

### 24.6 Approvals engine (reusable, core-level)
- Configurable multi-step approvals: discount over X percent, hold extension, cancellation, commission exceptions, price override.
- Approver roles, SLA, comments, notifications, realtime updates, audit log.
- An **"Approval" workflow node** lets automations request an approval and wait for it.

### 24.7 Broker mode (resale and rental)
- **Listings**: property type, locality with map pin, price or rent, area, BHK, furnishing, owner, photos and documents, availability, exclusive or open mandate, validity.
- **Owner and buyer/tenant leads**: automatic requirement-to-listing matching, WhatsApp shortlist sharing, tracked shared listing links.
- **Deals**:
  - Site visits to listings use the same flow and live map.
  - Negotiation notes, token and agreement tracking.
  - Brokerage invoice and commission split between agents.
- **Listing sync**: an adapter interface only; portal APIs come later.

### 24.8 Marketing and referrals
- Campaign and spend tracking per source; cost per lead, per visit and per booking in reports.
- WhatsApp broadcast campaigns to segments, using approved templates and respecting opt-in and quiet hours.
- Customer referral program: links or codes, reward rules, status tracking, payout.

### 24.9 Team, targets and incentives
- **Roles to add**: Telecaller, Reception, Sales Executive, Sales Head, CP Manager, Site Manager, Accounts, Loan Executive, CRM/Post-sales.
- **Targets and incentives**:
  - Targets per person and team (visits, bookings, value).
  - Incentive slabs with automatic calculation and statements.
  - Incentive visibility controlled by role.

### 24.10 Customer portal (optional flag)
- Signed-in or magic-link portal for booked customers.
- Shows unit details, payment schedule and receipts, documents, construction updates (photos and milestones posted by the company), and service requests.
- Strict per-customer isolation.

### 24.11 Reports and dashboards (additional)
- Funnel by source and by CP; cost per booking; visit-to-booking by project.
- Inventory aging and hold utilisation; approvals pending.
- Collections due and collected; loan pipeline; incentive and commission liabilities.
- Telecaller qualification rate, lead response SLA, no-show rate.

### 24.12 Pack plumbing
- Everything above is declared in the pack manifest: objects, fields, stages, workflow templates, WhatsApp template suggestions, widgets, reports, roles and menu items.
- The manifest is versioned, with idempotent install, upgrade, and removal that keeps user data.
- **Ready workflow templates**:
  - CP lead acknowledgment; lead protection expiry reminder.
  - Telecaller-to-sales handover; visit reminders (24 h and 2 h); post-visit feedback.
  - Hold expiry warning.
  - Payment milestone reminders; overdue collection escalation; loan stage follow-up.
  - Possession handover checklist.
- **New events**: `cp.lead_registered`, `lead.protection_expired`, `approval.requested`, `payment.overdue` (plus others as needed).

### 24.13 Quality and seed
- **Permission tests per role**:
  - A CP sees only own leads and payouts.
  - A telecaller cannot see financials.
  - Accounts cannot edit leads.
  - Other tenants never see anything.
- **Unit tests**: lead protection and duplicate resolution, commission slabs and clawback, delay interest, hold expiry and approvals, cost sheet formulas.
- **Playwright e2e**: CP registers a lead -> duplicate conflict -> manager resolves -> visit -> booking -> payment milestone -> commission payout.
- Both themes, mobile-first CP and employee views, flat fallbacks, WCAG AA.
- **Seed**:
  - A developer company with 3 projects and 400 units.
  - 12 CPs with varied status.
  - 40 leads, including duplicates and conflicts.
  - 15 bookings with payment schedules.
  - A broker company with 60 listings.

## 25. Live Site-Visit Map (Part 3) — PLANNED (not started; no agent created)

Owner when started: new agent **frontend-map** (owns `apps/web/features/map`, `apps/api/src/modules/tracking`). Starts after Real Estate basics and after the realtime backbone (Phase 4-5).

### 25.1 Experience
- **"Field Live" page**, plus a widget on the Live Team Floor and the dashboard:
  - 3D-extruded buildings; tilted camera (pitch ~55 degrees, bearing control); smooth fly-to.
  - Highlighted project polygons; stylised markers.
- **Agent markers**: each agent on an active visit is an avatar marker.
  - Moves smoothly along the road, interpolated between GPS points, with heading rotation and a subtle trail.
  - Shows a name tag, status (On the way, Arrived, In visit, Returning), speed/ETA, and the lead and project being visited.
  - Clicking opens a side panel with the lead, visit details and call/message actions.
- **Routes and pins**:
  - Route line from the agent to the project, with ETA.
  - Arrival animation (pulse ring) at geofence entry.
  - Project pins show the visits-today count; pins cluster when zoomed out.
- **Route replay** after a visit: timeline slider (departure, arrival, time at site, return), distance and duration.
- **Office link**: when a visit starts, the agent's Team Floor character walks out of the office and shows "Out on site visit" with a link to the map; on return it walks back in.
- **Modes and theme**:
  - 3D / Flat toggle; flat (2D) by default on mobile, low-end devices and with `prefers-reduced-motion`.
  - Light and dark map styles follow the app theme.
  - The map bundle is lazy-loaded only on map pages.
- **Customer share link** (optional, per-workspace setting):
  - A signed, expiring public page "Your agent is on the way", sent on WhatsApp when the visit starts.
  - Shows live ETA and the agent's name/photo, nothing else.
  - Expires when the visit ends.

### 25.2 Tech
- **Map renderer** behind an adapter interface:
  - Default: MapLibre GL JS with OpenStreetMap-based vector tiles (free). Mapbox or Google are optional providers via env keys.
  - 3D buildings as fill-extrusion layers.
  - Avatar markers via a deck.gl layer or a Three.js custom layer, reusing the Team Floor character models/colours when available; a lightweight HTML marker fallback.
- **Provider keys**: kept server-side where the provider allows, otherwise domain-restricted; never committed. Add `MAP_PROVIDER` and the keys to `.env.example`.
- **Location pipeline**:
  - The employee app sends location updates to `POST /api/tracking/points`: every 5-15 s while moving, adaptive, batched when offline. Each point has accuracy, speed, heading and visitId.
  - The server validates the points and stores them in a time-series table (default retention 30 days, configurable).
  - It smooths noise and detects arrival via geofence.
  - It emits `visit.started`, `location.updated`, `visit.arrived`, `visit.completed` over Socket.IO to authorised viewers only. These events join the shared event contract.
- **Employee app**:
  - PWA first: foreground tracking with Screen Wake Lock and a clear "tracking on" banner, plus a graceful message that background tracking needs the native app.
  - A documented API and background-tracking contract, so a Flutter/React Native app can follow (battery-aware, Android foreground service, iOS significant-change updates).
- **Anti-fraud and quality**:
  - Reject impossible jumps; flag mock locations where detectable.
  - Accuracy threshold for check-in; optional selfie or QR check-in at the site.
  - Manager manual override, with the reason logged.

### 25.3 Privacy and compliance (non-negotiable)
- **When tracking happens**: only during an active, scheduled or started site visit, or an explicit "duty" session if the company enables it. Never outside active sessions.
- **Consent and visibility**:
  - An explicit employee consent screen before first use, stored in ConsentRecord.
  - A persistent visible indicator while tracking.
  - Employees can see their own history.
  - Company policy text is editable in Settings.
- **Access control**:
  - Only managers/admins and the employee can see live and historical location; viewers and channel partners cannot.
  - Every access to historical routes is audit logged.
  - Retention and deletion controls; delete-my-data covers tracking points.
- **Customer share link**: exposes only the agent's first name, optional photo and live ETA. Signed token, expiry, revocable.

### 25.4 Quality, seed, flags
- Both themes; WCAG AA; a keyboard-accessible list of active visits that mirrors the map; the flat fallback is always usable.
- Performance: adaptive cap on simultaneously animated markers, throttled updates, FPS-based quality reduction, pause when the tab is hidden.
- **Tests**:
  - Geofence arrival with simulated GPS traces.
  - Permissions: an employee sees only own tracking, a channel partner sees none, other tenants never see anything.
  - Playwright: schedule visit -> start -> arrive -> feedback -> complete; 3D/flat toggle.
- **Seed**: a GPS simulator script that replays realistic paths in a city (public/fictional coordinates).
- **Super Admin**: entitlement/flag "field-live-map" and usage metering for tracking points.

## 26. Order of work (current, from changes #9 and #13)
1. **Now:**
   - Fold every spec into this file and `docs/STATUS.md` (done).
   - Execute only (a) Industry Packs Part 1 (section 22), then (b) board physics (section 11.1, frontend-physics).
   - Then run the full check (typecheck, lint, tests, builds, `pnpm smoke:api`, `pnpm smoke:web`) and report.
2. **Planned, do not build or scaffold**: Real Estate pack (23), Real Estate supplement (24), Live Site-Visit Map (25). Do not create the pack-realestate or frontend-map agents until the user says so.
3. **Wave 2** starts only after the user says "go". It now includes the workflow platform (section 27, change #14) in the order of 27.11.
4. **Awaiting confirmation** (listed in change #9 but not in the scope lock): the User-Workspace membership refactor (D-036) and deleting the seven `verify-traders-*` test companies from the dev database.
5. **Later phase order** (from change #10):
   - Real Estate basics (projects, inventory, site visits, bookings).
   - Tracking pipeline and Field Live map (after the realtime backbone, Phase 4-5).
   - Real estate workflows, reports and partner portal.
   - Route replay, customer share link and Team Floor integration.
   - The supplement in its own order (section 24).

## 27. Workflow platform: generic automation (change #14) — PLANNED for Wave 2 (not started; waits for "go")

Owners: **workflow-engine** (engine, triggers, logic, data nodes, HTTP Request node, run control, limits), **realtime-integrations** (connections vault, inbound webhook endpoints, channel adapters, connector definitions, SSRF-safe HTTP client), **frontend-physics** (builder UI, data picker, run timeline UI, templates gallery). frontend-app builds the Connections settings screens. Applies on top of section 13 (builder physics, existing node catalogue) and the earlier integrations spec (section 15.5). Read the skills first; summaries end with "Skills used: ...".

Goal: Workflows is a general n8n-style automation builder. A company connects ANY platform (IndiaMART is one example), listens for events or polls on a schedule, and decides what happens next on any channel. A new platform needs no platform-specific code.

### 27.1 Connections (credential vault, per company)
- Types: API key/header, Bearer token, Basic auth, OAuth2 (authorization code + refresh), custom headers/query params, webhook signing secret, SMTP, Telegram bot token, WhatsApp provider.
- Stored encrypted; masked after save; never logged or returned by the API; nodes reference a connection by name.
- "Test connection" button; usage list ("used by these workflows").

### 27.2 Triggers
- **Inbound webhook**: unique URL per workflow, optional HMAC / shared-secret check, captures a sample payload for mapping, answers 200 at once and processes from a queue, stores the raw payload with replay.
- **Schedule**: cron with a friendly editor (every N minutes, daily at a time, weekdays only, specific dates); timezone-aware (default the workspace timezone, Asia/Kolkata); optional "skip if the previous run is still active"; "run now" for testing.
- **HTTP poll**: any endpoint, method, headers, query/body with variables (`{{last_run}}`, `{{cursor}}`), interval, path to the item list, unique-key field for dedupe, pagination (page, cursor, offset), rate-limit and backoff handling.
- **CRM events**: lead created/updated/assigned, stage changed, message received, call ended/missed, task overdue, form submitted, payment overdue (when available).
- **Manual** trigger and **called by another workflow** (sub-workflows).
- **Platform presets** built from the same primitives: IndiaMART push and pull, WhatsApp inbound, Telegram inbound, email inbound / IMAP (later).

### 27.3 Actions
- **Channels**: WhatsApp (template, text inside the 24 h window, media); Email (SMTP/provider, templates, attachments); Telegram (message/photo to a chat or channel via a bot); SMS and voice behind provider adapters (mock first); in-app notification; push notification.
- **CRM**: create/update contact or lead, add note, add tag, change stage, assign owner (round-robin, least-busy, rule-based), create task / call task, update custom fields, create deal, upload file.
- **HTTP Request** (the universal connector): any URL and method, headers, query, JSON/form/raw body, auth from a connection, response parsing, retries with backoff, timeout, "continue on error".
- **Data**: set/transform fields, merge, filter, sort, aggregate, split items, JSON parse/stringify, date/time helpers, text templates, simple formulas and expressions.
- **Code** node (optional, behind a flag): sandboxed JavaScript with CPU, memory and time limits; no network or filesystem.
- **Team notifications**: message a manager when something happens (e.g. a high-value lead), with a link.

### 27.4 Logic and flow control
- **Wait**: fixed duration; until a date/time; until a weekday / business hour; **wait for event** (e.g. a WhatsApp reply for up to 2 hours, else the "no reply" branch).
- **Condition** and **Switch** (multi-branch) with a visual rule builder (field, operator, value, AND/OR) and an expression mode.
- Loop over items; parallel branches and merge (wait for all or first); delay between items; stop/exit; error branch; retry policy per node; rate limiting per channel.
- **Approval** node (human in the loop): ask a role or person, wait, continue on approve / reject.
- Sub-workflows, reusable templates, variables and workflow-level settings.

### 27.5 Data flow and mapping
- Every node outputs JSON. A data picker lets users click fields of earlier nodes (`{{trigger.body.name}}`, `{{node3.response.id}}`) instead of typing paths. Live preview of resolved values from the last test payload. Defaults and fallbacks. Type warnings.
- Test one node, test the whole workflow with a captured payload, and "pin data" to freeze sample input.

### 27.6 Run control and observability
- Per-run timeline: each node's input, output, status, duration, error. Search runs by lead, workflow, status, date. Replay a failed run from a chosen node. Cancel running executions.
- Versions (draft vs active), rollback, duplicate, import/export workflow JSON, folders and tags.
- Failure alerts (email / in-app / Telegram), failure-rate dashboard, dead-letter list, usage per workflow for billing and plan limits (runs, nodes, schedules).

### 27.7 Safety, compliance and limits (non-negotiable)
- SSRF protection for the HTTP node and the poll trigger: block private/internal IP ranges and metadata endpoints, resolve and re-check after redirects, size and time limits, optional allowlist per company.
- Outbound rate limits, concurrency caps per workflow and per company, loop and run-time limits, idempotency keys, duplicate-event protection.
- WhatsApp rules stay enforced inside the WhatsApp node: approved templates for first contact, 24 h window, opt-out check, quiet hours. Email and SMS nodes respect unsubscribe / opt-out and sender rules.
- Secrets never appear in logs, run history or exports; exports store connection names only.
- Permissions per role to create, edit, activate and view run data; audit log for every change and activation.

### 27.8 Builder UI
- Keep the depth-card canvas and physics (section 13.1). Node palette grouped (Triggers, Channels, CRM, Data, Logic, Flow), search, drag from the palette, quick-add "+" on edges, mini map, undo/redo, copy/paste, multi-select, keyboard shortcuts, auto-layout, side panel for node settings with validation.
- Plain-language summary on each node ("When a lead arrives from IndiaMART", "Wait until reply, max 2h") and a "Test" button per node.
- Templates gallery: lead nurturing across WhatsApp + email, missed-call follow-up, scheduled daily summary to Telegram, abandoned quote reminder, "any platform webhook to CRM lead", "poll an API every 10 minutes".
- Mobile: read-only workflows, runs and failures, plus enable/disable and run-now. Editing stays on larger screens.

### 27.9 Connector definitions (extensibility)
- A JSON connector format: name, auth type, base URL, trigger and action definitions with input fields and sample responses. New platforms are data, not code.
- Ship definitions for IndiaMART (push and pull), a generic webhook, Telegram, SMTP email and the WhatsApp partner adapter.
- Super Admin publishes connectors to the library; companies can create private custom connectors.

### 27.10 Quality
- Unit tests: expression resolution, cron / timezone / DST, wait-for-event timeout branch, dedupe, retry/backoff, SSRF blocking, secret redaction.
- Integration tests with a mock HTTP server: webhook trigger to the WhatsApp mock, poll trigger with pagination, schedule trigger, error branch.
- Playwright e2e: build webhook -> condition -> WhatsApp mock -> wait for reply -> Telegram mock, run it, inspect the run timeline, replay a failed node.
- Both themes, keyboard-accessible builder, WCAG AA.
- Seed: 6 ready workflows and sanitized sample payloads in fixtures.

### 27.11 Order inside Wave 2 (workflow-engine leads)
1. Connections vault and HTTP Request node.
2. Webhook, schedule and poll triggers.
3. Wait-for-event, switch and error handling.
4. Data picker and run timeline.
5. Channel nodes (WhatsApp, email, Telegram).
6. Connector definitions and templates.

## 28. Neon Space board, Space Shell, Team Floor multi-map - ACTIVE IN PARALLEL (change #17 and the parallel execution override #18)

Received as one steering message with three specs. The follow-up "parallel execution override" (change #18) replaces that message's rules 3-5: the specs run in parallel, each in its own worktree, branch, `.env`, database and ports, with no "go" gates between them. Merge order: 28.1, then 28.3, then the 28.2 foundation, then 28.2 page restyling. Screenshot loops are capped at 3 iterations on the first pass; leftover polish goes to `docs/POLISH.md`. Shared-file owners: frontend-app owns tokens and the shell; backend-core owns `packages/shared` contracts and the Prisma schema. Other agents file change requests in `docs/REQUESTS.md`.

Reference images (kept outside product paths, never shipped):
- Image A = `references/IMG_3066.PNG` (neon Leads Board), for 28.1 only.
- Image B = `references/IMG_3064.PNG` (multi-floor office), for 28.3 only. (Corrected 2026-11-02, REQUESTS #9: the file names were swapped in the first version of this note.)

Prerequisites (checked 2026-11-02):
- 28.1 needs the Leads Depth Style and Motion upgrade (board physics, 11.1) finished and merged. **Missing.** `agent/frontend-physics` has 2 unmerged commits (b91d259, d6d648b) plus uncommitted work (7 files in `features/pipeline`, `touch.ts`, `e2e/board/`). It was never verified. frontend-physics finishes and verifies 11.1 first; 28.1 starts after the merge.
- 28.3 needs the Team Floor v3 pass (12.1) finished. **Missing.** Medium Day has gone through 4 screenshot iterations on `agent/frontend-3d`, but its done checks have not run. The Evening bake, the Small and Large templates and the 12.1 flat view are not started. frontend-3d finishes 12.1 first and builds Small and Large from reusable modules so 28.3's module kit extends them; 28.3 starts after the merge.
- 28.2 foundation has no prerequisite and starts now.

Resolved conflict (orchestrator default, D-053): section 4 and section 11.1 say "no neon, no glassmorphism". 28.1 and 28.2 add opt-in neon and glass styles. The defaults stay Depth (board) and Classic (app); Neon Space is an opt-in skin with its own contrast rules.

The three specs below are saved verbatim.

### 28.1 Spec 1: Leads Board third skin "Neon Space" and event celebrations

LEADS BOARD: THIRD SKIN "NEON SPACE" + EVENT CELEBRATIONS (add to the Depth Style and Motion specs; do not restart; owner: frontend-physics; read frontend-design, vistar-theming and animation skills first; end your summary with "Skills used: ...")

REFERENCE

The attached image is the target: tall glass stage columns with strong colored neon edges over a dimmed office backdrop, event animations (new leads streaming in, quote envelope flying, fireworks on Won, shredding on Lost). Ignore its garbled text and its wrong "Leads | Board" toggle; the real toggle stays Board | Table. All real text is crisp DOM text.

SKIN MODEL

Board skins become: Flat, Depth, Neon Space. Selection is remembered per user and workspace default is allowed. Neon Space is dark-first; in the Light theme it renders as a bright "Aurora" variant (pastel glass, colored edges, soft colored shadows, no glow). Default stays Depth. Neon Space is automatically unavailable on mobile and low-end devices (falls back to Flat).

NEON SPACE LOOK

- Backdrop: dimmed, blurred office scene (a pre-rendered image or low-cost 3D plate, lazy-loaded, never a video), dark vignette, faint perspective floor lines with a glowing grid.
- Columns: tall glass panels with 2px saturated neon edges (New blue, Contacted cyan, Interested amber, Quote sent indigo, Won green, Lost red), inner glow limited to the edge, header with stage name, count and total in INR. Strictly cap glow brightness and blur radius so text stays AA-readable; text contrast is checked against the actual rendered background.
- Cards: darker glass slabs with a bright top edge, bold name, company, INR value, activity line, chips. Hot leads pulse softly.

EVENT CELEBRATIONS (all event-driven from real data events, throttled, intensity setting Full / Subtle / Off)

- New lead arrives: it streams in as a glowing card along a light ribbon into New (source color), lands softly.
- Stage move: the card rides a short ribbon between columns; a ring pulse at arrival.
- Quote sent: a small envelope flies from the card and dissolves into the column.
- Won: a short, tasteful burst (confetti or sparks plus a rupee glyph) above the column, with a count-up of the total; limit to once per 2 seconds, auto-skip if more than 3 queued.
- Lost: the card softly dissolves into a few shards and fades; no gore, no harsh red flash.
- Overdue: gentle red edge pulse.

Safety: no flashing faster than 3 times per second, no full-screen flashes, prefers-reduced-motion or intensity Off replaces all of it with simple fades.

PERFORMANCE

Particles on a single capped canvas layer (max about 300 particles), pooled and reused; effects pause when the tab is hidden; adaptive tiers drop particles and glow first, then fall back to Depth then Flat when FPS stays under 45. Never apply backdrop-filter per card.

VERIFY

Playwright screenshots in Neon/Dark and Aurora/Light at 1440x900 and 1920x1080, DPR 1 and 2, plus frames from each event animation and a contrast audit of text on the rendered background. Look at the images, compare with the reference, iterate (max 6). Save to docs/screenshots/leads-neon/ and give me the paths.

REPORT

8 lines: what changed, screenshot paths, FPS, contrast results, gaps.

### 28.2 Spec 2: Space Shell, 3D space feel across the app

SPACE SHELL: 3D SPACE FEEL ACROSS THE APP (new spec; do not restart; owners: frontend-app for the shell, frontend-physics and frontend-3d for scenes; read frontend-design, vistar-theming and Three.js skills first; end your summary with "Skills used: ...")

PRINCIPLE

The app feels like moving through rooms of one space, but daily work stays fast and readable. Only showcase pages get real 3D scenes; utility pages stay flat 2D inside glass panels over the shared space background. A global "Interface style" setting (Classic, Depth, Neon Space) and a "Motion intensity" setting (Full, Reduced, Off) apply everywhere; mobile, low-end devices and reduced motion fall back to Classic automatically.

SHELL

- A shared, lightweight background layer (themed gradient plus faint perspective grid and sparse particles in dark; soft pastel wash in light) behind every page, with depth-styled sidebar and top bar (glass, subtle parallax).
- Page transitions: a short camera-glide or slide-and-depth transition between pages (under 300ms), never blocking input.

PAGE MAP

- Dashboard: "Control room": KPI cards and charts rendered as glass panels, with a big wall-screen section (leaderboard, funnel, source donut) that gently tilts with the pointer; live values animate in real time.
- Leads: the Board skins from earlier specs.
- Live Team Floor: the 3D office (separate spec).
- Workflows: the depth-card canvas with rope edges and flowing packets (as specified).
- Reports: a "war room" layout: charts on large glass screens, drill-down opens a focused panel; exports and tables stay 2D.
- Inbox, Calls, Tasks: 2D glass panels with depth styling only (layered shadows, subtle hover lift, animated list items); no 3D scenes.
- Integrations, Webhooks and logs, Billing, Settings, Team and roles tables, Super Admin tables: Classic 2D inside glass panels; no 3D.
- Employee panel: Classic or Depth only; Neon is off on mobile.

RULES

- All real text is DOM text with AA contrast in both themes and every style.
- One shared motion and depth token set (shadows, blur caps, durations, springs) in vistar-theming; no per-page one-off values.
- Lazy-load Three.js and effect layers per page; no 3D library in the main bundle.
- Performance budget: first page load not slower than before; 60fps on a mid laptop; adaptive tier downgrade when FPS is under 45.
- Accessibility: keyboard navigation unchanged, focus rings visible, reduced motion respected, no flashing over 3Hz.

VERIFY

Playwright screenshots of every page in Classic, Depth and Neon, Light and Dark, desktop and 375px; Lighthouse performance numbers before and after; fix and iterate (max 5). Save to docs/screenshots/space-shell/ and give me the paths.

REPORT

8 lines: what changed, pages covered, performance numbers, gaps.

### 28.3 Spec 3: Team Floor multi-map and auto-upgrade by headcount

TEAM FLOOR: MULTI-MAP AND AUTO-UPGRADE BY HEADCOUNT (extends the Team Floor v3 spec; do not restart; owner: frontend-3d; backend support from backend-core; read frontend-design, vistar-theming and Three.js skills first; end your summary with "Skills used: ...")

REFERENCE

The attached multi-floor office image is the target for large offices (several floors, glass war rooms, big wall screens showing live KPIs, lounge, cafe, reception, several glowing hubs). It is an AI concept: match its richness and structure as far as real-time rendering allows.

MODEL

Organization -> Locations (branches, for example Nagpur office, Mumbai office) -> Buildings -> Floors -> Zones (sales pods, calling hall, war rooms, manager cabins, lounge, cafe, reception). Each employee has a location and a team; each team maps to a zone.

MULTIPLE MAPS

- Map switcher: location tabs, a floor selector (one floor at full detail, others ghosted in a cutaway like the reference), and a minimap.
- "All locations" overview: a simple city-level view with one pin or mini-building per location showing live counts (on call, available, busy); click to fly into that office.
- Per-team filter and focus (highlight a team's zone), search for a person (camera flies to them).

MODULAR OFFICE AS DATA

- Office layouts are generated from a JSON module kit, not hand-placed meshes: sales pod (4 or 6 desks), calling booth block, war room, manager cabin, lounge, cafe, reception, hub plaza, wall-screen wall, stair/elevator core, floor plates.
- Capacity tiers: Starter (up to 8 seats), Team (up to 20), Studio (up to 50), HQ (up to 150, multi-floor), Campus (up to 500, multiple buildings or wings). The Medium reference look maps to Team.
- Hubs: besides the Lead Hub, optional source hubs (IndiaMART, WhatsApp, Website, Referral) with glowing links to the desks of whoever receives those leads; parcels fly from the right hub to the assigned desk.
- Wall screens inside the scene show live KPIs (leaderboard, funnel, conversion) from real data.

AUTO-UPGRADE

- Capacity is computed per location from active employees assigned there. When headcount reaches 90% of the current tier's capacity, or a new hire would exceed it, the system upgrades to the next tier.
- Setting per workspace (Floor settings): Auto (default), Ask an admin first (notification with Approve), or Locked. Admin can force a tier. Never auto-downgrade; only suggest when headcount stays under 50% of capacity for 30 days.
- Stable seats: every person keeps the same seat id across upgrades; new people get seats in their team's zone first, then overflow zones. Upgrading adds modules (a new wing, pods, or a floor) and never reshuffles existing people.
- Upgrade animation: new modules rise or assemble with a short scaffold-and-glow effect (2 to 3 seconds), camera eases to the new area, a toast says "Office upgraded to Studio". Respect reduced motion (instant swap with a fade).
- Store the layout and seat assignments in the database; layout changes are audit logged.

SCALE AND PERFORMANCE

- 200 or more people: instanced props, LOD for characters (full animation near the camera, simplified poses mid-range, billboards or dots far away), animate only visible floors, merge static geometry, throttle label updates, lazy-load floors.
- 300 or more people: automatic "Cluster view": pods collapse to status-colored tiles with counts; zooming into a pod expands it to people.
- Labels use the existing collision-avoiding layer; at scale show dots and initials until zoomed in.
- Adaptive quality tiers with an FPS monitor; Flat 2D plan remains the fallback for mobile and low-end devices and also supports the same locations, floors and tiers.

SEED AND TEST

- Seed generator that can create 8, 20, 50, 150 and 300 employees across two locations with realistic team structure, plus a simulator for calls, status changes and lead parcels.
- Tests: tier selection and thresholds, stable seat ids across an upgrade, no downgrade without approval, permissions (managers see their team and location only), label overlap count under 3 in the default view at every tier.
- Playwright screenshots for each tier (Light and Dark, DPR 1 and 2), the upgrade animation frames, the All-locations overview, and a Flat view per tier; side-by-side with the reference images; iterate (max 8). Save to docs/screenshots/team-floor-multimap/ and give me the paths.

REPORT

8 lines: what was built, tiers verified with FPS, screenshot paths, asset list with licenses, gaps versus the reference.

## 29. Android employee app, live status, premium UI, branding, custom floors, local completion - ACTIVE (change #19)

Received 2026-11-02 as a question message, the user's answers and two follow-ups. Saved verbatim, then broken down. Production setup (server, domain, accounts) comes later: complete everything locally first.

Question message (verbatim):

> muzhe ye btao ab production ready bnane ke liye kya kya bcha hai isme aur calling ka kaise hoga sim calling chahiye muzhe to iska liye ek app bnana pdega kya?  aur kya harek client ke liye alag alag 3d map team floor bnana possible hai unke space ke hisab se, agar ha to solution btao kaise, aur current code ko as a template use kar skte hai kya? ki kuch dalna baaki hai isme jo similar hota hai har ek crm sales platform me? agar kuch bcha hai to wo abhi implement karo multisubagents use karke aur is machine me flutter installed hai agar app banana ho to wo bhi bnana aur ui component ko improve premium look do bhot simple lg rhe hai current ui component ko rehne do lekin ab jo improve karoge current ui components use admin select kar pae ki abhi ke jaise dikhne chahiye ya improved version dikhne chahiye aur color dashboard color company ko apne hisab se set karte ana chahiye setting mese logo wgera sab kuch aur ha flutter app ui ka bhi premium look bnana hoga aur flutter app me wo sab dikhna chahiye jo employee panel me dikhta hai to ui thoda modern next level bnana aur multiagents spawn karo jldi krne ke liye aur kon employee kya kar rha hai sabka status 100% accuracy ke sath sahi hona cahiye live team floor me, agar kuch puchna hai to pucho muzhe kuch muzhese chahiye to pucho jo chahiye wo dunga aur then start karna

Answers (verbatim):

> pehle android app bna lo poora uske baad test karna mai tb dunga android testing ke liye.employee ke phone koi bhi ho skte hai iphones chorke.iphone app nhi chahiye filhal. app link employee panel me bhi milega aur playstore pe bhi reh skta hai. push notification ke liye firebase json file super admin panel se upload hogi to wo option super admin penel ke ek config section me de dena. premium ui ka mtlb tha ki enterprise level type app ui dikhna chahiye easy to navigate and premium high quality app look hona chhiye. branding domain ka option bhi cahhiye lekin admin control karega ki kis company ko dena hai aur kis company ko nhi super admin panel se deside hoga wo. floor layout ke liye company panel me reference images provide karna compulsory hoga company panel me live team floor sidebar tab me tabhi super admin provide kar paega jab super admin panel me super admin ko receive hoga ref images of company cabin rooms wgera.field staff ke liye gps ya attendance tracking chahiye aur ha tracking sirf working hours me ho.production ka badme dunga pehle local me complete karo.aur dummy data clean kardo aur ui poora screen me fit hona chahiye left ya right me jgah khali nhi dikhni cahiye karo ab wo bhi multiagents ke sath taki jaldi ho sake

Follow-ups (verbatim):

> filhal flutter app web me test check  kar skte ho dekhne ke liye ki kaise bna hai

> admin file upload kega super admin panel me liveteam floor ki jo ai se banaega

### 29.1 Android employee app (Flutter, `apps/mobile`)
- Everything the employee panel shows (section 17): Today, Leads (list, search, filters, stage change), lead detail with timeline and notes, Tasks (complete, snooze), Calls (log and SIM calling), WhatsApp inbox, Team Floor (flat plan; the 3D floor stays web), status control, My performance, notifications, profile, preferences.
- Premium enterprise UI: modern, easy to navigate, high quality, light and dark, company branding (logo, brand colour) from the API. The app is always the premium design.
- SIM calling on any Android brand (no iPhone app for now): tap Call, the phone dialer calls from the employee's own SIM; the app reports call start (phone state) live and, after hang-up, reads the call log (exact duration, connected or missed) and saves it to the lead. Recordings: the app picks up the phone's own recorder files (OEM folders) and uploads them; it never records audio itself (Android 10+ blocks this). Call-log permissions are allowed on Play for business CRM apps with a corporate login.
- Attendance and GPS (field staff): check-in and check-out with location; location updates only while checked in and only inside the company's working hours (the server rejects anything outside); a consent screen before the first use.
- Push notifications through Firebase, configured in the Super Admin config section (29.6). The app initialises Firebase at runtime with options it gets from the API, so one APK works for any Firebase project.
- Distribution: a download link in the employee panel (latest APK uploaded in the Super Admin config section) and the Play Store later.
- Web preview: the app also builds for the web (`flutter build web`) so its screens can be checked in a browser; native-only features show an "Android only" note there.
- Device testing comes later, on a phone the user provides. Until then: unit, widget and golden tests plus the web preview.

### 29.2 Live status accuracy (Team Floor)
- Status is decided on the server from observed facts only: login and logout, web or app open (heartbeat), call in progress (Android phone state), call result (call log), the employee's own status (break, lunch, meeting, field visit), attendance check-in, working hours.
- No heartbeat for 45 s means Offline with "last seen". Limits that are stated in the UI, not hidden: the system cannot know whether someone is physically at a desk, and for outgoing SIM calls Android does not report when the other side answers ("On call" from dialing; the talk time comes from the call log after the call).
- The Team Floor (web and app) reads the server snapshot and live events instead of the simulator.

### 29.3 Premium UI (web)
- The current components stay as "Standard". A new "Premium" version (enterprise look, easy navigation, high quality) is added for every component. The company admin chooses Standard or Premium for the whole company in Settings; employees cannot override it. Default: Standard.

### 29.4 Branding and custom domain
- Company settings: logo (light and dark), brand colour, dashboard and chart colours, login page image, favicon, display name. Colours are adjusted automatically so text keeps AA contrast.
- Custom domain (for example `crm.company.com`): only for companies the Super Admin enables in the Super Admin panel. DNS instructions (CNAME plus a TXT check), verification and host-to-company resolution. Local testing uses `*.localhost` names.

### 29.5 Custom Team Floor per company
- In the Company panel's Live Team Floor tab, the company admin must upload reference images of their office (work area, cabins, meeting rooms, reception, pantry or lounge; floor plan optional) before a custom floor can be made. The request reaches the Super Admin panel.
- The Super Admin builds the 3D office with an AI tool outside Vistar, uploads the file (GLB or glTF) for that company in the Super Admin panel, places seats and zones on it in a seat tool, previews and publishes it.
- Until a custom floor is published the company sees the default template with a "your office is being prepared" note.

### 29.6 Super Admin config section
- Firebase: upload `google-services.json` (app config, delivered to the app at runtime) and the Firebase service account JSON (server sending). Stored encrypted; secrets never shown again.
- Android app releases: upload an APK with version and notes; the employee panel download link always points to the latest release.
- Per-company switches: custom domain (29.4).

### 29.7 Full-screen layout
- Every page fills the screen width: no empty bands on the left or right on wide screens. Wide screens get more columns, not wider margins. Forms use two columns on wide screens.

### 29.8 Dummy data cleanup
- The app no longer shows dummy data: the web reads the real API and starts empty for a new company. The demo data stays available only as an opt-in seed for tests (`pnpm db:seed:demo`) and the browser mock layer only for automated tests (`NEXT_PUBLIC_DATA_SOURCE=mock`). The local main database is backed up, then reset to a clean state (plans and the Super Admin; companies are created from the Super Admin panel or by sign-up).

### 29.9 Common CRM features to add (from the question message)
- Contacts and Accounts pages, Deals, Quotations and invoices with GST and PDF, Products and price list, Calendar and meetings, lead routing (round-robin, auto-assign), lead capture forms.

### 29.10 Execution
- Parallel agents in their own worktrees, at most 5 at a time (7.8 GB RAM; heavy steps serialised by a lock). Wave A: contracts and platform API, realtime and presence API, Android app, premium UI and branding web, web API wiring and cleanup. Wave B: custom floor request and Super Admin floor upload, live Team Floor from the server and attendance UI, CRM features (29.9), Android app wired to the full API, QA.
