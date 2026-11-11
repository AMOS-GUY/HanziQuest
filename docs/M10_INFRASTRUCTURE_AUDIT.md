# M10 infrastructure audit (2026-11-11)

Phase A of M10. This audit was written **before** any M10 code change, on branch
`feature/m10-production-infrastructure` cut from `main` `9b83917` (Merge PR #15). It covers what
exists, what's missing and the plan. Nothing has been deployed, purchased or connected to a
real service.

## 1. Repository state (verified)

- `git fetch --prune`; `main` = `origin/main` = `9b83917`. The working tree was clean.
- Every milestone head is an ancestor of `main`:

  | Milestone | Head      |
  | --------- | --------- |
  | M1        | `52bd85e` |
  | M2        | `852666e` |
  | M3        | `0066a56` |
  | M4        | `3baef92` |
  | M5        | `009a056` |
  | M6        | `b2ee19c` |
  | M7        | `d53776c` |
  | M8        | `505bc57` |
  | M9        | `b53b11f` |
  | Audit     | `39188bf` |
  | PR #14    | `2b61811` |
  | PR #15    | `ff5d341` |

- Open PRs are Dependabot only (#7–#13). Several are major upgrades: TypeScript 7, ESLint 10,
  `@types/node` 26, `actions/*` v7. They are **not** merged here (see section 5).

## 2. Baseline (before any M10 change)

| Check                                     | Result                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Lint, typecheck                           | pass                                                                      |
| Unit tests                                | 151 / 151                                                                 |
| Integration tests                         | 92 / 92                                                                   |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities                                                         |
| `npm audit` (all)                         | 7 moderate, all dev-only: `minimatch` ReDoS through `typescript-eslint`   |
| Playwright Chromium                       | 36 passed, 18 skipped, 0 failed (the run on `ff5d341`, an identical tree) |
| GitHub Actions                            | **not observable from this machine** (private repo, no CLI or sign-in)    |
| Docker build                              | **not runnable here** (no Docker); CI's `docker` job builds it            |

## 3. What exists

| Area                   | State                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Next.js config         | Security headers (CSP with `'unsafe-inline'` scripts, D-046; HSTS; COOP/CORP; `frame-ancestors 'none'`); `poweredByHeader: false`; server action body limit 3 MB.                                                                                      |
| Prisma                 | 11 additive migrations. `db:check-migrations` blocks destructive statements and edits to applied migrations. The FK graph is acyclic.                                                                                                                  |
| AuthN/AuthZ            | Auth.js v5 credentials, JWT, 30-day sessions. Roles and status are read from the DB on every check. Sessions are revoked through `credentialsChangedAt`. `proxy.ts` gates `/admin`. Pages use `requirePagePermission`, actions use `assertPermission`. |
| CSRF                   | Server actions: Next's origin check. Route handlers: `handleApi` origin check. Auth.js: its own CSRF token. SameSite=Lax cookies.                                                                                                                      |
| Env validation         | `checkEnvironment()` at start-up (`instrumentation.ts`). Fatal in production for a missing DB URL or auth secret, a short secret, and a non-https `AUTH_URL`. Warnings for open registration, reset links on, and the memory rate-limit store.         |
| Rate limiting          | PostgreSQL store (`RateLimitBucket`), shared by every instance, with a fallback to memory. Client IP comes from `X-Forwarded-For` with `TRUSTED_PROXY_HOPS` (default 1).                                                                               |
| Health                 | `GET /api/health`: DB query, plus "no failed or unfinished migration", returning 503 if degraded.                                                                                                                                                      |
| Logging and monitoring | JSON lines (`logEvent`) with redaction. `reportError` sends to Sentry through the envelope API when `SENTRY_DSN` is set; query strings are stripped.                                                                                                   |
| Errors                 | `handleApi` maps domain errors; any other error becomes a generic 500. Error boundaries show a digest only.                                                                                                                                            |
| Backup and restore     | `db:backup` (a gzip NDJSON snapshot in one REPEATABLE READ transaction), `db:restore`, `db:verify` (row counts, checksums, FK orphans). CI runs the drill on every push.                                                                               |
| PWA                    | `sw.js` precaches only the static offline pages and hashed assets. Signed-in pages and `/api` are never cached. IndexedDB data is per account (`offline-accounts.spec.ts`).                                                                            |
| Docker                 | Multi-stage, Node 24, non-root user, HEALTHCHECK on `/api/health`. Migrations aren't run at start.                                                                                                                                                     |
| CI                     | One `verify` job covers: audit, migration check, lint, format, types, content, unit, integration, migrate and seed, the backup drill, build, Chromium e2e, advisory Firefox e2e and smoke. A `docker` job builds the image.                            |
| Docs                   | DEPLOYMENT.md, HOSTING.md (researched 2026-11-10), SECURITY.md, M9_PRODUCTION_READINESS.md, DATABASE.md.                                                                                                                                               |

## 4. Findings

| ID     | Severity | Finding                                                                                                                                                                                                                                                                                     | Plan                                                                                                                                                                                                        |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M10-01 | medium   | **Liveness and readiness are the same probe.** The Docker HEALTHCHECK (and any platform probe) uses `/api/health`, which queries the DB. A short database outage marks every container unhealthy, so orchestrators restart healthy processes. It also keeps a scale-to-zero database awake. | Add `GET /api/health/live` (process only). Keep `/api/health` as readiness. The Docker HEALTHCHECK uses live.                                                                                               |
| M10-02 | medium   | **Readiness doesn't detect pending migrations.** New code on an un-migrated schema reports `ok`. Only failed or unfinished migrations are caught.                                                                                                                                           | Compare the migrations shipped with the build (`prisma/migrations`) with `_prisma_migrations`, and report `pending` (503).                                                                                  |
| M10-03 | medium   | **`CMD ["npx", "next", "start"]`**: npx is PID 1 and may not forward SIGTERM, so a platform stop waits for its kill timeout instead of draining. This is unverified, since Docker can't run here.                                                                                           | Run Node directly: `node node_modules/next/dist/bin/next start`.                                                                                                                                            |
| M10-04 | low      | **The DB pool isn't configurable.** The `pg` defaults are `max` 10 and no connect timeout. On a 256 MB database (100 connections) or a pooled Neon URL, size and timeouts should be explicit.                                                                                               | `DATABASE_POOL_MAX`, plus connect and idle timeouts, validated at start-up.                                                                                                                                 |
| M10-05 | low      | **The env check misses mistakes that are easy to make:** a placeholder `AUTH_SECRET` (the Dockerfile's build-time value or `.env.example`'s), a non-PostgreSQL `DATABASE_URL`, a non-numeric `TRUSTED_PROXY_HOPS`, and production `APP_RELEASE` unset.                                      | Add these checks; unsafe values are fatal.                                                                                                                                                                  |
| M10-06 | medium   | **No deployment pipeline or platform configuration.** Deploys would be manual and undocumented in code. Render auto-deploys on push by default, which would bypass approval.                                                                                                                | `render.yaml` (auto-deploy off) and a `deploy.yml` workflow: manual dispatch only, a protected `production` environment, a pre-deploy backup, then a readiness wait and a smoke test. Nothing is connected. |
| M10-07 | medium   | **No backup automation outside the provider.** PITR is the only safety net, and a provider-level incident or account loss loses everything.                                                                                                                                                 | A `backup.yml` workflow (manual, with the weekly schedule disabled): an encrypted (`age`) logical backup kept as a 30-day artifact, verified on a disposable restore. It needs the owner's secrets.         |
| M10-08 | low      | **The CI docker job only builds.** Nothing proves the image starts, migrates and answers health checks.                                                                                                                                                                                     | Run the image against a Postgres service: migrate, start, then probe live and ready.                                                                                                                        |
| M10-09 | low      | **Operational documents are spread across DEPLOYMENT.md, HOSTING.md and M9 docs.** There is no single rollback, backup or operations runbook.                                                                                                                                               | ROLLBACK.md, DATABASE_BACKUP.md, PRODUCTION_OPERATIONS.md and DEPLOYMENT_ARCHITECTURE.md; refresh DEPLOYMENT.md.                                                                                            |
| M10-10 | info     | Dev-only moderate audit findings (`minimatch`). Major Dependabot upgrades are pending.                                                                                                                                                                                                      | Leave as is. Document a review procedure, with no blind merges.                                                                                                                                             |
| M10-11 | info     | Secure cookies rely on Auth.js choosing `__Secure-` cookies when `AUTH_URL` is https. That can't be observed locally over http.                                                                                                                                                             | Document it, and verify after the first deploy (PRODUCTION_OPERATIONS.md checklist).                                                                                                                        |

No high-severity issues were found. These were checked and are adequate:

- authorization on admin routes and pages
- origin checks on route handlers and actions
- log redaction and query-string stripping
- generic 500 responses
- service worker scope (no signed-in pages cached)
- offline account isolation
- invite-only default
- `PASSWORD_RESET_LINKS` off in production

## 5. Dependabot policy (M10-10)

Patch and minor updates: merge after green CI. Major updates (TypeScript 7, ESLint 10,
`@types/node` 26, `actions/*` v7): one PR at a time, with the changelog read, CI green,
local e2e run, and owner approval. `@types/node` should track the runtime (Node 24), not the
newest major. None is merged in M10.

## 6. Proposed architecture

See DEPLOYMENT_ARCHITECTURE.md. In short: **one Render web service (Docker, $7/mo) + Neon
Launch PostgreSQL (7-day PITR, pay-as-you-go)**, with GitHub Actions for verification, an
owner-approved deploy, and encrypted off-site logical backups. Estimated **$15–28/month**.

## 7. Implementation plan

1. Health: liveness endpoint, pending-migration readiness, Docker probe (M10-01, 02).
2. Runtime: Node as PID 1, pool configuration, stricter env check (M10-03 to 05).
3. Platform: `render.yaml` with auto-deploy off; `deploy.yml` and `backup.yml` behind the
   protected `production` environment (M10-06, 07).
4. CI: container start test in the docker job (M10-08).
5. Backup and restore drill on a disposable local database.
6. Docs: architecture, deployment, rollback, backup and operations (M10-09).
7. Full test run, PR.
