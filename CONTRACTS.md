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
| Web session (identity, permissions, settings) | `apps/web/lib/session/*`, `apps/web/lib/providers.tsx` | every panel, guards, features |
| Feature public APIs (stable exports + props) | `apps/web/features/{pipeline,workflow-builder,team-floor}/index.tsx` | page shells mount them; owners replace the implementation only |
| API data scope + dev auth + mappers | `apps/api/src/common/auth/{scope.service,dev-auth.guard}.ts`, `common/mappers/*` | all API modules |
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
- Data scope: inject `ScopeService` (global) and spread `await scope.where(auth, 'ownerId' | 'assigneeId' | 'userId')` into every owned-record query; `scope.canSee(auth, ownerId)` for detail routes (return NOT_FOUND, never FORBIDDEN, for out-of-scope records).
- Map users with `toUserSummary()` + `USER_SUMMARY_SELECT` (`common/mappers/user.mapper.ts`); dates with `iso()`.
- Audit with the global `AuditService` (`common/audit/audit.service.ts`): `record(auth, req, { action, entityType, entityId, diff })`, `system(...)`, `platform(admin, req, { ..., workspaceId, reason })` (also writes the company log). Diffs are PII-masked.
- **Wave 1 only:** with `DEV_AUTH=1` (development) a `DevAuthGuard` authenticates `x-dev-user: <seeded email>` and enforces route permissions. It is removed in Wave 3 when the real guards are merged.

### Web session (`lib/session`)
- `useSession()`, `useMe()` (`MeResponse` | null), `usePrincipal()`, `usePermissions()`, `useCan(p)`, `useSessionStatus()`, `useSessionActions()` (`signInMock`, `signOut`, `updateSettings`, `updateWorkspace`, `updateProfile`, `setStatus`, `updateSupportAccess`). `<AppProviders>` (root layout) mounts the query client and session.
- Wave 1 is mock: personas `company_admin | manager | employee | viewer | super_admin` (Shakti fixtures, ids match `mockUsers()`), stored in localStorage. Dev helpers: `?mockAs=<persona>`, `&impersonating=1`, `NEXT_PUBLIC_MOCK_PERSONA`. Wave 3 swaps internals for the real API; hook signatures stay.
- `updateSettings(patch)` deep-merges `theme` and `notifications` and persists per persona (mock) / PATCH `/me/settings` (real).

### Feature public APIs
- `LeadsBoardView({ pipelineId, density? })` from `@/features/pipeline`.
- `WorkflowBuilder({ workflowId, initialGraph?, readOnly?, onSave? })` from `@/features/workflow-builder`.
- `TeamFloor({ mode?, readOnly?, userIds? })` from `@/features/team-floor` (lazy three bundle inside).
- Dev previews (orchestrator): `/dev/board`, `/dev/builder`, `/dev/floor` (signed in as a mock manager), UI kit `/kit`.

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
- Presence: heartbeat every `HEARTBEAT_INTERVAL_MS` (15 s), offline after `PRESENCE_TIMEOUT_MS` (45 s), combined with call events (section 12).
- Data scope also applies to realtime: managers and employees only receive lead/task/call payloads they may see.

## 8. Leads page (Board default, Table optional)

- Views: `LEADS_VIEW_MODES = ['board', 'table']`, default `board`.
- Resolution `resolveLeadsViewMode()`: URL `?view=board|table` (that visit only) > this session's toggle > user setting > localStorage `vistar.leads.viewMode` > workspace default > `board`. The session choice makes the toggle instant and keeps it if the PATCH fails.
- **User setting key `leads.viewMode`** (`UserSettings.leadsViewMode`, PATCH `/me/settings`).
- **Workspace default key `leads.defaultViewMode`** (`Workspace.defaultLeadsViewMode`, PATCH `/workspace`, admins only).
- Shared state (`useLeadsViewState`): filters (`LeadFiltersSchema`), saved view, selection, Board select mode, filter panel, scroll positions. Switching views never resets it.
- Shared data (`lib/leads/data.ts`): `useLeadsList`, `useLeadsBoard`, `useLoadMoreColumn`, `useLead`, `useCreateLead`, `useUpdateLead`, `useBulkLeads`, `useMoveLead` (optimistic, per-lead rollback), `applyMoveToBoard(board, { lead, fromStageId, toStageId, beforeId?, afterId?, position? })` (also used by realtime `stage.changed`), `patchListItem`, `leadKeys`. One TanStack Query cache. Wave 1 uses the mock source (which applies the mock persona's data scope); Wave 3 swaps to HTTP without changing hook signatures.
- `LeadMove` with no neighbours = end of the target column. New leads (create, quick add, import, webhook) go to the TOP of their column (D-037).
- Pickers (owner dropdown, reassign) use `GET /users/options` (`leads.read`), not `/users` (`team.read`).
- Shared actions (`components/leads-shared/lead-actions.tsx`): `LeadActionsProvider`, `useLeadActions()` (`open`, `call`, `whatsapp`, `note`), `LeadQuickActions`. Both views open the same Lead detail drawer (`?lead=<id>`).
- Board API accepts the same filters (`pipelineBoard` query = `LeadFiltersSchema` + `perColumn`; `boardColumnPage` for more cards).

## 9. Theme and design

- `<html data-theme="light|dark" data-theme-mode="system|light|dark|scheduled">`. Apply before paint with `getThemeBootScript()` (reads cookie `vistar_theme`). Resolve with `resolveTheme()`; scheduled mode uses the workspace timezone.
- Colours only from tokens (Tailwind default palette is disabled). Utilities: `bg-bg`, `bg-surface`, `bg-surface-2/3`, `border-border`, `text-fg`, `text-fg-secondary`, `text-muted`, `text-muted-strong`, `bg-accent`, `text-accent-fg`, `text-accent-text`, `bg-accent-soft`, status chips `bg-status-<tone>-bg text-status-<tone>-fg border-status-<tone>-border`, charts `chart-1..6`.
- Small muted text directly on `bg` must use `text-muted-strong` (AA). Radius `rounded-md` 8px, cards `rounded-lg` 12px. Elevation `shadow-card | raised | overlay | lift`.
- Motion 150-250 ms (`duration-150..250`, `ease-standard`); respect `useReducedMotion()`.
- JS consumers (Three.js, canvas, email): `palettes[theme]`, `useDocumentTheme()`.
- **Scrollbars**: `apps/web/styles/scrollbar.css` themes every scrollbar from the tokens (Classic slate, Depth accent tint, Neon Space cyan-to-indigo gradient, Aurora pastel). Do not add per-component `::-webkit-scrollbar` rules or `scrollbar-color`; tint a scroll container by setting `--sb-track`, `--sb-thumb`, `--sb-thumb-near`, `--sb-thumb-hover`, `--sb-thumb-active` (and `--sb-neon-*` for Neon Space) on it, as the Leads Board columns do. Touch screens and forced colours keep the system scrollbars.
- **Appearance (D-052)**: `UserSettings.interfaceStyle` (`classic|depth|neon|null`, null follows `Workspace.defaultInterfaceStyle`, default `classic`), `motionIntensity` (`full|reduced|off`, default `full`), `boardSkin` (`flat|depth|neon|null`, null follows `Workspace.defaultBoardSkin`, default `depth`), `celebrations` (`full|subtle|off|null`, null follows motion). Effective values only through `resolveInterfaceStyle()`, `resolveBoardSkin()`, `resolveMotion()` and `resolveCelebrations()` in `packages/shared/src/appearance.ts`, given `DeviceCaps`; neon falls back to `flat` (board) and `classic` (app) on mobile, low-end devices and reduced motion. Workspace defaults are admin-only and audited.

## 10. Other contracts

- **Webhooks**: `X-Vistar-Signature: t=<unix>,v1=<hex>` over `${t}.${rawBody}`, HMAC-SHA256, 300 s tolerance, `Idempotency-Key`, retry schedule `WEBHOOK_RETRY_DELAYS_SEC`, then dead-letter. Helpers in `infra/crypto/secrets.ts`.
- **Workflow graph**: `WorkflowGraphSchema { schemaVersion, version, nodes, edges }`, node configs `nodeConfigSchemas`, handles from `NODE_CATALOG[type].outputs(config)`, validation `validateGraph()`, variables `WORKFLOW_VARIABLES` + `renderTemplate()`, shipped `WORKFLOW_TEMPLATES`.
- **Settings keys**: `SETTING_KEYS` (user: `theme`, `teamFloor.mode`, `notifications`, `a11y.reducedMotion`, `leads.viewMode`, `ui.interfaceStyle`, `ui.motionIntensity`, `leads.boardSkin`, `leads.celebrations`; workspace: `leads.defaultViewMode`, `performance.showRank`, `leads.routing`, `ui.labels`, `ui.defaultInterfaceStyle`, `leads.defaultBoardSkin`, `ui.componentStyle`, `branding.displayName`, `branding.logoLight`, `branding.logoDark`, `branding.brandColor`, `branding.chartPalette`, `branding.loginImage`, `branding.favicon`).
- **Env**: `.env.example`. Server secrets never reach the browser; only `NEXT_PUBLIC_*` does.

## 12. Change #19: app, live status, branding, domains, custom floors (SPEC 29, D-056..D-066)

Routes with `phase: 19` in `API_ROUTES`; `owner: 'backend-core'` = PLATFORM stream, `owner: 'realtime-integrations'` = REALTIME stream. Migration `20261102200000_change19_platform` (the only one of the wave).

- **Storage** (`schemas/storage.ts`, D-065): `UPLOAD_LIMITS` per `FilePurpose` (logo 2 MB, favicon 512 KB, login image 5 MB, reference image 15 MB, floor model 40 MB GLB / zipped glTF, APK 150 MB, call recording 50 MB). Driver `STORAGE_DRIVER=local` (root `STORAGE_LOCAL_ROOT`, default `<repo>/.data/uploads`) or `s3`. Tenant `File` (purpose, visibility, driver, sha256, uploadedByAdminId) and platform `PlatformFile`. Upload `POST /files` (multipart `file` + `purpose`; route `bodyFields`), metadata `GET /files/{id}`, signed URL `GET /files/{id}/url` / `GET /api/super/files/{id}/url` served at `GET /api/files/d/{token}`; public branding files at `GET /api/files/p/{id}`. Downloads send `nosniff` and a sandbox CSP.
- **Appearance** (`schemas/branding.ts`, `branding.ts`, D-059/D-060): `Workspace.componentStyle` (`standard|premium`, PATCH `/workspace`), `Workspace.branding` (`WorkspaceBrandingSchema`; PATCH `/workspace/branding` with file ids, audited, event `workspace.branding_changed`). Contrast guard: `resolveBrandColors()` / `resolveChartPalette()` adjust colours below 3:1 on `#FFFFFF` and `#171A21` (mix towards black or white), never reject; UIs use `branding.colors.light|dark` and `chartColors`. `logoUrl` / `accentColor` are legacy mirrors.
- **Custom domains**: flag `custom_domain` (off on every plan; Super Admin switch via `PUT /api/super/companies/{id}/flags`), `CustomDomain` (hostname, pending|verified|failed, TXT token). Company routes `GET|PUT|DELETE /workspace/domain`, `POST /workspace/domain/verify` (TXT `_vistar-verify.<host>` = `vistar-verify=<token>`; `*.localhost` verifies without DNS outside production). Public `GET /public/resolve-host?host=` and `GET /public/workspaces/{slug}/branding` (`PublicWorkspaceSchema`).
- **Platform config** (`schemas/app-platform.ts`, D-058): `parseGoogleServicesJson()` (package `ANDROID_PACKAGE_NAME` = `app.vistar.employee`), `parseServiceAccountJson()`; `PlatformSetting` (encrypted with ENCRYPTION_KEY; the service account is never returned). `AndroidRelease` (versionName, versionCode unique, notes, sha256, minSupported). Super routes under `/api/super/config/firebase*` and `/api/super/android-releases`. Public `GET /app/config` (`AppConfigSchema`) and `GET /app/android/latest`.
- **Devices and push**: `Device` (installationId, fcmToken unique, appVersion, model, osVersion, lastSeenAt); `GET|POST /me/devices`, `DELETE /me/devices/{id}`. Push = FCM HTTP v1 with the uploaded service account (skips and logs when not configured); data payload `PushDataSchema`.
- **Presence** (`schemas/presence.ts`, D-062): `PresenceStatus` (available, on_call, in_meeting, on_break, lunch, field_visit, away, offline), `PresenceSource`, `presenceToEmployeeStatus()` (User.status stays coarse). `Presence` (current) + `PresenceEvent` (history). `PUT /me/status` (`StatusUpdateSchema`: manual statuses, legacy `idle`; never `on_call`) now returns `MyPresenceSchema` and belongs to REALTIME; `GET /me/presence`, `POST /me/presence/heartbeat`, `GET /users/{id}/presence-history`. `HEARTBEAT_INTERVAL_MS` 15 s, `PRESENCE_TIMEOUT_MS` 45 s. Team Floor snapshot: `TeamFloorEmployee.presence` (`TeamFloorPresenceSchema`: seatId, isFieldStaff, checkedIn), `floor` (`TeamFloorRefSchema`), `presenceCounts`.
- **SIM calls** (D-057): `Call.source` (sim|voip|mock), `result` (connected, missed, no_answer, busy, rejected, failed; `outcome` stays the disposition), `phone` (E.164 counterpart), `deviceCallId` (unique per user), `recordingFileId`. `POST /me/calls/device-log` (`DeviceCallLogBatchSchema`, idempotent), `POST /me/calls/active` (`ActiveCallEventSchema` started/ended), `POST /calls/{id}/recording` (multipart).
- **Attendance** (`schemas/attendance.ts`, D-063): flag `field_tracking` (on for growth and enterprise), `User.isFieldStaff` (PATCH `/users/{id}`), `AttendanceSession`, `LocationPing` (unique per user and time), `TrackingConsent` (`TRACKING_CONSENT_VERSION`). Me routes under `/me/attendance/*`, `/me/location`, `/me/tracking-consent`; company `GET /attendance`, `/field/live`, `/field/users/{id}/route`. Shared rule `isWithinWorkingHours()`.
- **Custom floors** (`schemas/floor.ts`, D-061): `FloorRequest` + `FloorRequestImage` (categories `FloorImageCategory`; `floorRequestImageProblems()`: >= 3 images, a work_area, a cabin or meeting_room; 422 `FLOOR_REQUEST_INCOMPLETE`), `FloorAsset` (version per company, draft|published|superseded, GLB or gltf_zip, `SeatMapSchema`). Company `POST|GET /floor-requests`, `GET /floor-requests/{id}`, `GET /team-floor/layout`; super `/api/super/floor-requests*`, `/api/super/companies/{id}/floors`, `/api/super/floors/{id}` (+ `/seat-map`, `/publish`). Events `floor_request.updated`, `floor.published`.
- **Super Admin companies**: `superCompanyList|Get|Create|Flags` are backend-core now; `CompanySchema` gains `features`, `customDomain`, `floor`, `userCount`; create returns `CompanyCreatedSchema.adminInvite` (link always in development).
- **Events** added: `attendance.checked_in`, `attendance.checked_out`, `location.updated`, `workspace.branding_changed`, `floor_request.updated`, `floor.published`; `employee.status_changed` gains `presence`, `previousPresence`, `source`, `lastSeenAt`, `activity`. Server -> client `auth.expired`. Handshake `SocketAuthSchema` (`token`, `client`, `appVersion`). Sync scopes `presence`, `attendance`, `workspace`.
- **Errors** added: `FEATURE_DISABLED` 403, `FILE_TYPE_NOT_ALLOWED` 415, `FILE_INVALID` 422, `DOMAIN_INVALID` 422, `DOMAIN_TAKEN` 409, `DOMAIN_VERIFICATION_FAILED` 422, `FIREBASE_CONFIG_INVALID` 422, `PUSH_NOT_CONFIGURED` 422, `APP_RELEASE_INVALID` 422, `NOT_FIELD_STAFF` 403, `TRACKING_CONSENT_REQUIRED` 422, `OUTSIDE_WORKING_HOURS` 422, `ATTENDANCE_STATE_INVALID` 409, `FLOOR_REQUEST_INCOMPLETE` 422, `FLOOR_NOT_READY` 409.
- **Seeds** (D-064): `pnpm db:seed` = clean seed (plans, Super Admin, pack registry); `pnpm db:seed:demo` = the demo companies (worktrees, smoke, e2e).

## 13. Change #19 wave B: CRM features (SPEC 29.9, D-067, D-068)

Routes with `phase: 19` after the "change #19 wave B" marker in `API_ROUTES` (owner backend-core = CRM-API stream). Migration `20261103000000_change19b_crm` (also adds the new permissions to the system roles of existing workspaces). Sources: `schemas/{catalog,crm,crm-related,documents,calendar,routing,capture}.ts`, `gst.ts`.

- **Contacts and accounts** (`schemas/crm.ts`): Contact = person (`Contact`), Account = company (Prisma `Company`). GSTIN (`isValidGstin`, check digit), PAN, `AddressSchema` with the GST `stateCode` (`INDIAN_STATES`), labelled extra phones and emails, owner, tags, custom fields (targets `contact`, `company`). Routes `/contacts*`, `/accounts*`: list, create, get, update, delete (soft), duplicates, merge (`CrmMergeSchema`), bulk, related (`CrmRelatedSchema`), timeline (`CrmTimelineItemSchema`) and notes (`CrmNote`). Scope: owner, or a visible linked lead.
- **Deals** (`Deal`): own deal pipeline (`Pipeline.entity = 'deal'`, default key `deals`, `DEFAULT_DEAL_STAGES`, created on first use; `GET /pipelines?entity=deal`), stage, fractional `position` (COLLATE "C"), probability override, owner, account, contact, optional lead, product lines (`DealLine`). `GET /deals/board`, `POST /deals/{id}/move`, table `GET /deals` (`sort=position` pages one column). `POST /leads/{id}/convert` links or creates contact, account and deal.
- **Products and price lists** (`schemas/catalog.ts`): SKU (unique), HSN (goods) or SAC (services), UQC unit, GST rate 0/5/12/18/28, price in paise excl. GST, active. Price lists override product prices.
- **Quotations and invoices** (`schemas/documents.ts`, `gst.ts`): money in paise (D-067). `computeDocument()`: CGST+SGST when the seller state code equals the place of supply, else IGST; round-off to the rupee; `amountInWordsInr()`; HSN summary. Numbering `<prefix>/<FY>/<seq>` per workspace, kind and financial year (`DocumentSeries`); quotations numbered on create, invoices on issue. Status flows `QUOTATION_TRANSITIONS`, `INVOICE_TRANSITIONS`; payments recorded manually (`clientPaymentId` idempotency, void keeps the row). Seller profile `GET|PUT /billing/profile` (Setting `billing.sellerProfile`). Server-side A4 PDF (`/quotations/{id}/pdf`, `/invoices/{id}/pdf`, branding logo and colour), share links (`/public/documents/{token}`, web page `/d/<token>`).
- **Calendar** (`schemas/calendar.ts`): `Meeting` (attendees: users, contacts, guests; lead/contact/account/deal links; place or video link; reminders; simple recurrence expanded by `expandOccurrences()`), `TimeOff`, `GET /calendar/availability`. Reminder cron sends notification `meeting_reminder` and event `meeting.reminder` to each attending user.
- **Lead routing** (`schemas/routing.ts`): `RoutingRule` (conditions source, city, state, product keywords, value range, tags, capture forms; pool = team + users; round_robin or least_busy; working-hours, availability and online checks; fallback owner). Applied to leads created without an owner (admin or API key create, import, capture forms, webhooks). `POST /routing-rules/test` is a dry run.
- **Lead capture forms** (`schemas/capture.ts`): builder fields mapped to lead fields or `custom.<key>`, hosted page `/f/<key>`, iframe snippet, `GET /public/forms/{key}`, `POST /public/forms/{key}/submit` (rate limit `CAPTURE_RATE_LIMITS`, honeypot `CAPTURE_HONEYPOT_FIELD`, consent, UTM, `clientSubmissionId`).
- **Permissions** (system role defaults in `DEFAULT_ROLE_PERMISSIONS`): `contacts.*`, `accounts.*` (read, create, update, delete, merge), `deals.*` (read, create, update, delete), `products.read|manage`, `quotations.*` (read, create, update, send, delete), `invoices.*` (read, create, update, issue, cancel, payments, delete), `calendar.*` (read, create, update, delete), `routing.manage`, `capture_forms.manage`.
- **Navigation**: company group `sales` (Deals, Contacts, Accounts, Quotations, Invoices, Products), Calendar in `work`, Attendance in `team` (flag `field_tracking`), settings GST and billing, Lead routing (`/app/settings/lead-routing`), Lead capture forms, Office markers; Super Admin Floors.
- **Events**: `contact.*`, `account.*` (created, updated, deleted, merged), `deal.created|updated|moved|deleted`, `quotation.created|updated|deleted`, `invoice.created|updated|deleted|payment_recorded`, `catalog.changed`, `meeting.created|updated|deleted|reminder`. Sync scopes `contacts`, `accounts`, `deals`, `products`, `quotations`, `invoices`, `calendar`, `routing`, `capture-forms`. Notification type `meeting_reminder`.
- **Errors**: `DOCUMENT_STATE_INVALID` 409, `SELLER_PROFILE_INCOMPLETE` 422, `PAYMENT_EXCEEDS_BALANCE` 422, `RECORD_MERGE_INVALID` 400, `PRODUCT_SKU_TAKEN` 409, `SHARE_LINK_EXPIRED` 410, `CAPTURE_FORM_CLOSED` 410.
- **Presence** (D-063 gate): zone signals outside the user's working hours are ignored and the zone is cleared; heartbeats still update online status.

<!-- ---- change #19 wave C: hub -->
## 14. Change #19 wave C: integration hub, webhooks, API keys (SPEC 15.5, D-069, D-070)

Routes in the phase 5 hub block of `API_ROUTES` (extended) and the "change #19 wave C: hub" block after `apiKeyRevoke` (owner backend-core = HUB-API stream). Migration `20261103100000_change19c_hub`. Sources: `schemas/integration.ts`, `integrations.ts` (catalog), `mapping.ts` (payload mapping engine), `webhooks.ts`. Handoff notes: `%TEMP%\vistar-handoff\contracts-19c-hub.md`.

- **Integration hub**: `GET /integrations` returns all five providers (never connected: `id null`, `not_connected`); `GET /integrations/catalog` adds connect fields (secret fields marked), setup steps, capabilities, `availability` (`not_configured` when e.g. GOOGLE_CLIENT_ID/SECRET are missing) and `enabled` (plan feature whatsapp / telephony). Connect (`mode` live | mock; mock refused in production), test (SMTP `to`), sync now (IndiaMART pull), disconnect (wipes secrets and tokens), rotate-token, Google OAuth start + `/api/oauth/google/callback`. Statuses `not_connected`, `connected`, `error`, `needs_attention` (`attention` text). Secrets write-only (`secretHints` only); `endpoints` (push URL, WhatsApp callback URL + verify token, telephony callback URL, Google redirect URI) only for `integrations.manage` and never in events.
- **Receivers** (one `HooksController`, literal paths first): `/api/hooks/{workspaceId}/{sourceKey}` (custom sources), `/api/hooks/{workspaceId}/indiamart?key=`, `GET|POST /api/hooks/{workspaceId}/whatsapp` (workspace Meta app), `GET|POST /api/hooks/whatsapp` (platform app, env secrets, routed by phone_number_id), `/api/hooks/{workspaceId}/telephony/{provider}?token=`. Reserved source keys `RESERVED_SOURCE_KEYS`.
- **Inbound sources**: verification `hmac` (`X-Vistar-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.rawBody")>`, 300 s) or `token` (`X-Vistar-Token` / `?token=`); previous secret valid during a rotation grace; `Idempotency-Key` 24 h (same body 200 duplicate, other body 409 `IDEMPOTENCY_CONFLICT`); mapping `PayloadMappingSchema` evaluated by `applyPayloadMapping()` (paths, `||` fallbacks, `+` joins, constants, transforms `MAPPING_TRANSFORMS`); actions `create_lead` (routing), `update_lead` (match `matchBy`, `createIfMissing`), `start_workflow` (lead + queued `WorkflowRun`); sample capture (`/capture`); every request after the source lookup in the delivery log (`signatureValid`, `result`).
- **Outbound**: events `OUTBOUND_WEBHOOK_EVENTS` (SPEC 15.5 + CRM), body = domain event envelope, signed like inbound (two `v1` during a rotation grace), retries `WEBHOOK_RETRY_DELAYS_SEC` then `dead`, `attempts[]` timeline, replay (new delivery, `replayOfId`), test send (`webhook.test`, one attempt), auto-disable after `WEBHOOK_AUTO_DISABLE_AFTER_DEAD` dead deliveries in a row (company admins get a `system` notification with `data.kind = webhook_disabled`). All outbound HTTP through `apps/api/src/infra/http/safe-http.ts` (SSRF guard).
- **API keys**: scopes âŠ† creator permissions (`API_KEY_SCOPE_NOT_ALLOWED`), `api_access` plan feature, rotate with `graceMinutes`, per-key `rateLimitPerMinute` (default `API_KEY_DEFAULT_RATE_LIMIT_PER_MIN`, 429 + Retry-After), `lastUsedAt` / `lastUsedIp`, `GET /api-keys/scopes`, PATCH, revoke. Public reference `GET /api/v1/openapi.json` (`buildPublicOpenApiDocument`).
- **Permissions**: `integrations.read`, `webhooks.read` (read routes; company admin and manager defaults; migration backfills roles holding `.manage`); `integrations.manage`, `webhooks.manage`, `apikeys.manage` for changes.
- **Navigation**: Integrations and Webhooks visible with `.read` or `.manage`; Settings children `settings-api-keys` (feature `api_access`) and `settings-api-docs`.
- **Events**: `integration.updated`, `webhook.endpoint_updated` (`reason`), `webhook.delivery_updated` (now `webhooks.read`). Sync scopes `integrations`, `webhooks`, `api-keys`.
- **Errors**: `INTEGRATION_NOT_CONFIGURED` 422, `WEBHOOK_URL_BLOCKED` 422, `WEBHOOK_REPLAY_NOT_ALLOWED` 422, `IDEMPOTENCY_CONFLICT` 409, `API_KEY_SCOPE_NOT_ALLOWED` 403, `OAUTH_STATE_INVALID` 400.
- **Env** (API): `OUTBOUND_ALLOW_PRIVATE_HOSTS` (dev allowlist, default localhost,127.0.0.1,::1, ignored in production), `INDIAMART_API_URL`, `WHATSAPP_GRAPH_URL`, `HUB_BACKGROUND_JOBS` (on | off: webhook worker, sweeper, IndiaMART cron; tests run with off).
<!-- ---- end change #19 wave C: hub -->
## 15. Change #19 wave C: billing and PDF fonts (SPEC 15.7, 16, D-071, D-072)

Routes in `api/routes-billing.ts` (`BILLING_ROUTES`, spread into `API_ROUTES`; owner backend-core = BILLING-PDF stream). Migration `20261103110000_change19c_billing`. Sources: `schemas/billing.ts`, `billing.ts` (pure helpers), marked blocks in `enums.ts`, `errors.ts`, `events.ts`, `rbac.ts`, `navigation.ts`. Full list: handoff `contracts-19c-billing.md`.

- **Subscription** (one per workspace; `Subscription` mirrors `Workspace.plan`, trial status and `trialEndsAt`): status trialing, active, past_due, cancelled; monthly or yearly; extra seats; current period; scheduled downgrade; billing contact (name, GSTIN, address with state code = place of supply).
- **Usage and limits**: meters for seats, leads, storage_mb, api_keys (totals) and whatsapp_messages, api_calls, workflow_runs (this IST month), counted from the tables (API calls by an interceptor into `UsageCounter`); 80 % warning, 100 % reached. Creates over the limit answer 402 `PLAN_LIMIT_REACHED` with `error.planLimit` (invites and invite accept and reactivation for seats, lead create and import for leads, API key create for api_keys). `PlanLimitsSchema` + `apiKeys`, `apiCallsPerMonth` (missing = unlimited).
- **Vistar invoices** (`PlatformInvoice`, kinds subscription, plan_change, manual): GST with `computeDocument` (Vistar profile state vs the company's state), numbers `VST/<FY>/<seq>` across companies (`PlatformInvoiceSeries`), seller and buyer frozen at issue, PDF with the CRM template. Payments (`PlatformPayment`): Razorpay or mock checkout (`/billing/invoices/{id}/pay`, `/billing/checkout/verify`, dev `/billing/checkout/mock-pay`), Razorpay webhook `POST /api/hooks/razorpay` (HMAC of the raw body, idempotent by event id), manual "mark paid" by a Super Admin.
- **Plan change**: upgrades are paid first (prorated `plan_change` invoice + checkout) or become a `PlanChangeRequest` for the Super Admin when no checkout is available; downgrades wait for the period end (at once during a trial or from a free plan).
- **Billing cycle** (cron every 15 min, Redis lease): trial reminders, trial end, renewals, overdue -> past_due, reminders on days 0, 3, 7, cancel to the free plan after 14 days past due. Daily usage snapshot 02:30 IST.
- **Super Admin**: subscriptions list with totals, company billing, manual invoice, issue, mark paid, cancel, extend trial, change plan, plan requests, Vistar billing profile (`billing.vistarProfile`), Razorpay config (`billing.razorpay`, secrets encrypted, write-only) under Config.
- **Events and notifications**: `billing.subscription_updated`, `billing.invoice_updated`, `billing.usage_alert` (users with `billing.read`), sync scope `billing`; notification types `billing_trial_ending`, `billing_payment_failed`, `billing_invoice_issued`.
- **Errors**: `PAYMENT_PROVIDER_NOT_CONFIGURED` 422, `PAYMENT_VERIFICATION_FAILED` 400, `PLAN_CHANGE_INVALID` 422.
- **PDF fonts** (D-071): every PDF embeds subset Noto Sans and Noto Sans Devanagari (Type0, Identity-H, ToUnicode, ActualText), shaped with fontkit: the rupee sign and Hindi or Marathi names print correctly.

## 11. Flexible data layer and Industry Packs (Part 1, SPEC 22)

Skill: `.claude/skills/vistar-industry-packs/SKILL.md`. All of this is data in the database; no pack-specific code in core modules.

- **Fields** (`customization/fields.ts`): target = core entity (`CORE_ENTITIES`: lead, contact, company, deal, task, call) or `object:<key>`. `FIELD_TYPES` = text, number, money (whole INR), date, select, multi_select, user, relation, file, geo_point (+ boolean, url kept from before). Per-type config `FIELD_CONFIG_SCHEMAS` (`parseFieldConfig`). `FieldSpecSchema` (authoring; defaults), `FieldDefinitionSchema` (API), `FieldDefinitionUpdateSchema` (no defaults; key/type/target fixed). Access by role key: `access { hiddenFor, readOnlyFor }`, `fieldAccessFor()`, `visibleFields()`. Archive only; keys never reused. `CustomFieldSchema` / `CUSTOM_FIELD_TYPES` are aliases.
- **Values** (`customization/values.ts`): every write to `customFields` (Lead, Contact, Company, Deal, Task, Call) or `CustomRecord.values` goes through `validateCustomValues(defs, values, { mode: 'create' | 'update', roleKey, pathPrefix })` and returns `VALIDATION_FAILED` field errors. Reads go through `visibleValues(defs, values, roleKey)`. `formatFieldValue()` for exports. Unique fields are checked by the API.
- **Objects and records** (`customization/objects.ts`): `CustomObjectSchema` (key, labels, icon, `primaryFieldKey` text field, `showInNav`, `packKey`, fields), `CustomRecordSchema` (title = primary field value, values, ownerId, version). Data scope applies via `ownerId`. Permission resource `records.{read,create,update,delete}`; definitions need `settings.manage`.
- **Labels** (`customization/labels.ts`): `LABEL_KEYS`, `DEFAULT_LABELS`, `resolveLabels()`, `labelOf(labels, 'lead', { plural, lower })`. Stored in Setting `ui.labels`; `MeResponse.labels` is resolved. Display text only: URLs, API paths, events and DB names keep the core names.
- **Pipelines**: `Pipeline.key` (unique per workspace; default pipeline `sales`), `packKey`, archived pipelines/stages hidden. Stage editing keeps using the stage routes.
- **Manifest** (`packs/manifest.ts`): `PackManifestSchema` (schemaVersion 1, semver `version`, `core`, `modes`, labels, objects, fields, pipelines, roles, workflowTemplates, whatsappTemplates, dashboardWidgets, reports, importMappings, navigation, mapLayers). Files: `packs/<key>/manifest.json`, generated from `BUILTIN_PACK_MANIFESTS` by `pnpm --filter @vistar/shared packs` (a test fails when stale).
- **Installer** (`packs/planner.ts`): pure `planPackInstall(state, manifest, { modes, previous, previousModes, reinstall })` and `planPackUninstall(state, manifest)` return ops; the API executes them in ONE transaction and logs `PackInstallLog`. Rules: idempotent, three-way upgrades (admin edits win), conflicts reported not written, archive never delete, stages holding leads kept, templates create-only, labels reverted on uninstall, admin removals not undone, adopted pipelines keep their stage list. `applyPlanToState()` is the reference the executor must match.
- **Data vs runtime items**: objects, fields, pipelines/stages, roles, WhatsApp template suggestions (draft) and labels are written into tenant tables. Navigation, widgets, reports, import mappings, workflow templates and map layers are read from the installed manifest on each request (`buildPackRuntime()`, `GET /packs/runtime`).
- **Entitlement** (`packs/runtime.ts`): `packEntitlement({ core, plan, plans, override })` -> core | plan | grant | none | revoked. Plans in `PackPlanEntitlement`, per-company override in `WorkspacePack.platformOverride`. Separate from `FEATURE_FLAGS`. Revoked packs keep their data but leave the runtime.
- **Core pack** `generic-sales` (`packs/generic-sales.ts`): pipeline `sales` with `DEFAULT_STAGES`, 4 lead fields, the shipped workflow templates, the 7 WhatsApp templates, IndiaMART import mapping. Installed in every workspace, never uninstallable.
- **Routes** (backend-core, phase 2): `/fields*`, `/objects*`, `/objects/{key}/records*`, `/labels`, `/packs`, `/packs/runtime`, `/packs/{key}/{plan|install|upgrade|uninstall|log}`, `/api/super/packs*` (`platform.packs.manage`).
- **Events**: `customization.changed { scope, target }`, `pack.installed`, `pack.uninstalled`, `record.created|updated|deleted`; sync scopes `customization`, `records`.
- **Migration and sync**: migration `20261101180000_flexible_data_layer` renames `CustomField.entity` -> `target`, moves options into `config`, backfills `Pipeline.key`/`packKey` and `Template.packKey`, adds `records.*` to system roles. `pnpm packs:sync` (API script) registers `packs/*/manifest.json` in the registry and installs/upgrades core packs in every workspace; seed and the workspace provisioner call the same installer. The API never migrates at boot.
- **Web extension points** (`apps/web/lib/packs`, `apps/web/lib/customization`, orchestrator): `usePackRuntime()`, `useLabels()`, `useFieldDefinitions(target)`, `withPackNavigation` / `withObjectNavigation` / `withNavLabels` (shared `navigation.ts`), pack pages at `/app/x/<packKey>/<page>` rendered by `<PackPage>`, `<WidgetSlot slot>` (`WIDGET_SLOTS`), UI modules registered lazily in `lib/packs/ui-index.ts`. Missing components render "Not available yet".

## Planned: workflow platform contracts (SPEC 27, Wave 2; not created yet)

Written by the orchestrator when Wave 2 starts, before agents are dispatched:
- `packages/shared/src/connections/*`: `CONNECTION_TYPES` (api_key, bearer, basic, oauth2, custom, webhook_secret, smtp, telegram_bot, whatsapp_provider), `ConnectionSchema` (masked: never contains secret values), create/update/test schemas, usage list. Secrets encrypted with `infra/crypto/secrets.ts`.
- `packages/shared/src/connectors/*`: `ConnectorDefinitionSchema` (name, auth type, base URL, triggers and actions with input fields and sample responses), library scopes (platform / private). Definition files `connectors/<key>.json`.
- Workflow graph v2 (`workflow/*`): new node types (webhook / schedule / poll / manual / sub-workflow triggers, HTTP Request, data, code, switch, loop, merge, wait-for-event, approval, channel nodes), per-node retry / error / rate policies, expression language `{{node.path}}` with defaults, pinned data, run step input/output, replay-from-node. Existing `WORKFLOW_TEMPLATES` migrate to v2.
- REST: connections CRUD + test + usage, connector library, workflow webhook URL + captured samples, schedule "run now", single-node test, run search, replay, cancel, import/export, folders/tags, failure dashboard. Events for run and node progress extend `workflow.*`.
- Plan limits additions (runs, nodes per workflow, schedules) and a `code_node` feature flag.

## Change log

| Date | Change |
| --- | --- |
| 2026-11-01 | STEP 0 contracts created. |
| 2026-11-01 | Leads view modes: `LeadsViewMode`, `leads.viewMode`, `leads.defaultViewMode`, shared `LeadFiltersSchema`, board accepts filters, `SavedView.viewMode`, shared leads state/data/actions in web. |
| 2026-11-01 | Roles and panels: role kinds (`company_admin, manager, employee, viewer`), platform `super_admin`, permission matrix, data scope, custom roles, feature flags, plan limits, navigation map, separate platform auth audience with 2FA, impersonation, support access, `/api/super` routes. |
| 2026-11-01 | qa-reviewer fixes: Update schemas no longer re-apply defaults (Zod 4 `.partial()`), `UserSettingsUpdateSchema` explicit, `WebhookEndpointUpdateSchema`, `leads.merge` permission, `GET /me/today` (`MyTodaySchema`), `GET /users/options`, `TARGET_METRICS`, `input-border` token (`border-input`), `Button` touch sizes, tenant client hardening + `assertInTenant`, TOTP replay protection (`PlatformAdmin.totpLastStep`), `Target.subjectKey`, `TRUST_PROXY` env, self-loop fix in `validateGraph`. |
| 2026-11-01 | Wave 1 prep: web session contract (`lib/session`, `AppProviders`), feature public APIs + dev preview routes, `ScopeService`, `DevAuthGuard` (Wave 1 only), user mapper, `DEFAULT_USER_SETTINGS`, skills `vistar-workflow-nodes`, `vistar-3d-floor`. |
| 2026-11-01 | Wave 1 contract requests: `InviteAcceptSchema.email` (link invites), `API_KEY_PREFIX`, `z.stringbool()` for boolean query params, `SavedView.viewMode` column, `Lead.position COLLATE "C"`, `pg_trgm` search indexes, routes `attentionResolve` and `userMessage`, session actions `updateProfile` / `setStatus` / `updateSupportAccess`, `ProfileUpdate` / `StatusUpdate` / `SupportAccessUpdate` types, new leads at the top of their column (`topOfColumn`, `useCreateLead` inserts at the top), `ai_node` off by default. |
| 2026-11-01 | Industry Packs Part 1 (section 11): customization + packs contracts, `records.*` and `platform.packs.manage` permissions, `MeResponse.labels/packs`, `Pipeline.key/packKey`, `customFields` on Task and Call, `customFieldList` replaced by `fieldList` (`GET /fields`), new routes and events, migration `20261101180000_flexible_data_layer`, `packs/generic-sales/manifest.json`, nav items Industry / Custom objects / Labels / Industry packs. |
| 2026-11-02 | Appearance settings (D-052, section 9): `INTERFACE_STYLES`, `MOTION_INTENSITIES`, `BOARD_SKINS`, `CELEBRATION_INTENSITIES`, `UserSettings.interfaceStyle/motionIntensity/boardSkin/celebrations`, `Workspace.defaultInterfaceStyle/defaultBoardSkin` (audited), resolvers in `appearance.ts`; no migration (Setting rows). Mock sessions fill missing keys from `DEFAULT_USER_SETTINGS`; `openapi.yaml` is written as YAML 1.1 so `off` stays a string. |
| 2026-11-02 | Change #19 wave A (section 12, SPEC 29, D-056..D-066): storage adapter and file routes, component style and branding with contrast guard, custom domains, platform config (Firebase, APK releases), devices and push, presence and status history, SIM call fields and device call-log routes, attendance and field tracking, custom floor requests and floor assets, Super Admin companies; flags `custom_domain`, `field_tracking`; 15 error codes; 6 events; `PUT /me/status` moves to the realtime stream (returns `MyPresence`); heartbeat 15 s, offline after 45 s; `CompanySchema.flagOverrides` is a partial record; migration `20261102200000_change19_platform`. |
| 2026-11-03 | Change #19 wave B (section 13, SPEC 29.9, D-067, D-068): contacts and accounts (GSTIN, PAN, addresses with state code, merge, timeline, notes), deals on a deal pipeline with product lines, lead convert, products and price lists, quotations and invoices (GST math in `gst.ts`, numbering per financial year, payments, PDF, share links), seller profile, calendar (meetings, recurrence, reminders, time off, availability), lead routing rules, lead capture forms (public form and submit), 9 permission resources, navigation, 22 events, 9 sync scopes, notification `meeting_reminder`, 7 error codes, `Pipeline.entity`, migration `20261103000000_change19b_crm`. |

## Planned: User-Workspace membership (D-036, before Wave 2 agents start)

Target model so one person can later belong to several companies by dropping one constraint:
- `User` = global identity: email (unique), passwordHash, googleSub, name, phone, avatar, lastSeenAt. No workspaceId, roleId or teamId.
- `WorkspaceMember` = `{ id, workspaceId, userId, roleId, teamId?, status, statusChangedAt, deskIndex?, workingHours?, title?, isActive, joinedAt, invitedById? }`, `@@unique([workspaceId, userId])` and, for now, `@@unique([userId])` (one company per user).
- Tokens: `sub` = userId, `wid` + `rid` come from the membership. `Lead.ownerId`, `Task.assigneeId` etc. keep pointing at `User.id`; tenant checks verify an active membership in the workspace.
- Tenant client: `WorkspaceMember` is tenant-scoped; `User` reads in feature code go through membership.
- Super Admins stay in `PlatformAdmin`.
Delivered as one backend-core refactor (schema + migration by the orchestrator, code by backend-core) before realtime-integrations and workflow-engine write user queries.
