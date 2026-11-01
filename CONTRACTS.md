# Vistar contracts

Every agent builds against these contracts. **Agents read them; only the orchestrator edits them.**
To request a change, end your summary with a block:

```
CONTRACT-REQUEST: <file or symbol>
Why: <one line>
Proposed change: <exact shape>
```

The orchestrator applies it on `main`, notes it in the change log below, and tells the other agents to rebase.

## 1. Where the contracts live

| Contract | Source of truth | Consumers |
| --- | --- | --- |
| Enums (statuses, sources, role kinds, scopes) | `packages/shared/src/enums.ts` | all; Prisma enums must match literally |
| Permission matrix, role defaults, flags, plan limits | `packages/shared/src/rbac.ts` | API guards, UI visibility |
| Panels, navigation map, login redirect | `packages/shared/src/navigation.ts` | web shells, route guards, e2e |
| REST API (method, path, auth, permission, zod schemas) | `packages/shared/src/api/routes.ts` (`API_ROUTES`) | NestJS controllers via `@ApiRoute`, web client, OpenAPI |
| Entity and request schemas | `packages/shared/src/schemas/*.ts` | API validation (`ZodPipe`), web forms, tests |
| Realtime events | `packages/shared/src/events.ts` | Socket.IO gateway, event bus, web cache updaters, outbound webhooks |
| Error codes and envelope | `packages/shared/src/errors.ts` | API filter, web error handling |
| Theme resolution, boot script, cookie | `packages/shared/src/theme.ts` | web theme system, emails, 3D |
| Design tokens (both palettes) | `packages/shared/src/design/tokens.ts` -> generated `apps/web/styles/tokens.css` | all UI, charts, 3D, emails |
| Tailwind theme mapping | `apps/web/styles/theme.css` | all UI |
| Base UI kit | `apps/web/components/ui/*` (preview at `/kit`) | all UI |
| Leads page shared state and data layer | `apps/web/lib/leads/*`, `apps/web/components/leads-shared/*` | Board view, Table view |
| Webhook signing | `packages/shared/src/webhooks.ts` | webhooks module, docs |
| Workflow graph, node catalogue, templates | `packages/shared/src/workflow/*` | builder, engine, seed |
| Data model | `apps/api/prisma/schema.prisma` | all API modules |
| API infrastructure | `apps/api/src/{common,infra,config}` | all API modules |
| Mock data and simulator | `packages/shared/src/fixtures/*` (`@vistar/shared/fixtures`) | Wave 1 UIs, seed, simulator |
| OpenAPI (generated) | `packages/shared/openapi/openapi.{json,yaml}` via `pnpm openapi` | docs, external API users |

## 2. Roles, permissions, data scope

- **SUPER_ADMIN** is a platform role (`PlatformAdmin` table), not tied to a workspace. Permissions: `PLATFORM_PERMISSIONS` (`platform.*`).
- Workspace roles have a **kind**: `company_admin | manager | employee | viewer` (`ROLE_KINDS`). Kind decides the panel and the default scope. System roles exist per kind; company admins create custom roles (`RoleCreateSchema`) from the matrix.
- **Permission matrix** `PERMISSION_MATRIX` (resource x action). Permission string = `resource.action`, e.g. `leads.update`. Defaults: `DEFAULT_ROLE_PERMISSIONS`. Admin lock-out guard: `LOCKED_ADMIN_PERMISSIONS`.
- **Data scope** per role (`DataScope`): `own` (employee default), `team` (manager default: members of teams they manage + own), `all` (admin, viewer). The API applies it to every list and detail query on `Lead.ownerId`, `Task.assigneeId`, `Call.userId`, `Conversation.assigneeId`, and to dashboard, reports and Team Floor.
- The API is the source of truth. The UI hides what the API would reject (`visibleNav`, `hasPermission`).
- **Feature flags** `FEATURE_FLAGS` come from the plan (`PlanDefinition.features`) plus Super Admin overrides (`FeatureFlagOverride`). Effective flags are on `Workspace.features`.

## 3. Panels and navigation

One Next.js app, three route groups, one design system:

| URL | Route group | Who | Nav |
| --- | --- | --- | --- |
| `/super-admin/*` | `app/(super-admin)/super-admin` | platform token only | `NAV_SUPER_ADMIN` (sidebar, dense, table-first) |
| `/app/*` | `app/(company)/app` | company_admin, manager, viewer | `NAV_COMPANY` (grouped sidebar: Work, Automate, Team, Insights, Admin) |
| `/me/*` | `app/(employee)/me` | employee (+ manager for own work) | `NAV_EMPLOYEE_BOTTOM` + `NAV_EMPLOYEE_MORE` (mobile-first bottom nav) |

- After login redirect with `homePathFor(principal)`. Each layout guards with `canEnterPanel(principal, panel)`.
- Auth pages live in `app/(auth)` (`/login`, `/signup`, `/invite/[token]`, `/super-admin/login`).
- The Leads page is the same component in `/app/leads` and `/me/leads`; data scope makes them differ.

## 4. Auth

- **Workspace audience** (`JWT_AUDIENCE.workspace`): access JWT 15 min in memory, `Authorization: Bearer`; refresh cookie `vistar_rt` (httpOnly, path `/api/v1/auth`, rotated, reuse revokes the family). Claims: `WorkspaceClaimsSchema` (`sub, wid, rid, kind, scope, perms, sid, imp?`).
- **Platform audience** (`JWT_AUDIENCE.platform`): separate secret `SUPER_JWT_SECRET`, prefix `/api/super`, mandatory TOTP 2FA (enrol on first login), access 10 min, refresh cookie `vistar_srt` (path `/api/super/auth`), idle timeout 30 min, absolute 12 h, optional IP allowlist. Claims: `PlatformClaimsSchema`.
- A workspace token is rejected by every `/api/super` route and a platform token by every `/api/v1` route (different audience and secret). Required test.
- **Impersonation** (Super Admin "View as company"): `ImpersonationStartSchema` (reason required, default 30 min, read-only by default). Issues a workspace token with the `imp` claim. Read-only blocks every non-GET. Message bodies and recordings stay hidden unless the company enabled support access with content (`Workspace.supportAccess`). Persistent banner from `MeResponse.impersonation`. Logged in `PlatformAuditLog` and the company `AuditLog`.
- API code reads the caller from `req.auth` (`AuthContext`, workspace) or `req.platformAuth` (`PlatformAuthContext`). Use `@CurrentAuth()` / `@CurrentPlatformAdmin()`.

## 5. REST API

- Base path `/api/v1`. Absolute routes: `/api/health`, `/api/hooks/*` (inbound webhooks), `/api/super/*`.
- Implement each route with `@ApiRoute(API_ROUTES.<id>)` on a `@Controller()` with no prefix. It sets method, path, status, auth mode and permission from the contract, so they cannot drift.
- Validate input with `new ZodPipe(<Schema>)` on `@Body/@Query/@Param`. Responses must match the route's `response` schema.
- Lists: cursor pages `{ items, nextCursor, total? }` (`pageOf`). Small lists: `{ items }`.
- Errors: always `{ error: { code, message, details?, requestId } }` (`ApiErrorSchema`). Throw `AppException(code, message)`. Codes in `ErrorCode`; never change a code's meaning.
- Money: whole rupees (`valueInr: number`). Ids: UUID. Dates: ISO strings.
- `RouteDef.owner` and `phase` say who builds a route and when. OpenAPI regenerates with `pnpm openapi`.

## 6. Tenancy

- Every table except `Workspace` and the platform tables carries `workspaceId`.
- Feature code uses `prisma.forTenant(auth.workspaceId)` which injects `workspaceId` into every `where` and `create`, strips `workspaceId` from update data, and pins `Workspace` queries to the caller (create/delete rejected). Use unchecked inputs (scalar `*Id`, no `connect`). Check every foreign-key id from user input with `assertInTenant(db, { stage, user, ... })`. Nested creates and raw SQL are not auto-scoped. Platform tables throw if used through the tenant client.
- Never take `workspaceId` from the request body or URL except the inbound webhook path, which is verified by HMAC.

## 7. Realtime

- Socket.IO namespace `/realtime`, handshake `auth: { token }` (workspace token). Rooms: `rooms.workspace|user|lead|workflow|workflowRun|conversation`.
- Every message is a `DomainEvent` envelope `{ id, type, workspaceId, occurredAt, actor, userId?, payload }`; Socket.IO event name = `type`; payload schema = `eventPayloadSchemas[type]`.
- Server publishes with `EventBus.publish()` **after commit**. With Redis, events go over channel `vistar:events` (API instances, workers and the simulator share it).
- Clients patch TanStack Query caches from events (no polling). On reconnect the server sends `sync.required { scopes }`; the client invalidates those query-key roots (`SYNC_SCOPES` match the first query-key segment).
- Presence: heartbeat every `HEARTBEAT_INTERVAL_MS`, offline after `PRESENCE_TIMEOUT_MS`, combined with call events.
- Data scope also applies to realtime: managers and employees only receive lead/task/call payloads they may see.

## 8. Leads page (Board default, Table optional)

- Views: `LEADS_VIEW_MODES = ['board', 'table']`, default `board`.
- Resolution `resolveLeadsViewMode()`: URL `?view=board|table` (that visit only) > this session's toggle > user setting > localStorage `vistar.leads.viewMode` > workspace default > `board`. The session choice makes the toggle instant and keeps it if the PATCH fails.
- **User setting key `leads.viewMode`** (`UserSettings.leadsViewMode`, PATCH `/me/settings`).
- **Workspace default key `leads.defaultViewMode`** (`Workspace.defaultLeadsViewMode`, PATCH `/workspace`, admins only).
- Shared state (`useLeadsViewState`): filters (`LeadFiltersSchema`), saved view, selection, Board select mode, filter panel, scroll positions. Switching views never resets it.
- Shared data (`lib/leads/data.ts`): `useLeadsList`, `useLeadsBoard`, `useMoveLead` (optimistic, per-lead rollback), `applyMoveToBoard(board, { lead, fromStageId, toStageId, beforeId?, afterId?, position? })` (also used by realtime `stage.changed`), `patchListItem`, `leadKeys`. One TanStack Query cache. Wave 1 uses the mock source; Wave 3 swaps to HTTP without changing hook signatures.
- `LeadMove` with no neighbours = end of the target column.
- Pickers (owner dropdown, reassign) use `GET /users/options` (`leads.read`), not `/users` (`team.read`).
- Shared actions (`components/leads-shared/lead-actions.tsx`): `LeadActionsProvider`, `useLeadActions()` (`open`, `call`, `whatsapp`, `note`), `LeadQuickActions`. Both views open the same Lead detail drawer (`?lead=<id>`).
- Board API accepts the same filters (`pipelineBoard` query = `LeadFiltersSchema` + `perColumn`; `boardColumnPage` for more cards).

## 9. Theme and design

- `<html data-theme="light|dark" data-theme-mode="system|light|dark|scheduled">`. Apply before paint with `getThemeBootScript()` (reads cookie `vistar_theme`). Resolve with `resolveTheme()`; scheduled mode uses the workspace timezone.
- Colours only from tokens (Tailwind default palette is disabled). Utilities: `bg-bg`, `bg-surface`, `bg-surface-2/3`, `border-border`, `text-fg`, `text-fg-secondary`, `text-muted`, `text-muted-strong`, `bg-accent`, `text-accent-fg`, `text-accent-text`, `bg-accent-soft`, status chips `bg-status-<tone>-bg text-status-<tone>-fg border-status-<tone>-border`, charts `chart-1..6`.
- Small muted text directly on `bg` must use `text-muted-strong` (AA). Radius `rounded-md` 8px, cards `rounded-lg` 12px. Elevation `shadow-card | raised | overlay | lift`.
- Motion 150-250 ms (`duration-150..250`, `ease-standard`); respect `useReducedMotion()`.
- JS consumers (Three.js, canvas, email): `palettes[theme]`, `useDocumentTheme()`.

## 10. Other contracts

- **Webhooks**: `X-Vistar-Signature: t=<unix>,v1=<hex>` over `${t}.${rawBody}`, HMAC-SHA256, 300 s tolerance, `Idempotency-Key`, retry schedule `WEBHOOK_RETRY_DELAYS_SEC`, then dead-letter. Helpers in `infra/crypto/secrets.ts`.
- **Workflow graph**: `WorkflowGraphSchema { schemaVersion, version, nodes, edges }`, node configs `nodeConfigSchemas`, handles from `NODE_CATALOG[type].outputs(config)`, validation `validateGraph()`, variables `WORKFLOW_VARIABLES` + `renderTemplate()`, shipped `WORKFLOW_TEMPLATES`.
- **Settings keys**: `SETTING_KEYS` (user: `theme`, `teamFloor.mode`, `notifications`, `a11y.reducedMotion`, `leads.viewMode`; workspace: `leads.defaultViewMode`, `performance.showRank`, `leads.routing`).
- **Env**: `.env.example`. Server secrets never reach the browser; only `NEXT_PUBLIC_*` does.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-01 | STEP 0 contracts created. |
| 2026-11-01 | Leads view modes: `LeadsViewMode`, `leads.viewMode`, `leads.defaultViewMode`, shared `LeadFiltersSchema`, board accepts filters, `SavedView.viewMode`, shared leads state/data/actions in web. |
| 2026-11-01 | Roles and panels: role kinds (`company_admin, manager, employee, viewer`), platform `super_admin`, permission matrix, data scope, custom roles, feature flags, plan limits, navigation map, separate platform auth audience with 2FA, impersonation, support access, `/api/super` routes. |
| 2026-11-01 | qa-reviewer fixes: Update schemas no longer re-apply defaults (Zod 4 `.partial()`), `UserSettingsUpdateSchema` explicit, `WebhookEndpointUpdateSchema`, `leads.merge` permission, `GET /me/today` (`MyTodaySchema`), `GET /users/options`, `TARGET_METRICS`, `input-border` token (`border-input`), `Button` touch sizes, tenant client hardening + `assertInTenant`, TOTP replay protection (`PlatformAdmin.totpLastStep`), `Target.subjectKey`, `TRUST_PROXY` env, self-loop fix in `validateGraph`. |
