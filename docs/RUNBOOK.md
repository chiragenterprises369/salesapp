# Vistar runbook (change #20)

Commands assume `cd /opt/vistar` and
`C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production"`. Deployment and first boot
are in `docs/DEPLOY.md`.

## 1. Health at a glance

| Check | Command | Healthy |
| --- | --- | --- |
| Containers | `$C ps` | all `running (healthy)` |
| API liveness | `curl -fsS https://api.example.in/api/health` | `{"ok":true,"db":true,"redis":true,...}` |
| API readiness | `curl -fsS https://api.example.in/api/ready` | 200 with `db`, `redis`, `storage` true, `draining` false |
| Web | `curl -fsS https://app.example.in/healthz` | `ok` |
| Certificates | `$C logs caddy --since 1h \| grep -i -E "error\|certificate"` | no errors |
| Backups | `$C --profile backup run --rm backup list` | a file from the last 24 h |
| Disk | `df -h /var/lib/docker` | below 80 % |

`/api/ready` 503 means: `db` false (Postgres down or pool exhausted), `redis` false (Redis down; events, rate limits
and jobs stop), `storage` false (bucket credentials or network), `draining` true (the instance is shutting down).

## 2. Restart and deploy

```bash
$C restart api            # graceful: drains 5 s, closes HTTP, sockets, queues, then exits
$C restart web
$C up -d --force-recreate api web    # after env changes
$C logs -f api            # follow
```

Rollback to the previous image: `export APP_VERSION=<previous sha>; $C up -d api web` (only when no migration ran
since; otherwise restore the pre-upgrade backup, section 4).

## 3. Logs

- API lines are JSON: `time`, `level`, `context`, `msg`, `requestId`, `userId`, `workspaceId`, and `http` (method,
  path, status, durationMs, truncated ip) on access lines. Every API response carries `x-request-id`; users can
  read it from error toasts.
- Find one request: `$C logs api --since 24h | grep '"requestId":"<id>"'`
- Errors only: `$C logs api --since 1h | grep -E '"level":"(error|fatal)"'`
- Slow requests: `$C logs api --since 1h | jq -c 'select(.http.durationMs > 2000)'` (needs jq on the host).
- Postgres slow queries (over 1 s) are in `$C logs postgres`.
- Docker keeps 5 x 20 MB per container (json-file rotation). Errors also go to Sentry when configured.

## 4. Backups and restore

- Schedule: daily at `BACKUP_TIME` (02:30 IST) or every `BACKUP_EVERY_HOURS`; custom-format `pg_dump`, encrypted
  when `BACKUP_ENCRYPTION_PASSPHRASE` is set, sha256 next to it, uploaded to `BACKUP_TARGET` (s3 or bunny).
  Retention: `BACKUP_KEEP_LOCAL_DAYS` (7) on the server, `BACKUP_KEEP_REMOTE_DAYS` (30) remotely.
- Run now: `$C --profile backup run --rm backup now`
- List local: `$C --profile backup run --rm backup list`
- Copy one off the server: `docker cp $( $C --profile backup ps -q backup ):/backups/<file> .`

Restore drill (monthly; does not touch the live database):

```bash
$C --profile backup run --rm backup restore vistar-20261103T210000Z.dump.enc     # -> database vistar_restore
docker compose ... exec postgres psql -U vistar -d vistar_restore -c 'select count(*) from "Workspace";'
docker compose ... exec postgres psql -U vistar -d postgres -c 'drop database vistar_restore;'
```

Full restore (data loss incident):

1. Announce maintenance; `$C stop caddy web api worker`.
2. `$C --profile backup run --rm backup restore <file> --target-db vistar --yes` (drops and recreates `vistar`).
3. `$C --profile tools run --rm migrate` (applies migrations newer than the backup).
4. `$C up -d`; check `/api/ready`, sign in, open a company, check the newest leads.
5. Files in object storage are not part of the dump; they stay where they are. Rows that point to files uploaded
   after the backup time show as missing files.

`ENCRYPTION_KEY` must be the one the backup was made with, or every stored secret (integrations, panel config)
has to be entered again.

## 5. Rotating secrets

| Secret | Effect of rotation | Steps |
| --- | --- | --- |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | every company user is signed out | new values in the env file, `$C up -d --force-recreate api worker` |
| `SUPER_JWT_SECRET` | Super Admins are signed out | same |
| `POSTGRES_PASSWORD` | none if done in order | `$C exec postgres psql -U vistar -c "ALTER USER vistar PASSWORD '<new>'"`, update the env file, recreate api, worker, backup |
| `REDIS_PASSWORD` | short reconnect | update the env file, `$C up -d --force-recreate redis api worker` |
| `ENCRYPTION_KEY` | stored secrets become unreadable | rotate only after a leak: set the new key, then re-enter every secret in Super Admin > Config and each company's Integrations (old backups need the old key) |
| `BACKUP_ENCRYPTION_PASSPHRASE` | new backups use the new passphrase | keep the old one until its backups expire |
| Provider tokens (WhatsApp, Exotel, SMTP, Razorpay, Google) | provider calls fail until replaced | Super Admin > Config or company Integrations: paste the new value (write-only, audited) |
| Webhook secrets, API keys | callers must update | Webhooks > Rotate secret (grace up to 72 h), API keys > Rotate (grace up to 24 h) |
| Super Admin password or 2FA | | Super Admin profile; a lost 2FA device needs another Super Admin to reset it |

## 6. Incidents

1. Triage: what is broken (all companies or one), since when, error rate (`$C logs api --since 15m | grep -c '"level":"error"'`),
   Sentry, `/api/ready`.
2. Severity: S1 = nobody can sign in or data at risk; S2 = a module or provider down; S3 = one company or cosmetic.
3. Communicate: status note to company admins (e-mail from the platform mailer), every 30 minutes for S1.
4. Fix or roll back (section 2); keep notes with times.
5. Afterwards: short write-up (cause, impact, fix, follow-ups) within two working days.

Common cases:

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `/api/ready` db false | Postgres down, disk full, pool exhausted | `$C logs postgres`, `df -h`; free disk; lower DB_POOL_MAX or raise POSTGRES_MAX_CONNECTIONS |
| `/api/ready` redis false | Redis down or out of memory (noeviction) | `$C logs redis`; raise REDIS_MAXMEMORY; check queue backlog |
| 429 for many users | an office behind one IP hitting the sign-in limit, or abuse | check the IPs in the access logs; raise RATE_LIMIT_AUTH_PER_MIN or block the IP in Caddy |
| Certificates failing | DNS not pointing here, CA rate limit, ask endpoint 404 | `$C logs caddy`; custom domains must be verified in Vistar first |
| Webhooks piling up | a receiver is down | Webhooks and logs: endpoints switch off after 3 dead deliveries; replay after the fix |
| WhatsApp messages failed | token expired (integration in error) | company pastes a new system user token; resend from the inbox |
| Google Calendar not syncing | access revoked (needs attention) | company admin connects Google again; pending pushes retry in 5 minutes |
| Emails not sent | platform or company SMTP failing | Super Admin > Config > Platform email > Test; company Integrations > SMTP > Test |

Security incident (suspected breach, leaked secret, unauthorised access):

1. Contain: rotate the affected secret (section 5), revoke sessions (rotate JWT secrets), disable the affected API
   keys or webhooks, block IPs in Caddy.
2. Preserve evidence: copy the logs (`$C logs --since 72h > incident-<date>.log`) and the audit log (Super Admin >
   Audit) before restarts.
3. Report: CERT-In requires reporting cyber security incidents within 6 hours of noticing them
   (incident@cert-in.org.in). Personal data breaches go to the Data Protection Board and the affected companies
   under the DPDP Act and Rules. Tell affected company admins what happened and what they should do.
4. Review the audit logs of Super Admin impersonation sessions and integration changes for the period.

## 7. Routine maintenance

- Weekly: `$C ps`, disk, backup list, Sentry issues, Go-live checklist still green.
- Monthly: restore drill (section 4), OS updates (`apt upgrade`, reboot in a quiet hour; containers restart on
  their own), `docker image prune -f` (keep the last two app versions), review Super Admin accounts and API keys.
- Postgres autovacuum is on; after large imports run `$C exec postgres psql -U vistar -d vistar -c 'VACUUM ANALYZE;'`.
