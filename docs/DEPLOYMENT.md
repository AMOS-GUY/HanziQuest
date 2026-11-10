# Deployment

**Status (2026-11-10): ready to deploy, not deployed.** Everything that needs no external
account is done and tested locally: production build, migrations, environment check, health
endpoint, smoke test, error reporting, Dockerfile and CI. Choosing a host, creating accounts,
buying a domain and entering production secrets are owner actions. Nothing has been purchased,
registered or deployed.

## Recommended low-cost setup

Any Node.js 20.19+ host that runs `next start` behind HTTPS works. Two paths fit a small beta:

| Option                         | App                                                                                                    | Database                                                                                | Notes                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Container host** (simple) | Render, Railway, Fly.io or similar, smallest always-on instance, using the `Dockerfile` or `npm start` | Managed PostgreSQL 15+ (Neon, Supabase, the host's own) with **point-in-time recovery** | One long-running process; easy to reason about. Recommended.                                                                                                            |
| **B. Vercel**                  | Vercel project (Pro plan for commercial use; Hobby is for non-commercial projects)                     | Neon or Supabase, using the **pooled** connection string                                | The admin gate (`proxy.ts`) uses Prisma, so it must run on the Node.js runtime, which is the Next 16 default for `proxy.ts`. Serverless functions need a pooled DB URL. |

Check the current prices and terms of the chosen providers before signing up. The app needs no
other paid services: email is not used yet, and error reporting works with Sentry's free tier,
a self-hosted GlitchTip, or with no reporting service at all (JSON logs only).

## Environment variables

`.env.example` documents every variable. The app refuses to start in production when a fatal
item is wrong (`src/lib/env.ts`, checked from `src/instrumentation.ts`).

| Variable                                   | Required | Notes                                                                                                                      |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | yes      | Pooled connection string for the app. For migrations, use the direct (non-pooled) URL if the provider has one.             |
| `AUTH_SECRET`                              | yes      | 32+ random characters (`npx auth secret`). Unique per environment; never the development value.                            |
| `AUTH_URL`                                 | yes      | Public `https://` origin.                                                                                                  |
| `AUTH_TRUST_HOST`                          | yes      | `true` behind the platform's proxy.                                                                                        |
| `TRUSTED_PROXY_HOPS`                       | yes      | Number of proxies that append to `X-Forwarded-For`; usually `1`. Don't expose the app without a proxy (see SECURITY.md).   |
| `RATE_LIMIT_STORE`                         | no       | Defaults to `postgres` in production (shared across instances).                                                            |
| `SENTRY_DSN`                               | no       | Sentry or GlitchTip DSN. Without it, errors are JSON lines on stdout.                                                      |
| `APP_RELEASE` / `APP_ENV`                  | no       | Commit SHA and environment label for health checks and error reports.                                                      |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | once     | Only for the first seed, to create the first Super Admin. Remove them afterwards and change the password at first sign-in. |
| `REGISTER_LIMIT_PER_HOUR`                  | no       | Leave unset in production (default 5 per IP per hour).                                                                     |

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

## Regular release

1. CI must be green: lint, format, types, unit, integration, e2e, smoke and Docker build.
2. **Take a manual database snapshot** (provider console) if the release contains a migration.
3. Apply migrations: `npm run db:deploy` (direct URL). Migrations are additive. Never use
   `migrate reset` or `db push` on shared databases.
4. Deploy the app with `APP_RELEASE=<commit SHA>`.
5. Run `npm run smoke -- <url>` and check the error dashboard or logs for 15 minutes.
6. If the service-worker caching rules changed, bump `VERSION` in `public/sw.js` in the same
   release.

## Rollback

- **App:** redeploy the previous image or deployment. Every migration so far only adds tables
  and columns, so the previous app version keeps working on the newer schema.
- **Schema:** write a forward-fixing migration. Never edit or delete an applied migration.
- **Data:** restore with point-in-time recovery to a **new** database (just before the bad
  change), check it with the smoke test, then switch `DATABASE_URL`. Learners' offline queues
  re-sync safely, because event ids make uploads idempotent.
- **Service worker:** a release with a bumped `VERSION` replaces old caches. In an emergency,
  ship a `sw.js` that calls `self.registration.unregister()`.

## Backups and recovery

| What                        | How                                                                              | Frequency                 |
| --------------------------- | -------------------------------------------------------------------------------- | ------------------------- |
| Database (primary)          | Provider-managed point-in-time recovery, retention ≥ 7 days                      | continuous                |
| Database (independent copy) | `pg_dump --format=custom --no-owner "$DIRECT_URL" > hanziquest-$(date +%F).dump` | weekly, kept off-provider |
| Curriculum source           | `content/*.json` in git (imports are idempotent)                                 | every change              |
| Configuration               | Environment variables recorded in the team password manager                      | on change                 |

**Recovery drill (do it before public launch, then every quarter):**

1. Restore the latest backup into a new scratch database:
   `pg_restore --no-owner --dbname "$SCRATCH_URL" hanziquest-YYYY-MM-DD.dump`, or use the
   provider's "restore to new branch/database".
2. Run `DATABASE_URL=$SCRATCH_URL npx prisma migrate status`. It should say "up to date".
3. Start the app against it (`AUTH_URL=http://localhost:3000 npm start`) and run
   `npm run smoke -- http://localhost:3000`.
4. Record the date, backup age and time to restore in `docs/PROGRESS.md`.

Not yet done: the drill needs a real provider backup. The development machine has no
`pg_dump`, so it couldn't be rehearsed locally beyond the smoke test, which passes against a
local production build.

## Monitoring

- **Errors:** `src/lib/monitoring/report.ts` writes every unhandled server error (pages, server
  actions, route handlers, through `onRequestError`) and every crash caught by an error
  boundary (via `/api/client-errors`, rate limited) as one JSON line. With `SENTRY_DSN` set it
  also sends them to Sentry or GlitchTip. Messages and stack traces have secrets redacted; no
  user identifiers are attached.
- **Health:** `GET /api/health` returns `{status, database, release, latencyMs}` and 503 when
  the database is unreachable. The Dockerfile has a `HEALTHCHECK` on it.
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
