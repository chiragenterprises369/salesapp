# Demo: dummy data and demo accounts

Development and demo only. Never load the demo data into production (`seed:demo` refuses NODE_ENV=production).

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
2. Start the live demo so the Team Floor and the Leads board move on their own:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\demo-live.ps1
   ```

   It keeps 10 Shakti people online (heartbeats every 15 s), changes some statuses every minute (meeting, field visit,
   lunch, break) and adds a new lead or moves a lead on the board about every 45 s. It logs in as the demo users
   through the API, so the API must be running. Log: `%TEMP%\vistar-run\demo-live.log`.
   Stop it: `Stop-Process -Id (Get-Content "$env:TEMP\vistar-run\demo-live.pid")`

## What to show

- `anil@` (admin): dashboard, Leads board (Neon skin), Team Floor 3D, Contacts, Deals, Quotations and Invoices
  (PDF, E-mail or WhatsApp), Calendar, Inbox, Reports, Settings (Setup checklist, templates, branding).
- `priya@` (manager): team view and reports for her team.
- `rohit@` (employee): own leads, tasks and calls, the employee panel.
- `deepa@` (viewer): everything read only.
- `owner@vistar.example` (Super Admin): companies, plans and billing, switches, floors, Config and Go-live checklist.

These accounts use a public password. Do not expose them on a public server with real client data.
