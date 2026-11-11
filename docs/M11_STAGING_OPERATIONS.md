# M11 staging operations (2026-11-11)

How to watch and fix staging. Production operations are in PRODUCTION_OPERATIONS.md, which
this document doesn't repeat. **Staging doesn't exist yet**: thresholds are starting points to
adjust after the first weeks.

## What to watch (no paid services)

| Signal                  | Source                                                                                                   | Look for                     | Threshold (staging)                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| Application logs        | Render → Logs (JSON lines, `"env":"staging"`)                                                            | `"level":"error"`            | any new error type: look the same day                                             |
| HTTP 5xx                | `api.request` lines with `"status":5xx`                                                                  | rate                         | more than 5 in 15 min outside a deploy                                            |
| Database errors         | `api.request` 503s; `reportError` lines mentioning `PrismaClient`/`ECONNREFUSED`                         | connection refused, timeouts | any outside a Neon suspend                                                        |
| Health check failures   | Render → Events (health check failed)                                                                    | repeated failures            | 2 in a row while awake                                                            |
| Deploy failures         | GitHub email on a failed `deploy-staging.yml`; Render deploy events                                      | any                          | every one investigated                                                            |
| Backup failures         | GitHub email on a failed `backup.yml`                                                                    | any                          | every one investigated                                                            |
| Connection saturation   | Neon → Monitoring (1 day on Free): connections; errors `too many connections` / pool timeouts after 10 s | pool timeouts                | instances × `DATABASE_POOL_MAX` (1 × 3) well under Neon's limit; any pool timeout |
| Authentication failures | Audit log `user.login` (success only); limiter messages in the request log                               | spikes of 429 / "Too many"   | more than 20 limited logins per hour (expected only from the acceptance suite)    |
| Neon compute hours      | Neon → Usage                                                                                             | CU-hours used                | more than 80 of 100 before the 25th of the month                                  |
| Render free hours       | Render → Billing → usage                                                                                 | instance hours               | more than 600 of 750                                                              |

Redaction: logs never contain request bodies or user ids. Emails, bearer tokens, long secrets
and URL credentials are masked. Fields named like credentials are dropped
(`src/lib/monitoring/log.ts`, unit tests). Spot-check this after each deploy (acceptance manual
check 5).

Optional free alerting: an external HTTP monitor on `GET /api/health` (any free uptime
service). Note that it keeps staging awake and uses Neon hours. Paid monitoring needs owner
approval.

## Common incidents

| Symptom                                                             | Likely cause                                                                                                 | Response                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The first request takes about a minute                              | Free instance waking after 15 minutes idle                                                                   | Expected. Retry.                                                                                                                                      |
| `/api/health` 503 `migrations: pending`                             | A Render deploy ran without the workflow (manual deploy in the dashboard)                                    | Re-dispatch `deploy-staging.yml` for that SHA. It migrates first. Don't migrate by hand.                                                              |
| 503 `migrations: incomplete`                                        | A failed migration                                                                                           | ROLLBACK.md, "Failed migration". Partial changes are possible; the drill confirmed this. Undo them, run `migrate resolve --rolled-back`, fix forward. |
| 503 `databaseEnvironment: mismatch` or `unmarked`                   | `DATABASE_URL` on Render points at the wrong database                                                        | **Stop.** Check which database the URL points at. Fix the Render variable to the staging pooled URL. Never mark a database to make the error go away. |
| 503 `database: unavailable`                                         | Neon suspended (Free compute hours used up) or an outage                                                     | Neon → Usage. If over the hours, wait for the monthly reset or reduce wake time. Otherwise check status.neon.tech.                                    |
| The deploy workflow stops at "Database belongs to this environment" | The `DIRECT_DATABASE_URL` secret points at another or unknown database                                       | Fix the secret. If it pointed at production, rotate that database password (PRODUCTION_OPERATIONS.md) and review who saw it.                          |
| The deploy workflow times out waiting for readiness                 | Start-up exited (a fatal config: see the Render logs for `[config]`), a slow build, or Neon asleep           | Read the Render deploy log. The previous release keeps serving. Fix and re-dispatch.                                                                  |
| Login always says "Too many sign-in attempts"                       | The acceptance suite ran several times from one IP, or a wrong `TRUSTED_PROXY_HOPS` (all users share one IP) | Wait 15 minutes. If it affects everyone, check the audit-log IPs (M11_STAGING_CONFIGURATION.md).                                                      |
| Registration "invite code is not valid"                             | The invite expired or is used up                                                                             | Create a new 1-day invite (Admin → Invites).                                                                                                          |
| A free hours or Neon hours warning                                  | Usage                                                                                                        | Pause the external monitor; let staging sleep.                                                                                                        |

## Routine

| When                           | What                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Each staging deploy            | Read the workflow summary; run `npm run test:staging`; spot-check the logs                                           |
| Weekly while staging is in use | `backup.yml` (staging) once; check the usage pages                                                                   |
| Monthly                        | Delete stale synthetic accounts if they get in the way (Admin → Users), or recreate the staging database and re-seed |
| Before each production deploy  | The same SHA deployed to staging and passed the acceptance suite (deploy.yml enforces the first part)                |

## Resetting staging (synthetic data only)

To start over:

1. Delete the Neon branch or project.
2. Create a new one.
3. Update `DATABASE_URL` (Render) and `DIRECT_DATABASE_URL` (GitHub).
4. Dispatch `deploy-staging.yml`. It marks the new, empty database `staging`.
5. Re-seed.

Never do this to production.
