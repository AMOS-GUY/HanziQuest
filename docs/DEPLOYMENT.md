# Deployment

**Status (2026-11-10): ready to deploy, not deployed.** Everything that needs no external
account is done and tested locally: production build, migrations, environment check, health
endpoint, smoke test, error reporting, Dockerfile and CI. Choosing a host, creating accounts,
buying a domain and entering production secrets are owner actions. Nothing has been purchased,
registered or deployed.

## Hosting choice

The researched comparison with pricing, limits and sources is in `docs/HOSTING.md`. The
recommendation is a Render web service (Starter) with Neon Launch for PostgreSQL (7-day PITR),
estimated at roughly $10–30/month. Verify prices before signing up.

## Recommended low-cost setup

Any Node.js 20.19+ host that runs `next start` behind HTTPS works. Two paths fit a small beta:

| Option                         | App                                                                                                    | Database                                                                                | Notes                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Container host** (simple) | Render, Railway, Fly.io or similar, smallest always-on instance, using the `Dockerfile` or `npm start` | Managed PostgreSQL 15+ (Neon, Supabase, the host's own) with **point-in-time recovery** | One long-running process; easy to reason about. Recommended.                                                                                                            |
| **B. Vercel**                  | Vercel project (Pro plan for commercial use; Hobby is for non-commercial projects)                     | Neon or Supabase, using the **pooled** connection string                                | The admin gate (`proxy.ts`) uses Prisma, so it must run on the Node.js runtime, which is the Next 16 default for `proxy.ts`. Serverless functions need a pooled DB URL. |

Check the current prices and terms of the chosen providers before signing up. The app needs no
other paid services: email is not used yet, and error reporting works with Sentry's free tier,
a self-hosted GlitchTip, or with no reporting service at all (JSON logs only).

## Environments

| Environment | Database                                                                                                                                  | Registration                                | Secrets                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Development | local `hanziquest` on :5433 (`npm run db:local`)                                                                                          | open (the default outside production)       | `.env` (git-ignored), development values only |
| Tests       | `hanziquest_test` (integration tests refuse a database whose name lacks "test"); e2e uses the development database with two local servers | e2e: one open server, one invite-only       | generated for each CI run                     |
| Production  | managed PostgreSQL with point-in-time recovery                                                                                            | **invite-only** (the default in production) | the host's secret store only; never in git    |

Never point development or test tools at the production database. The exceptions are
`db:deploy`, `db:backup` and `db:verify`, run deliberately from a trusted machine. `.env` is
git-ignored, and CI generates its `AUTH_SECRET` for each run.

## Environment variables

`.env.example` documents every variable. The app refuses to start in production when a fatal
item is wrong (`src/lib/env.ts`, checked from `src/instrumentation.ts`).

| Variable                                   | Required | Notes                                                                                                                                                                                                                                     |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | yes      | Pooled connection string for the app. For migrations, use the direct (non-pooled) URL if the provider has one.                                                                                                                            |
| `AUTH_SECRET`                              | yes      | 32+ random characters (`npx auth secret`). Unique per environment; never the development value.                                                                                                                                           |
| `AUTH_URL`                                 | yes      | Public `https://` origin.                                                                                                                                                                                                                 |
| `AUTH_TRUST_HOST`                          | yes      | `true` behind the platform's proxy.                                                                                                                                                                                                       |
| `TRUSTED_PROXY_HOPS`                       | yes      | Number of proxies that append to `X-Forwarded-For`; usually `1`. Don't expose the app without a proxy (see SECURITY.md).                                                                                                                  |
| `RATE_LIMIT_STORE`                         | no       | Defaults to `postgres` in production (shared across instances).                                                                                                                                                                           |
| `SENTRY_DSN`                               | no       | Sentry or GlitchTip DSN. Without it, errors are JSON lines on stdout.                                                                                                                                                                     |
| `APP_RELEASE` / `APP_ENV`                  | no       | Commit SHA and environment label for health checks and error reports.                                                                                                                                                                     |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | once     | Only for the first seed, to create the first Super Admin. Remove them afterwards and change the password at first sign-in.                                                                                                                |
| `REGISTER_LIMIT_PER_HOUR`                  | no       | Leave unset in production (default 5 per IP per hour).                                                                                                                                                                                    |
| `PASSWORD_RESET_LINKS`                     | no       | Staff-issued password reset links (D-045, D-047). Off by default in production; set `on` only after the owner approves the reset procedure in SECURITY.md. `off` disables them anywhere. The start-up check warns when it is `on`.        |
| `REGISTRATION_MODE`                        | no       | `invite` (the default in production): sign-up needs a code from Admin → Invites. `open`: anyone can register. Keep `invite` until the owner approves the legal and operational prerequisites. The start-up check warns when it is `open`. |

## First deployment

1. Create the PostgreSQL database and enable automated backups with point-in-time recovery.
2. Set the environment variables on the host.
3. From a trusted machine with the repository checked out and `DATABASE_URL` pointing at the
   **direct** production URL:
   ```bash
   npm ci
   npm run db:deploy      # applies committed migrations only
   npm run db:seed        # idempotent: roles, achievements, starter curriculum, first admin
   ```
4. Deploy the app (push to the host or build the image).
5. Run the smoke test against the public URL:
   ```bash
   npm run smoke -- https://your-domain.example
   ```
6. Sign in as the seeded admin, change the password (Profile → Change password), and assign
   staff roles under Admin → Users.
7. Add an uptime monitor (any free HTTP monitor) on `GET /api/health`, alerting on non-200.
8. Create invite codes for the first testers in Admin → Invites (the beta is invite-only).
   Admin → Operations shows configuration warnings, migrations, and the sync and feedback
   backlogs.

## Migration workflow

Schema changes follow **expand, then contract**. The running app version never breaks during a
deploy, and a rollback never needs a schema rollback.

1. **Expand** (release N): add nullable columns, new tables and indexes. Deploy the migration
   **before** the app that uses it. Old code ignores new columns.
2. **Migrate data** if needed, with an idempotent script or a migration that only adds.
3. **Contract** (release N+1 or later, once nothing reads the old shape): drop or rename. This
   needs a `-- migration-safety: allow <rule> <reason>` line in the migration, a DECISIONS.md
   entry and a fresh backup.

`npm run db:check-migrations` runs in CI against the PR's base branch. It fails on DROP
TABLE/COLUMN, TRUNCATE, DELETE, type changes, renames and SET NOT NULL unless they are
explicitly allowed. It also fails on any edit to a migration already on the base branch.
`prisma migrate deploy` only applies committed migrations; it never resets.

Keep the foreign-key graph acyclic. The backup and restore tools depend on it; this is why
`BetaInvite.createdById` is not a foreign key.

## Regular release

1. CI must be green: dependency audit, migration safety, lint, format, types, unit,
   integration, e2e, smoke and Docker build.
2. **Take a manual database snapshot** (provider console) if the release contains a migration.
3. Apply migrations: `npm run db:deploy` (direct URL). Migrations are additive. Never use
   `migrate reset` or `db push` on shared databases.
4. Deploy the app with `APP_RELEASE=<commit SHA>`.
5. Run `npm run smoke -- <url>` and check the error dashboard or logs for 15 minutes.
6. If the service-worker caching rules changed, bump `VERSION` in `public/sw.js` in the same
   release.

## Rollback

- **App:** redeploy the previous image or deployment. Every migration so far only adds tables
  and columns (expand, then contract, enforced by `db:check-migrations`), so the previous app
  version keeps working on the newer schema.
- **Health after a rollback:** `/api/health` must report `"migrations": "ok"`. If a migration
  failed part-way, it reports `incomplete` and returns 503. Check the database state, run
  `npx prisma migrate resolve --rolled-back <name>`, then redeploy. Never edit the migration.
- **Schema:** write a forward-fixing migration. Never edit or delete an applied migration.
- **Data:** restore with point-in-time recovery to a **new** database (just before the bad
  change), check it with the smoke test, then switch `DATABASE_URL`. Learners' offline queues
  re-sync safely, because event ids make uploads idempotent.
- **Service worker:** a release with a bumped `VERSION` replaces old caches. In an emergency,
  ship a `sw.js` that calls `self.registration.unregister()`.

## Backups and recovery

| What                        | How                                                                                                                 | Frequency                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Database (primary)          | Provider-managed point-in-time recovery, retention ≥ 7 days                                                         | continuous                           |
| Database (independent copy) | `npm run db:backup -- --source "$DIRECT_URL" --out hanziquest-$(date +%F).ndjson.gz` (or `pg_dump --format=custom`) | weekly, encrypted, kept off-provider |
| Curriculum source           | `content/*.json` in git (imports are idempotent)                                                                    | every change                         |
| Configuration               | Environment variables recorded in the team password manager                                                         | on change                            |

**Recovery drill (do it before public launch, then every quarter):**

1. Restore the latest backup into a new scratch database:
   `pg_restore --no-owner --dbname "$SCRATCH_URL" hanziquest-YYYY-MM-DD.dump`, or use the
   provider's "restore to new branch/database".
2. Run `DATABASE_URL=$SCRATCH_URL npx prisma migrate status`. It should say "up to date".
3. Start the app against it (`AUTH_URL=http://localhost:3000 npm start`) and run
   `npm run smoke -- http://localhost:3000`.
4. Record the date, backup age and time to restore in `docs/PROGRESS.md`.

With the portable tools the drill is:

```bash
npm run db:backup -- --source "$PROD_DIRECT_URL" --out backup.ndjson.gz
DATABASE_URL="$SCRATCH_URL" npx prisma migrate deploy     # same release as production
npm run db:restore -- --in backup.ndjson.gz --target "$SCRATCH_URL"
npm run db:verify -- --source "$PROD_DIRECT_URL" --target "$SCRATCH_URL"
DATABASE_URL="$SCRATCH_URL" AUTH_URL=http://localhost:3300 npx next start -p 3300 &
npm run smoke -- http://localhost:3300
```

**Local drill repeated (2026-11-11, M9, development database):** after the `beta_invites`
migrations, a 928 KB gzip backup was restored into a fresh migrated database. Every table
matched, 69 foreign keys were checked with 0 orphaned rows, and the app-level reads for 5
learners matched.

**Local drill (2026-11-10, development database):** backup of every table (38 contain data, about 3,500 rows)
(389 KB gzip), into a new migrated database. Restore took 2.6 s. Verify: every table identical
by row count and content checksum, 68 foreign keys checked with 0 orphaned rows, and progress
summaries and lesson states identical for 5 learners. Smoke test 8/8 against the production
build running on the restored database. A second restore into the non-empty database was
refused. The drill found and fixed a hang in the restore tool. **The production drill is still
pending: there is no production database yet.** CI runs the same drill on every push.

## Monitoring

- **Errors:** `src/lib/monitoring/report.ts` writes every unhandled server error (pages, server
  actions, route handlers, through `onRequestError`) and every crash caught by an error
  boundary (via `/api/client-errors`, rate limited) as one JSON line. With `SENTRY_DSN` set it
  also sends them to Sentry or GlitchTip. Messages and stack traces have secrets redacted; no
  user identifiers are attached.
- **Health:** `GET /api/health` returns `{status, database, migrations, release, latencyMs}`.
  It returns 503 when the database is unreachable or a migration is unfinished or failed. The
  Dockerfile has a `HEALTHCHECK` on it.
- **Request logs:** route handlers write one JSON line per request (`api.request`: method,
  path without the query, status and ms). There are no bodies and no user identifiers; emails
  and tokens are masked (`src/lib/monitoring/log.ts`).
- **Admin → Operations** (needs `analytics:read`):
  - database latency, migration state and configuration warnings (names only)
  - registration mode and active invites
  - stuck and rejected offline syncs, with the most common rejection reasons
  - the untriaged feedback backlog
  - pilot sample counts and the age of the audit log

## Retention

`npm run ops:prune -- --audit-days <n> --sync-days <n>` is a dry run that shows what would be
deleted. Add `--apply` to delete:

- audit entries older than `n` days (they hold IP addresses and user agents)
- processed offline sync events older than `n` days (their attempts are kept)
- expired rate-limit buckets

The owner decides the periods (LEGAL_REVIEW.md). The minimums are 30 days for audit entries and
7 for sync events, and an applied prune is itself audited. Once the periods are decided,
schedule it with the host's cron.

- **Product signals:** Admin → Overview shows 7-day aggregate counts (active learners,
  attempts, pass rate, lesson completions, rejected offline events).

## PWA checklist (verified locally on a production build)

- The manifest has a name, `start_url`, `display: standalone`, theme colours, and 192 and 512 px
  icons that are reachable (smoke test).
- `public/sw.js` is served with `Cache-Control: no-cache` (smoke test). It registers in
  production builds only.
- Offline: download a lesson, go offline, practise, and the result syncs on reconnect
  (Playwright `offline-progress.spec.ts`). Account isolation across sign-out and switching
  (`offline-accounts.spec.ts`).
- HTTPS is required for installation and service workers in production. The host provides it.

## Container image

`Dockerfile` builds a Node 24 image that runs as a non-root user and has a health check. It
hasn't been built on the development machine (Docker isn't installed there); the CI `docker`
job builds it on every push. Migrations are a separate release step:

```bash
docker run --rm --env-file .env.production hanziquest npx prisma migrate deploy
```
