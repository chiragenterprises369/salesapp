# Vistar employee app (Flutter, Android + web preview)

Package `app.vistar.employee`. Android only for phones (no iPhone app for now, SPEC 29.1); the same code builds for the web so the screens can be checked in a browser. Always the premium design, with the company's brand colour and logo from the API (`me.workspace.branding`). Decisions: D-056 to D-063.

## Screens

Login (Demo mode switch, off by default), Today, Leads (search, filters, stage change), Lead detail (timeline, notes, tasks, call, WhatsApp), Tasks (complete, undo, snooze), Calls (log, outcome and notes after a call, SIM calling), Inbox and chat (templates, quick replies, 24 h window), Team Floor (flat plan from the published seat map or the default template, live people list with status, room and screen, full screen), My room (QR scan, manual pick), Status sheet, Attendance (consent, check-in and check-out with GPS, today's route), My performance, Notifications, Profile, Preferences, About (update check, APK download), Call setup (permissions).

## Data

- `lib/data/api/*`: one `Api*Repository` per feature over dio; paths in `endpoints.dart` (checked against `agent/backend-core:packages/shared/openapi/openapi.json`).
- Auth: `POST /auth/login`; the refresh token arrives in the `vistar_rt` cookie. Android keeps it in secure storage and sends it as `Cookie` to `POST /auth/refresh` (rotation, single flight, a rejected refresh ends the session); the browser keeps the httpOnly cookie itself.
- Offline: Today, leads, tasks, calls, pipelines and the floor layout are cached (SQLite on Android, localStorage on the web). Task status, device call logs, recordings and location batches go through a persistent write queue (`core/offline/write_queue.dart`) flushed on reconnect, on resume and every 30 s.
- Realtime: Socket.IO `/realtime` with `{ token, client, appVersion, fresh }`; events patch the Team Floor (version ordering), tasks, chats and notifications; `sync.required` after a reconnect refetches.
- `lib/demo/*`: fake repositories for tests, goldens and the explicit Demo mode only.

## Native (Android)

- `vistar/telephony` (Kotlin, `android/app/src/main/kotlin/app/vistar/employee/telephony`): `placeCall` (TelecomManager with the chosen SIM, ACTION_DIAL fallback), phone state in the `CallMonitorService` foreground service during working hours (EventChannel `vistar/telephony/events`), call log query, recordings from the phone's own recorder folders (MediaStore). The app never records audio.
- `vistar/zones` (`zones/ZonesChannel.kt`): iBeacon BLE scan and Wi-Fi scan results for office room detection (opt-in in Preferences, working hours only). QR markers use the camera (`mobile_scanner`).
- Flow: OFFHOOK -> `POST /me/calls/active {event: started, clientCallId}`; IDLE -> `{event: ended}`, then the call log row -> `POST /me/calls/device-log` (deviceCallId, idempotent) -> the phone's recording -> `POST /calls/{id}/recording`.
- Field GPS (geolocator foreground service) only while checked in and inside working hours; stops when the server rejects points outside them.
- Heartbeat `POST /me/presence/heartbeat` every 15 s with `screen`, `appState`, `deviceId` and the latest room signal.
- Push: Firebase is initialised at runtime from `GET /app/config` (no google-services.json in the APK); `POST /me/devices` after every sign-in. Deep links: `vistar://app/<path>` (for example `vistar://app/leads/<id>`).

## Run the web preview

```powershell
cd apps/mobile
flutter build web --release --no-web-resources-cdn --dart-define=VISTAR_API_URL=http://localhost:4020
node tool/serve_web.mjs 3010     # http://localhost:3010
```

The API must allow the preview origin: start it with `WEB_ORIGIN=http://localhost:3000,http://localhost:3010` until the `DEV_CORS_PORTS` handling lands. Without an API, switch on Demo mode on the login screen. `?api=http://host:port` on the preview URL overrides the server for one browser.

## Build the APK

```powershell
cd apps/mobile
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
# The project is on D: and the default pub cache on C:; Kotlin's incremental compiler fails across drives,
# so use a pub cache on the same drive (git-ignored):
$env:PUB_CACHE="$PWD\.pub-cache"
flutter pub get
flutter build apk --release
cd android; .\gradlew --stop
```

Signing: `android/key.properties` (git-ignored) points at `android/vistar-release.jks` (git-ignored, local only). Without it the release build is signed with the debug key. Bump `version:` in `pubspec.yaml` (versionName+versionCode) for every APK uploaded in the Super Admin config section. The app's server is set in the hidden developer sheet (long-press the logo on the login screen), default `http://10.0.2.2:4000` for the emulator; or build with `--dart-define=VISTAR_API_URL=https://...`.

## Tests

```powershell
flutter analyze
flutter test
```

`test/unit/contract_models_test.dart` covers request bodies against the change #19 schemas, parsing, call-log results, layout_json plans, consent versions, forced update, overnight working hours and the room signal choice. Browser checks of the web preview are run by Kiro Crew (Playwright); see `docs/screenshots/mobile/README.md`.

## Play Console declarations (when publishing)

- **Call log permissions** (READ_CALL_LOG, PROCESS_OUTGOING_CALLS): use case "CRM / sales app with a corporate login"; the core feature is logging work calls made from the employee's SIM to the customer record. Show the in-app disclosure (Call setup screen) before the permission prompt.
- **Phone** (READ_PHONE_STATE, CALL_PHONE): place calls from the employee's SIM and show "On call" while a work call is live.
- **Foreground service `specialUse`**: "Business CRM call tracking: reports when the signed-in employee's work call starts and ends, during the company's working hours only" (manifest property `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`). Location foreground service: field visit tracking while checked in.
- **Location** (fine and coarse, no background permission): attendance check-in/out and field visit route while checked in inside working hours, plus office room detection; consent screen recorded on the server (`PUT /me/tracking-consent`).
- **Nearby devices** (BLUETOOTH_SCAN) and Wi-Fi state: office room detection from room beacons and office Wi-Fi, opt-in.
- **Audio files** (READ_MEDIA_AUDIO): upload the phone's own call recordings; the app does not record audio.
- **Camera**: scan the room QR codes. **Notifications**: leads, tasks, WhatsApp replies.
- Data safety: location, phone numbers, call logs and audio files are collected for app functionality, shared only with the employee's company, encrypted in transit; account deletion through the company admin.
- Access for review: a demo company account (Settings > App access).
