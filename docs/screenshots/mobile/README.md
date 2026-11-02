# Vistar employee app: browser check for Kiro Crew (Playwright)

The user asked for browser testing of the Flutter web preview to be done by Kiro Crew, not by the mobile agent. Paste the prompt below into Kiro Crew. Screenshots go into this folder.

---

## Prompt for Kiro Crew

You are checking the Vistar employee app (Flutter, web build of the Android app) in a browser with Playwright. Work only in `D:\salesapp\.worktrees\mobile` (branch `agent/mobile`). Do not edit `apps/mobile/lib` code; report problems instead. Windows, PowerShell. The machine has 7.8 GB RAM: run one browser at a time, and stop every server you start when you finish. Never touch the user's servers on ports 3000 and 4000.

### 1. Start the API (port 4020, database vistar_mobile) and the web preview (port 3010)

```powershell
# API (already built in apps/api/dist). WEB_ORIGIN lets the preview on 3010 call it with cookies.
$env:API_PORT='4020'
$env:DATABASE_URL='postgresql://vistar:vistar@localhost:5432/vistar_mobile?schema=public'
$env:WEB_ORIGIN='http://localhost:3000,http://localhost:3010,http://127.0.0.1:3010'
$env:API_PUBLIC_URL='http://localhost:4020'
$api = Start-Process node -ArgumentList 'dist/main.js' -WorkingDirectory 'D:\salesapp\.worktrees\mobile\apps\api' -WindowStyle Hidden -PassThru -RedirectStandardOutput "$env:TEMP\vistar-mobile-api.log" -RedirectStandardError "$env:TEMP\vistar-mobile-api.err.log"
# Web preview (already built in apps/mobile/build/web)
$web = Start-Process node -ArgumentList 'tool/serve_web.mjs','3010' -WorkingDirectory 'D:\salesapp\.worktrees\mobile\apps\mobile' -WindowStyle Hidden -PassThru
Start-Sleep 25
Invoke-WebRequest -UseBasicParsing http://localhost:4020/api/health   # {"ok":true,"db":true,"redis":true,...}
Invoke-WebRequest -UseBasicParsing http://localhost:3010/              # 200
```

If Postgres or Redis is down: start Docker Desktop, wait for `docker info`, then `docker compose up -d postgres redis` from `D:\salesapp`. Never `docker compose down`.
At the end: `Stop-Process -Id $api.Id, $web.Id`.

### 2. How to drive a Flutter web app

- The app draws on a canvas. Before using text locators, turn on Flutter's accessibility tree once per page load: `await page.locator('flt-semantics-placeholder').click({ force: true })` (or press Tab). Then `page.getByRole('button', { name: 'Sign in' })`, `getByText(...)` and `getByLabel(...)` work.
- Wait for the app: `await page.waitForSelector('flutter-view')`, then wait ~1.5 s for the first frame.
- Routes are hash URLs: `http://localhost:3010/#/today`.
- Viewport: 412 x 915, `deviceScaleFactor: 2`, `isMobile: true`, `hasTouch: true`.
- Theme without clicking: before the page loads, set `localStorage['flutter.vistar.theme'] = '"dark"'` (or `'"light"'`). Demo data without an API: `localStorage['flutter.vistar.demo'] = 'true'`.

### 3. Personas (API mode)

- `rohit@shakti.example` / `vistar-demo-123`: employee, own data, marked field staff in vistar_mobile (attendance screens).
- `anil@shakti.example` / `vistar-demo-123`: company admin (sees the whole team on the Team Floor).

### 4. Screenshots (light and dark, 412 x 915) into `docs/screenshots/mobile/`

Name them `<nn>-<screen>-<light|dark>.png`. Use API mode as Rohit unless noted; use Demo mode (`flutter.vistar.demo`) for screens that are empty in API mode, and say which mode in the report.

| # | Screen | How to reach it |
| --- | --- | --- |
| 01 | Login | `#/login` (signed out) |
| 02 | Today | sign in, `#/today` |
| 03 | Status sheet | tap the status pill at the top right of Today |
| 04 | Leads | `#/leads` |
| 05 | Lead detail | tap the first lead |
| 06 | Tasks | `#/tasks` |
| 07 | Calls | `#/calls` |
| 08 | Inbox | `#/inbox` |
| 09 | Chat | tap the first conversation (Demo mode if the inbox is empty) |
| 10 | Team Floor | `#/team-floor` (also once as Anil) |
| 11 | Team Floor full screen | the expand icon on the Team Floor |
| 12 | My room | `#/office-zone` |
| 13 | Attendance consent | `#/attendance` as Rohit before accepting |
| 14 | Attendance | after "I agree, continue" (check-in shows "Android only" on the web, that is expected) |
| 15 | My performance | `#/performance` |
| 16 | Notifications | `#/notifications` |
| 17 | More | `#/more` |
| 18 | Profile | `#/profile` |
| 19 | Preferences | `#/preferences` |
| 20 | About | `#/about` |
| 21 | Call setup | `#/call-setup` |

### 5. Checks (report pass or fail with the evidence)

1. Sign-in as Rohit lands on Today; a page reload keeps the session (refresh cookie); Sign out (More > Sign out) returns to Login and a reload stays signed out.
2. Wrong password shows "Email or password is not correct." and no navigation.
3. Every screen above renders without a red error box, an endless skeleton, or text cut off; no horizontal scroll except the filter chip rows.
4. Status: pick "On break" in the status sheet, the pill changes; reload, it is still "On break"; set "Available" again.
5. Team Floor shows the "Live" chip within 10 s (socket connected), the default-layout note, and the people list. As Anil, open Rohit's sheet: status and "Using ..." (screen) appear after Rohit's tab is open on another page.
6. Tasks: complete a task, it moves to done with Undo; Undo restores it.
7. Preferences: switch to Dark, the app turns dark at once; reload keeps dark.
8. Text scale 130%: add `page.addInitScript(() => { document.documentElement.style.fontSize = '130%'; })` before loading Today, Lead detail and Team Floor. If the text grows, check that nothing overlaps or is cut off. If it does not grow, mark the check "not testable in the browser" (it is checked on the Android phone later).
9. Accessibility: with the semantics tree on, every icon-only button has a name (tooltip label), tap targets are at least 48 x 48 CSS px (measure the semantics nodes).
10. Network: no request goes to port 4000 or 3000; every API call goes to `http://localhost:4020/api/v1/...`; list any 4xx/5xx responses with the path.
11. Console: list errors from `page.on('console')` and `page.on('pageerror')`.

### 6. Report

Write `docs/screenshots/mobile/kirocrew-report.md`: the table of screenshots taken, each check with pass or fail and evidence, the failing requests and console errors, and up to 10 visual issues (what, where, screenshot name). Do not commit; the mobile agent or the orchestrator commits.
