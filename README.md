# Vistar

Multi-tenant sales management for Indian SMEs: CRM, automation and a live team floor.
Monorepo: `apps/web` (Next.js 16), `apps/api` (NestJS 12), `packages/shared` (contracts).

## Setup (under 10 minutes)

Requirements: Node 22.12+ (tested on 26), pnpm 11, Docker Desktop.

```bash
pnpm install              # installs everything, generates the Prisma client
pnpm setup:env            # creates/completes .env with local secrets (never overwrites existing values)
pnpm db:up                # Postgres 17, Redis 7, MinIO, Mailpit
pnpm db:migrate           # apply migrations
pnpm db:seed              # plans, Super Admin, 3 demo companies (2,940 leads)
pnpm dev                  # shared (watch) + API :4000 + web :3000
```

- Web: http://localhost:3000 (UI kit: http://localhost:3000/kit)
- API health: http://localhost:4000/api/health
- Live events: `pnpm simulate` (needs Redis and a seeded DB)
- Mailpit: http://localhost:8025, MinIO console: http://localhost:9001

Dev logins (password `vistar-demo-123`, printed by the seed):

| Panel | User |
| --- | --- |
| Super Admin `/super-admin` | owner@vistar.example (enrol 2FA on first login) |
| Company `/app` (admin) | anil@shakti.example |
| Company `/app` (manager) | priya@shakti.example |
| Employee `/me` | rohit@shakti.example |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | all packages |
| `pnpm e2e` | Playwright suite (`e2e/`) |
| `pnpm openapi` | regenerate `packages/shared/openapi/openapi.{json,yaml}` |
| `pnpm --filter @vistar/shared tokens` | regenerate `apps/web/styles/tokens.css` |

## Docs

- `CONTRACTS.md` — shared contracts (API, events, roles, panels, theme, leads views)
- `OWNERSHIP.md` — who owns which folder
- `DECISIONS.md` — defaults chosen and why
- `SKILLS.md` — skills agents must read
- `.claude/agents/` — agent definitions, `.claude/skills/` — project skills
