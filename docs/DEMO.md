# Demo: dummy data and demo accounts

Development and demo only. Never load the demo data into production (`seed:demo` refuses NODE_ENV=production).

## Environments

| Site | Web (Vercel) | API (Render) | Database (Neon) | Data |
| --- | --- | --- | --- | --- |
| `https://crm.tootodo.com` (production) | project `salesapp` | `salesapp-api` (`salesapp-api-lqk9.onrender.com`) | `salesapp-prod` | real companies only |
| `https://demo.crm.tootodo.com` (demo) | project `salesapp-demo` | `salesapp-api-demo` (`salesapp-api-demo.onrender.com`) | `salesapp-demo` | the 3 demo companies below |

Demo seeds, demo accounts and the live office script only ever go to the demo environment. Running them against
production once used up the free database quota and took crm.tootodo.com down (Nov 2026).

## Load the demo data

```powershell
docker compose up -d postgres redis
pnpm install
pnpm db:generate
pnpm --filter @vistar/api prisma:deploy
pnpm db:seed:demo     # wipes and recreates the 3 demo companies; dates are relative to today
```

`db:seed:demo` creates 3 companies with history up to today: leads, contacts, deals, products, GST quotations and
invoices with payments, meetings, 30 days of calls, WhatsApp conversations, tasks, workflows, attendance and GPS pings,
notifications, integrations, webhooks, billing and Super Admin history.

| Company | Plan | Leads |
| --- | --- | --- |
| Shakti Industries | Growth | 2,500 |
| Navkar Polymers | Starter | 320 |
| Sunrise Agro Foods | Free trial | 120 |

## Demo accounts

Password for every account: `vistar-demo-123`

Company panel: http://localhost:3000/login

**Shakti Industries** (best for demos)

| Role | Email | Name |
| --- | --- | --- |
| Company admin | anil@shakti.example | Anil Kapoor |
| Manager | priya@shakti.example | Priya Sharma |
| Manager | gurpreet@shakti.example | Gurpreet Singh |
| Employee | rohit@shakti.example | Rohit Verma |
| Employee | sneha@shakti.example | Sneha Iyer |
| Employee | kavita@shakti.example | Kavita Reddy |
| Employee | farah@shakti.example | Farah Khan |
| Employee | imran@shakti.example | Imran Sheikh |
| Employee | karthik@shakti.example | Karthik Menon |
| Employee | lakshmi@shakti.example | Lakshmi Nair |
| Employee | mohit@shakti.example | Mohit Bansal |
| Viewer (read only) | deepa@shakti.example | Deepa Joshi |

**Navkar Polymers**

| Role | Email |
| --- | --- |
| Company admin | jignesh@navkar.example |
| Manager | hetal@navkar.example |
| Employee | bhavin@navkar.example, komal@navkar.example, ravi@navkar.example |

**Sunrise Agro Foods**

| Role | Email |
| --- | --- |
| Company admin | senthil@sunrise.example |
| Manager | revathi@sunrise.example |
| Employee | arun@sunrise.example, divya@sunrise.example |

**Super Admin**: http://localhost:3000/super-admin/login, `owner@vistar.example`. 2FA is enrolled on the first login
(scan the QR code with an authenticator app). Re-running `db:seed:demo` recreates this account, so 2FA is enrolled again.

## 3D space look and the live Team Floor

1. As `anil@shakti.example`, Settings > Theme: set the workspace interface style to **Neon Space** and the board skin to
   **Neon**. Team Floor view mode: **3D**.
2. Start the live office so the Team Floor and the Leads board move on their own:

   ```powershell
   # local API
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1
   # demo site (demo.crm.tootodo.com); never the production API
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1 -Api https://salesapp-api-demo.onrender.com/api/v1
   ```

   Every Shakti person (10) gets their own day: working at the desk with a screen and lead open, phone calls (walks to
   the calling booth, the call is logged), chai break and lunch (walks to the lounge), meetings and field visits. As
   the admin it adds new IndiaMART, website and WhatsApp leads and moves leads along the pipeline, sometimes to Won.
   `-Company navkar` or `-Company sunrise` runs it for the other companies. It logs in through the API as the demo
   users, so it only works with the demo data loaded.
   Log: `%TEMP%\vistar-run\demo-live-<api host>.log`.
   Stop: `Stop-Process -Id (Get-Content "$env:TEMP\vistar-run\demo-live-<api host>.pid")`

## Live office 24/7 on Render

[scripts/demo-live/worker.mjs](../scripts/demo-live/worker.mjs) is the same live office in Node 20+ (no dependencies)
for a host that never sleeps. It keeps its sessions with the refresh cookie (no new password sign-in every 15 minutes),
waits when the API is down or deploying, and on a restart ends open calls and signs everyone off. The pace is calmer
than the PowerShell script: up to 3 calls at a time, a board action every 1.5 to 3 minutes (about a third are new
leads, roughly 200 a day), a few overdue follow-ups cleared at a time.

Render: New > **Background Worker**, repository `chiragenterprises369/salesapp`, branch `main`.

| Setting | Value |
| --- | --- |
| Root Directory | `scripts/demo-live` (other changes in the repo do not restart it) |
| Runtime | Node |
| Build Command | `npm install` (nothing to install) |
| Start Command | `node worker.mjs` |
| Instance type | Starter (background workers have no free plan) |

Environment variables are optional, and the worker needs no secrets (it signs in with the public demo password, the
same default as `demo-live.ps1`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEMO_COMPANY` | `shakti` | `shakti`, `navkar` or `sunrise` |
| `DEMO_HOURS` | `always` | Or office hours in India time, e.g. `09:30-19:30` (Mon-Sat): outside them everyone is offline and only an occasional enquiry comes in |
| `DEMO_API_URL` | demo API | Versioned API base of the demo environment, `https://salesapp-api-demo.onrender.com/api/v1` (never the production API) |

Keep in mind:

- The demo API (`salesapp-api-demo`) must be a paid instance while the worker runs. On the free plan the worker keeps
  it awake about 720 hours a month, and the workspace's 750 free hours are shared by all its free services, so Render
  would suspend them before the month ends. The demo database (Neon Free, 100 compute-hours a month) also runs out
  when it never sleeps: use `DEMO_HOURS` office hours or a paid plan.
- Every day adds data (leads, calls, tasks, notifications). Re-run `pnpm db:seed:demo` against the demo database
  (Neon `salesapp-demo`) every month or so to start fresh; it only replaces the 3 demo companies and the demo Super
  Admin. Run it with the demo API's `ENCRYPTION_KEY` (Render > salesapp-api-demo > Environment) so the seeded
  integration secrets can be decrypted.
- Do not run `demo-live.ps1` against the demo API at the same time, or the office gets double activity.
- Logs: the worker's Logs tab in Render. Stop: Settings > Suspend Background Worker (or delete it).

## What to show

- `anil@` (admin): dashboard, Leads board (Neon skin), Team Floor 3D, Contacts, Deals, Quotations and Invoices
  (PDF, E-mail or WhatsApp), Calendar, Inbox, Reports, Settings (Setup checklist, templates, branding).
- `priya@` (manager): team view and reports for her team.
- `rohit@` (employee): own leads, tasks and calls, the employee panel.
- `deepa@` (viewer): everything read only.
- `owner@vistar.example` (Super Admin): companies, plans and billing, switches, floors, Config and Go-live checklist.

These accounts use a public password. Do not expose them on a public server with real client data.
