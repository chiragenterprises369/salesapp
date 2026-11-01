---
name: vistar-conventions
description: Repo structure, contract rules and coding conventions for the Vistar monorepo (Next.js 16 web, NestJS 12 API, packages/shared). Use for every Vistar task before writing code.
---

# Vistar conventions

## Before you start
1. Read `CONTRACTS.md`, your rows in `OWNERSHIP.md`, and `DECISIONS.md`.
2. Read the other skills SKILLS.md lists for your agent.
3. Check the repo: do not rebuild what exists (`git log`, search `packages/shared` first).

## Hard rules
- Stay inside your owned folders. Contracts (`packages/shared/src`, `apps/web/components/ui`, `apps/web/lib/leads`, `apps/web/styles`, `apps/api/src/{common,infra,config}`, `apps/api/prisma`) are read-only. Need a change? Add a `CONTRACT-REQUEST` block to your summary.
- No new dependencies. Everything in the stack is installed. If you need one, request it.
- Never put secrets in code, logs, fixtures or the browser. Server env only; only `NEXT_PUBLIC_*` reaches the client.
- Build against `@vistar/shared` types and `@vistar/shared/fixtures` mocks. Do not invent parallel types.

## Monorepo
- `packages/shared` (ESM, built to `dist`): run `pnpm build:shared` after pulling contract changes.
- `apps/api`: NestJS 12 ESM. Relative imports end in `.js`. Prisma client: `../generated/prisma/client.js`.
- `apps/web`: Next 16 App Router, Tailwind 4, `@/` alias. Route groups: `(auth)`, `(company)/app`, `(employee)/me`, `(super-admin)/super-admin`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @vistar/web build`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm simulate`.

## API rules (NestJS)
- One controller per resource, `@Controller()` with no prefix, each handler `@ApiRoute(API_ROUTES.<id>)`.
- Validate with `new ZodPipe(Schema)` from `common/validation/zod.pipe.ts`. Return objects matching the route `response` schema (map Prisma rows: `Date` -> ISO string).
- Caller: `@CurrentAuth() auth: AuthContext` (workspace) or `@CurrentPlatformAdmin()` (/api/super).
- Data: `this.prisma.forTenant(auth.workspaceId)`; unchecked inputs (`ownerId`, not `connect`). Apply `auth.dataScope` (own / team / all) to every lead, task, call and conversation query.
- Errors: `throw new AppException('LEAD_DUPLICATE', 'A lead with this phone already exists')`. Messages are user-safe: no PII, ids of other tenants, or stack traces.
- Events: `await this.events.publish('lead.created', workspaceId, payload, { actor })` AFTER the transaction commits.
- Audit: every sensitive action (role change, impersonation, plan change, export, delete, API key, integration secret) writes `AuditLog` (and `PlatformAuditLog` for Super Admin).
- Logs: never log request bodies, phone numbers (use `maskPhone`), tokens or secrets.

## Web rules
- Server state: TanStack Query only. Leads data through `lib/leads/data.ts` hooks. Query keys start with a `SYNC_SCOPES` value.
- Client state: Zustand stores, small and local to the feature.
- UI: compose `@/components/ui` (Button, Input, FormField, Card, Table, Chip, StatusChip, Dialog, Toast, Skeleton, Avatar). Icons: `lucide-react`, 16px, stroke default.
- Every list/page has a skeleton state, an empty state that says what to do next, and an error state with a retry.
- Hide what the user may not do: `visibleNav()`, `hasPermission()`. The API still enforces it.
- Money `formatInr(v)` / `formatInr(v, { compact: true })`. Phones `normalizeIndianPhone`. Durations `formatDuration`.
- Copy: sentence case, active verbs ("Save changes", "Lead moved to Quote sent"), errors say what happened and how to fix it.

## Git
- Branch `agent/<name>` in `.worktrees/<name>`. Small commits: `feat(leads): add saved views API`.
- Before you finish: `pnpm typecheck`, `pnpm lint`, run what you built (dev server or tests). Fix all errors.

## Summary format (every task)
Five lines max, then optional blocks:
```
Done: <what works now>
Files: <main paths>
Run: <how to see it>
Deps: none | <requested deps>
Next: <follow-ups or blockers>
CONTRACT-REQUEST: ... (only if needed)
Skills used: vistar-conventions, ...
```
