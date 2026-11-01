# Decisions

Defaults chosen without asking because they do not change scope. Newest last.

| ID | Decision | Why |
| --- | --- | --- |
| D-001 | Versions: Node 26, pnpm 11.9, Next 16.4.3, React 19.3, NestJS 12 (ESM), Prisma 7.10.1 pinned, TypeScript 6.0.3, Tailwind 4.3, zod 4.6, ESLint 9.39 | Prisma CLI `latest` tag points to 8.0.0-rc; Nest CLI pins TS ~6.0 and needs decorator metadata (TS 7 skipped); eslint-config-next plugins are not ready for ESLint 10 |
| D-002 | API is ESM (`type: module`, NodeNext, `.js` import suffixes). Tests: Vitest + SWC (keeps decorator metadata). Scripts: tsx | Nest 12 and Prisma 7 are ESM-first |
| D-003 | Validation with the shared zod schemas via `ZodPipe`, not class-validator or nestjs-zod | One schema for web and API; nestjs-zod has no Nest 12 peer support |
| D-004 | REST contract as code (`API_ROUTES`), bound with `@ApiRoute`; OpenAPI generated with deduplicated `$ref` components | Controllers cannot drift from the contract |
| D-005 | Money is whole rupees (`Int`, `valueInr`) | SME deal values do not need paise; avoids BigInt/Decimal serialisation |
| D-006 | Ids are UUIDv7 via Prisma default; bulk seed uses `randomUUID()` | Time-ordered ids; bulk inserts need ids up front |
| D-007 | The board moves Leads (`Lead.stageId` + fractional `position`); `Deal` holds commercial records; `Lead.valueInr` is the denormalised primary value | Cards show lead fields; dense table and board stay fast |
| D-008 | One user belongs to one workspace (email globally unique). Super Admins live in `PlatformAdmin` | Simpler login; matches SME usage |
| D-009 | Tenant isolation through `prisma.forTenant()` extension; platform tables reject it | A forgotten filter cannot leak data |
| D-010 | Domain events over Redis pub/sub (`vistar:events`); exactly-once side effects through BullMQ jobs with deterministic ids | Works across API instances, workers and the simulator |
| D-011 | Tokens defined in TS, CSS generated; Tailwind default palette disabled | Same values in CSS, Three.js and emails; no off-palette colours |
| D-012 | Base kit hand-written in shadcn style on the `radix-ui` package; `sonner` for toasts | shadcn CLI is interactive; same component API |
| D-013 | `motion` package (current name of Framer Motion) for UI motion; `@react-spring/web` for physics | Same library, maintained name |
| D-014 | All stack dependencies pre-installed on `main` | Parallel agents never conflict on the lockfile |
| D-015 | Agent definitions live in `.claude/agents` (Claude Code format). In this Kiro session they run as Kiro sub-agents with the same instructions | User asked for `.claude/agents`; Kiro dispatches its own sub-agents |
| D-016 | `frontend-design` is on disk in the plugin marketplace clone but not installed; agents read it by path. The Vistar design system overrides its "distinctive aesthetic" push (the skill itself says the brief wins) | Brief pins the visual direction |
| D-017 | Role kinds `company_admin, manager, employee, viewer`; custom roles = kind + data scope + permissions | Spec change (three panels) |
| D-018 | backend-core builds Super Admin auth (login, mandatory TOTP, platform guard, `/api/super/me`) in Phase 1; superadmin-panel builds the panel features in Phase 9. frontend-app creates the `(super-admin)` shell with placeholders in Wave 1 | Phase 1 includes guards and their tests; panel features stay in Phase 9 |
| D-019 | Status control: Available = `idle`, On call = `on_call`, Break = `away`, Offline = `offline`; `busy` is set automatically | Keeps one presence enum for floor and chips |
| D-020 | TOTP implemented in-house (RFC 6238). Seeded Super Admin enrols 2FA on first login; no secret is generated or printed by the seed | No new dependency; no secrets in logs |
| D-021 | A `.env` with `FIZZLY_*` already existed; `pnpm setup:env` only appends missing keys | Never overwrite user secrets |
| D-022 | Web route guards run client-side (access token in memory, API on another origin); the API enforces everything | Next proxy cannot read the token |
| D-023 | Leads Board view is built by frontend-physics (`features/pipeline`), mounted by frontend-app's Leads page; shared state/data/actions in `lib/leads` and `components/leads-shared` (orchestrator) | Single source of truth across two owners |
| D-024 | Docker Compose: Postgres 17, Redis 7, MinIO, Mailpit | Local stack in one command |
| D-025 | Prisma default table/column names (no snake_case mapping) | Less noise; raw SQL must quote identifiers |
| D-026 | Full-text search index (tsvector/trigram) added by a Phase 2 migration on request from backend-core | Needs measured queries first |
| D-027 | Workflow node configs use stable keys (`stageKey`, `templateName`), not ids | Templates are portable across workspaces |
| D-028 | Super Admin API mounted at `/api/super/*` (unversioned), workspace API at `/api/v1/*` | As specified |
| D-029 | Wave 1 runs 7 parallel streams: backend-core and frontend-app and frontend-physics each split into two streams with disjoint folders | Keeps each agent's task within one session and maximises parallelism without shared files |
| D-030 | Wave 1 web uses a mock session (`lib/session`) with personas; the real auth API is wired in Wave 3 behind the same hooks | Frontends never wait for the backend |
| D-031 | `DevAuthGuard` (`x-dev-user`, `DEV_AUTH=1`, development only) lets the CRM stream test endpoints before the real guard is merged; removed in Wave 3 | Parallel backend streams without coupling |
| D-032 | `vistar-workflow-nodes` and `vistar-3d-floor` skills created now (not Phase 6/8) because the builder and floor are built in Wave 1; `vistar-webhooks-security` comes before Wave 2 | "Just before the phase that needs them" |
| D-033 | Builder and board each implement their own drag physics in Wave 1; shared physics primitives are consolidated in the Wave 4 performance pass if they converge | Avoids a cross-stream dependency mid-wave |
| D-034 | Web dev ports per stream 3001-3005, API 4001-4002; main keeps 3000/4000 | Parallel dev servers do not collide |
| D-035 | Added `papaparse` to web for client-side CSV preview in the mock import flow | Import mapping UI must work before the API exists |
