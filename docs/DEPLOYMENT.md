# Deployment

**Status (2026-11-11, M10): prepared, not deployed.** The configuration, workflows and
runbooks are in the repository and tested as far as possible without a real host. Nothing is
connected to Render, Neon or any other service, and no production credentials exist. Every
step marked **Owner** needs the owner's accounts, approval or money.

Related runbooks:

- DEPLOYMENT_ARCHITECTURE.md: the hosting choice and its costs
- ROLLBACK.md
- DATABASE_BACKUP.md
- PRODUCTION_OPERATIONS.md: monitoring, incidents, retention
- SECURITY.md

## Architecture

The recommendation is one Render web service (Docker, $7/month) with Neon Launch PostgreSQL in
the same region. Neon gives 7-day point-in-time recovery. The estimate is $14–28/month (see
DEPLOYMENT_ARCHITECTURE.md). The app is a plain Docker image and standard PostgreSQL, so any
container host with managed PostgreSQL and PITR works the same way.

```
GitHub (CI: verify + docker) ──► owner runs deploy.yml ──► approval (environment "production")
        │                                                   │
        │                                  encrypted pre-migration backup (artifact, 30 days)
        ▼                                                   ▼
   main branch ──────────────────────────────► Render deploy hook (auto-deploy off)
                                                            │ build image → pre-deploy: prisma migrate deploy (direct URL)
                                                            ▼
                                   new instance ready on /api/health → traffic switches
                                                            │
                                          deploy.yml waits for the new release → smoke test
```

## Environments

| Environment | Database                                                                                                                                     | Registration                                                  | Reset links                                                                       | Secrets                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Development | local `hanziquest` on :5433 (`npm run db:local`)                                                                                             | open (the default outside production)                         | on (the default outside production)                                               | `.env` (git-ignored), development values only                                   |
| Test        | `hanziquest_test`; integration tests refuse a database without "test" in its name. e2e uses the development database with two local servers. | e2e: one open server, one invite-only                         | on (the :3100 test server)                                                        | generated for each CI run                                                       |
| Production  | Neon, with 7-day PITR                                                                                                                        | **invite-only** (the default; keep `REGISTRATION_MODE` unset) | **off** (the default; keep `PASSWORD_RESET_LINKS` unset until the owner approves) | Render's environment settings and GitHub environment secrets only, never in git |

Never point development or test tools at the production database. The only exceptions are the
deliberate operations in DATABASE_BACKUP.md, which use the **direct** URL from a trusted
machine or the protected workflows.

## Environment variables

`.env.example` documents every variable. In production the server **exits** (status 1) when a
fatal item is wrong (`src/lib/env.ts`, run by `src/instrumentation-node.ts`), so a
misconfigured release never takes traffic.

| Variable                                   | Production                                        | Notes                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | required, **fatal**                               | `postgresql://`. Neon's **pooled** URL with `sslmode=require`.                                                                          |
| `MIGRATE_DATABASE_URL`                     | required with a pooled `DATABASE_URL`             | Neon's **direct** URL. Used only by the Prisma CLI (`prisma.config.ts`) for `migrate deploy` in the pre-deploy step.                    |
| `DATABASE_POOL_MAX`                        | optional (default 10), **fatal** if outside 1–100 | Connections per instance. Use 5 with a pooled URL.                                                                                      |
| `AUTH_SECRET`                              | required, **fatal**                               | At least 32 random characters (`openssl rand -base64 32`), unique to production. The Dockerfile's build placeholder is refused.         |
| `AUTH_URL`                                 | required, **fatal**                               | The public `https://` origin.                                                                                                           |
| `AUTH_TRUST_HOST`                          | `true`, **fatal** otherwise                       | Auth.js trusts the platform proxy's host header. Sign-in fails without it.                                                              |
| `TRUSTED_PROXY_HOPS`                       | `1` on Render, **fatal** if not 0–5               | Proxies that append to `X-Forwarded-For`. Rate limits key on the client IP. Check it after the first deploy (PRODUCTION_OPERATIONS.md). |
| `RATE_LIMIT_STORE`                         | leave unset                                       | PostgreSQL store, shared by every instance. `memory` gives a warning.                                                                   |
| `SENTRY_DSN`                               | optional                                          | Sentry or GlitchTip. Without it, errors are JSON lines on stdout (a warning).                                                           |
| `APP_RELEASE`                              | optional on Render                                | Falls back to `RENDER_GIT_COMMIT`. It is shown on `/api/health`; deploy.yml waits for it.                                               |
| `REGISTRATION_MODE`                        | **leave unset**                                   | Invite-only. `open` gives a warning and needs owner approval.                                                                           |
| `PASSWORD_RESET_LINKS`                     | **leave unset**                                   | Off. `on` gives a warning and needs the owner's approval of the procedure in SECURITY.md.                                               |
| `REGISTER_LIMIT_PER_HOUR`                  | leave unset                                       | Default 5 per IP per hour. Above 50 gives a warning.                                                                                    |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | first seed only                                   | Creates the first Super Admin. Remove them afterwards.                                                                                  |

GitHub environment `production` secrets, used by deploy.yml and backup.yml:

- `RENDER_DEPLOY_HOOK_URL`
- `PRODUCTION_URL`
- `PRODUCTION_DIRECT_DATABASE_URL`
- `BACKUP_AGE_RECIPIENT`: the public key only

## First deployment (Owner)

Each step that spends money or creates an account is marked **(paid)** or **(account)**.

1. **Accounts (account):** create Render (Hobby workspace) and Neon accounts. Read the current
   prices on their pages first (DEPLOYMENT_ARCHITECTURE.md).
2. **Database (paid, usage-based):**
   - Create a Neon project on the Launch plan, in the chosen region.
   - Set the history window to 7 days.
   - Copy the **pooled** and **direct** connection strings into a password manager.
3. **Backup key:**
   - On the owner's own machine, run `age-keygen -o hanziquest-backup.key`.
   - Store the key file offline, in the password manager **and** a second safe place.
   - The printed public key (`age1…`) is `BACKUP_AGE_RECIPIENT`.
4. **GitHub environment:**
   - In repository settings, create the `production` environment.
   - Add yourself as a required reviewer and turn off administrator bypass.
   - Then add its secrets. `PRODUCTION_URL` and `RENDER_DEPLOY_HOOK_URL` are added after step 5.
5. **App (paid, $7/month):**
   - In Render, choose New → Blueprint and select this repository. Render reads `render.yaml`
     and shows the plan and price before creating anything.
   - Check that the region matches Neon's, and that auto-deploy is **off**.
   - Enter the `sync: false` values when asked.
   - Copy the service's deploy hook URL into the GitHub secret.
   - The Blueprint's first build applies the migrations (pre-deploy) to the empty database.
6. **Seed (once)**, from a trusted machine with the repository at the deployed commit:
   ```bash
   DATABASE_URL="<direct URL>" SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run db:seed
   ```
   It is idempotent: roles, achievements, the starter curriculum and the first Super Admin.
   Then clear the two seed variables from your shell history.
7. **Verify:**
   - `npm run smoke -- https://<origin>`.
   - Work through the post-deploy checklist in PRODUCTION_OPERATIONS.md: secure cookies, the
     proxy IP and headers.
   - Sign in as the seeded admin and change the password.
8. **Backups:**
   - Run `backup.yml` manually once, download the artifact and decrypt it locally to prove the
     key works (DATABASE_BACKUP.md).
   - Run the first PITR restore drill to a Neon branch.
   - Then enable the weekly schedule.
9. **Monitoring:** add a free external uptime monitor on `GET /api/health`. Optionally create
   a Sentry project and set `SENTRY_DSN`.
10. **Invites:** only after the legal documents are approved (LEGAL_REVIEW.md), create invite
    codes in Admin → Invites.

## Regular release

1. The change is merged to `main` through a PR, and CI's `verify` and `docker` jobs are green
   for the merge commit.
2. If the release has a migration, check that it is additive (`db:check-migrations` passes in
   CI). A contract step needs its own DECISIONS entry and a fresh backup (see "Migration
   workflow").
3. **Owner:** Actions → **Deploy (manual)** → Run workflow, with the full SHA of `main`'s head
   and the phrase `deploy production`.
4. The preflight job checks the phrase, that the SHA is `main`'s head, and that `verify` and
   `docker` succeeded for it.
5. **Owner approves** the `production` environment job. It:
   - takes an encrypted pre-migration backup (artifact, 30 days)
   - triggers the Render deploy hook
   - waits up to 15 minutes for `/api/health` to report the new release with status `ok`
   - runs the read-only smoke test
6. Watch the logs and error reports for 15 minutes (PRODUCTION_OPERATIONS.md). If the service
   worker's caching rules changed, `VERSION` in `public/sw.js` must already be bumped in the
   release.

If any step fails, the previous release keeps serving. Render switches traffic only once the
new instance passes `/api/health`. Then follow ROLLBACK.md.

## Migration workflow

Schema changes follow **expand, then contract**. The running app never breaks during a deploy,
and a rollback never needs a schema rollback.

1. **Expand** (release N): add nullable columns, new tables and indexes. The pre-deploy step
   applies the migration before the new code takes traffic. The old code ignores new columns.
2. **Migrate data** if needed, with an idempotent script or a migration that only adds.
3. **Contract** (release N+1 or later, once nothing reads the old shape): drop or rename. This
   needs a `-- migration-safety: allow <rule> <reason>` line, a DECISIONS.md entry and a fresh
   backup taken just before.

Safety nets:

- `npm run db:check-migrations` (CI and deploy.yml) fails on DROP, TRUNCATE, DELETE, type
  changes, renames and SET NOT NULL unless explicitly allowed, and on any edit to a migration
  already on `main`.
- `prisma migrate deploy` only applies committed migrations; it never resets.
- Readiness (`/api/health`) returns 503 while any migration in the build is unapplied,
  unfinished or failed, so the new code never serves on an old schema.
- **Never** run `migrate reset`, `migrate dev` or `db push` against production.

Keep the foreign-key graph acyclic: the backup and restore tools depend on it.

## Health endpoints

| Endpoint               | Meaning                                                                                                                                                        | Used by                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /api/health/live` | The process is up. No database query.                                                                                                                          | Docker `HEALTHCHECK`                                                           |
| `GET /api/health`      | Readiness: the database answers, no migration is unfinished or failed, and every migration in this build is applied. Returns 503 otherwise. Reports `release`. | Render's health check (`render.yaml`), deploy.yml, uptime monitors, smoke test |

Neither reveals configuration, connection details or personal data. Render's health check on
readiness keeps Neon from scaling to zero; see DEPLOYMENT_ARCHITECTURE.md for the cost
trade-off.

## Container image

`Dockerfile`:

- Node 24, multi-stage, runs as a non-root user.
- Node is PID 1, so SIGTERM reaches Next.js and it shuts down cleanly.
- The HEALTHCHECK uses liveness.
- Migrations aren't run at container start; Render's pre-deploy step runs them.

Docker isn't installed on the development machine. The CI `docker` job builds the image and
runs a start-up test:

- migrate, start, liveness and readiness
- not running as root
- stopping on SIGTERM within 15 seconds
- refusing to start with a placeholder secret

Run the image locally where Docker is available:

```bash
docker build -t hanziquest .
docker run --rm --env-file .env.production hanziquest node node_modules/prisma/build/index.js migrate deploy
docker run -p 3000:3000 --env-file .env.production hanziquest
```

## PWA

- The manifest, service worker headers and offline pages are checked by the smoke test.
- `public/sw.js` registers in production builds only. It caches only the static offline pages
  and hashed build assets, never signed-in pages or `/api`.
- IndexedDB data is per account and is cleared or handed over on sign-out and account switch
  (OFFLINE.md, `offline-accounts.spec.ts`).
- HTTPS is required for installation and service workers. Render provides it.
