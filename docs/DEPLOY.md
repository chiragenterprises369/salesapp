# Deploying Vistar (change #20)

One Linux server runs the whole stack with Docker Compose: Caddy (TLS and reverse proxy), the web app (Next.js),
the API (NestJS), optionally a worker for the hub jobs, PostgreSQL 17, Redis 7 and a backup job. Files (logos,
floors, APKs, recordings) go to S3-compatible storage or Bunny Storage, never to the server disk.

```
Internet -> Caddy :80/:443 -> web:3000   (app host and verified custom domains)
                           -> api:4000   (API host: REST, Socket.IO, webhooks, files)
           api / worker -> postgres:5432, redis:6379 (internal network, no published ports)
           backup       -> pg_dump -> backups volume -> S3 or Bunny
```

Files: `Dockerfile.api`, `Dockerfile.web`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`,
`deploy/backup/*`, `.env.production.example`. Day-2 operations are in `docs/RUNBOOK.md`.

## 1. Server sizing

| Size | Companies / users | Server | Disk |
| --- | --- | --- | --- |
| Start | up to 20 companies, 200 users | 4 vCPU, 8 GB RAM | 80 GB SSD |
| Grow | up to 100 companies, 1,000 users | 8 vCPU, 16 GB RAM | 160 GB SSD |
| Larger | more | split Postgres to a managed database, 2+ API instances behind Caddy, `worker` profile | |

- Memory budget of the compose limits: Postgres 2 GB, API 1 GB, web 768 MB, worker 768 MB, Redis 384 MB, Caddy 256 MB.
- Building the web image needs about 4 GB of free memory (`NODE_OPTIONS=--max-old-space-size=3072`). Build on CI or
  a bigger machine and push to a registry if the server is small, or add 4 GB of swap for the build.
- OS: Ubuntu 24.04 LTS (or Debian 12) with Docker Engine 27+ and the compose plugin. Open only 22, 80 and 443
  (`ufw allow OpenSSH; ufw allow 80; ufw allow 443/tcp; ufw allow 443/udp; ufw enable`). Set the server timezone to
  UTC; containers use Asia/Kolkata where it matters.

## 2. DNS

| Record | Name | Value |
| --- | --- | --- |
| A (and AAAA) | `app.example.in` (VISTAR_WEB_HOST) | server IP |
| A (and AAAA) | `api.example.in` (VISTAR_API_HOST) | server IP |
| A (and AAAA) | `domains.example.in` (CUSTOM_DOMAIN_CNAME_TARGET) | server IP |

Customers who get a custom domain (Super Admin switch `custom_domain`) add `CNAME crm.customer.in -> domains.example.in`
and the TXT record shown in their settings. Caddy requests a certificate for their host only after the API confirms
the domain is verified and switched on (`/api/tls/ask`), so nobody can make the server request certificates for
random names.

## 3. Prepare the server

```bash
git clone <repo> /opt/vistar && cd /opt/vistar
cp .env.production.example deploy/.env.production
chmod 600 deploy/.env.production
# secrets (each one different)
for k in JWT_ACCESS_SECRET JWT_REFRESH_SECRET SUPER_JWT_SECRET; do echo "$k=$(openssl rand -base64 48 | tr -d '\n')"; done
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"; echo "REDIS_PASSWORD=$(openssl rand -hex 24)"
echo "BACKUP_ENCRYPTION_PASSPHRASE=$(openssl rand -base64 33)"
```

Fill in hosts, secrets, `ACME_EMAIL`, `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` (at least 12
characters), the backup target. Store `ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_PASSPHRASE` in the company password
manager as well: without them backups and stored secrets cannot be read.

### What the API refuses in production

With `NODE_ENV=production` (set by the image) the API does not start when any of these is true, and prints the list:
JWT or Super JWT secrets shorter than 32 characters, an example value or too few distinct characters; access and
refresh secrets equal; ENCRYPTION_KEY not 32 random bytes; API_PUBLIC_URL or a WEB_ORIGIN entry not https or on
localhost; WEB_ORIGIN `*`; no REDIS_URL; a weak database password; DEV_AUTH on; DEV_CORS_PORTS or
OUTBOUND_ALLOW_PRIVATE_HOSTS set; STORAGE_DRIVER=local; BILLING_PROVIDER=mock; TELEPHONY_PROVIDER=mock;
NEXT_PUBLIC_DATA_SOURCE=mock; SEED_DEMO set. Mock integrations are refused at connect and at use, dev preview pages
(`/kit`, `/dev/*`) answer 404 and the demo seed is never part of the image.

## 4. Build and first boot

```bash
cd /opt/vistar
export APP_VERSION=$(git rev-parse --short HEAD)
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production"
$C build api web            # and: $C --profile tools build migrate ; $C --profile backup build backup
$C up -d postgres redis
$C --profile tools run --rm migrate      # prisma migrate deploy
$C --profile tools run --rm seed         # plans, Industry Pack registry, the first Super Admin
$C up -d                                 # caddy, web, api
$C --profile backup up -d backup         # scheduled backups
curl -fsS https://api.example.in/api/health; curl -fsS https://api.example.in/api/ready
```

The `seed` job is safe to run again (it keeps an existing Super Admin's password and 2FA). Remove
`SEED_SUPER_ADMIN_PASSWORD` from the env file after the first login.

## 5. Super Admin setup

1. Open `https://app.example.in/super-admin/login`, sign in with the seeded account and enrol 2FA (TOTP app).
2. Super Admin > Config, every group until its status is "configured":
   - File storage (S3 or Bunny; local disk is not allowed), test it.
   - Platform email (SMTP or provider key), send the test e-mail; edit the platform email templates.
   - Google OAuth client (Calendar sync and Google sign-in); redirect URI `https://api.example.in/api/oauth/google/callback`.
   - WhatsApp platform app (app secret, verify token, Graph version); callback `https://api.example.in/api/hooks/whatsapp`.
   - Telephony platform account (Exotel), Error monitoring (Sentry DSN for API and web), Security policy, Branding.
   - Vistar billing profile (GSTIN, address, bank), Razorpay (key id, secret, webhook secret; webhook URL
     `https://api.example.in/api/hooks/razorpay`), Firebase (google-services.json and service account), Android release.
3. Super Admin > Config > Go-live: every check must pass (production mode, strong secrets, https URLs, storage not
   local, platform email configured and tested, Razorpay live, Firebase, Sentry, backups, no mock integrations, no
   demo companies, Super Admin 2FA, at least one Android release).

## 6. Company onboarding

Create the company in Super Admin > Companies (the admin gets an invite e-mail). The company admin follows
Settings > Setup: branding, GST and billing profile, business hours, team, roles, integrations (IndiaMART, WhatsApp
Cloud API, telephony, SMTP, Google Calendar), WhatsApp templates (submit to Meta), e-mail templates, lead routing,
capture forms, API keys and webhooks, office markers and the floor request, Android app on employee phones.

Provider URLs the company pastes into the provider consoles are shown in Integrations (WhatsApp callback URL and
verify token, IndiaMART push URL, telephony status callback URL).

## 7. Upgrades

```bash
cd /opt/vistar && git pull
export APP_VERSION=$(git rev-parse --short HEAD)
$C --profile backup run --rm backup now     # always back up before migrations
$C build api web && $C --profile tools build migrate
$C --profile tools run --rm migrate
$C up -d api web                            # the API drains (SIGTERM -> /api/ready 503 -> close) before it stops
```

Keep the previous image tags (`vistar-api:<old sha>`) until the new version has run for a day; rollback = set
`APP_VERSION` back and `$C up -d api web`. Migrations are forward-only: a rollback after a migration needs the
pre-upgrade backup (RUNBOOK, "Restore").

## 8. Scaling out

- `worker` profile: `API_HUB_BACKGROUND_JOBS=off` for the api service and `$C --profile worker up -d worker` moves the
  outbound webhook worker, its sweeper, the IndiaMART pull and the Google Calendar poll into their own container.
- More API instances need Redis (events, rate limits, leases are shared through it). Keep
  `(instances x DB_POOL_MAX) + 10 < POSTGRES_MAX_CONNECTIONS`.
- Socket.IO uses the Redis adapter, so any instance can serve any socket; Caddy's health check removes draining
  instances.

## 9. Android release

1. In `apps/mobile`: `flutter build apk --release` (Android Studio JDK 21: `JAVA_HOME=<Android Studio>/jbr`), signed
   with the release keystore (kept outside the repo).
2. Super Admin > Config > Android releases: upload the APK with version name, code, notes and minimum supported
   version. Employees get the update prompt; the go-live checklist needs at least one release.
3. Firebase (push): upload `google-services.json` and the service account JSON in Super Admin > Config > Firebase.

## 10. Environment reference

Bootstrap values (env only): `NODE_ENV`, `API_PORT`, `WEB_ORIGIN`, `API_PUBLIC_URL`, `DATABASE_URL`, `REDIS_URL`,
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `SUPER_JWT_SECRET`, `ENCRYPTION_KEY`,
`TRUST_PROXY`, `CUSTOM_DOMAIN_CNAME_TARGET`, `HUB_BACKGROUND_JOBS`.

Tuning (env, optional): `DB_POOL_MAX` (10), `DB_POOL_IDLE_MS` (30000), `DB_CONNECT_TIMEOUT_MS` (5000),
`SHUTDOWN_DRAIN_MS` (5000), `SHUTDOWN_TIMEOUT_MS` (25000), `LOG_LEVEL` (log), `LOG_FORMAT` (json in production),
`RATE_LIMIT_AUTH_PER_MIN` (20 per IP on sign-in routes), `RATE_LIMIT_PUBLIC_PER_MIN` (60 per IP on public routes,
x10 for files), `RATE_LIMIT_HOOKS_PER_MIN` (1200 per IP on webhooks), `RATE_LIMIT_USER_PER_MIN` (600 per signed-in
user), `BODY_LIMIT_JSON` (100kb), `APP_VERSION`.

Everything else (mail, storage credentials, Google, WhatsApp, telephony, Sentry, Razorpay, Firebase, security
policy, templates) lives in Super Admin > Config; the env variables of the same name are fallbacks only.

Web build arguments: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_MAP_TILE_URL`,
`NEXT_PUBLIC_MAP_TILE_ATTRIBUTION`, `WEB_CSP_EXTRA_CONNECT` (extra connect-src origins, space separated).

## 11. Security notes

- Headers: the API sends a no-script CSP, HSTS (production), no-referrer, X-Frame-Options DENY; the web sends CSP
  (frame-ancestors none except the embeddable capture forms `/f/*`), HSTS, referrer policy and permissions policy.
- Cookies: refresh cookies are httpOnly, SameSite=Lax, Secure in production, path-scoped.
- Limits: 100 KB JSON bodies (uploads have per-purpose limits), per-IP limits on sign-in, public, file and webhook
  routes, per-user limits on every authenticated route, per-key limits on API keys.
- Logs are JSON with request ids; e-mails, phone numbers, tokens, passwords, GSTIN and PAN are masked, IPs truncated.
- Secrets in the database are AES-256-GCM encrypted with ENCRYPTION_KEY and never returned by the API.
