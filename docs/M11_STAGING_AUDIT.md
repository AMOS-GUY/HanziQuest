# M11 staging audit (2026-11-11)

Phase A of M11. This was written before any M11 change, on `feature/m11-staging-deployment`,
cut from `main` `0ec42f6` (Merge PR #16, M10). **No external resource was created, and nothing
was deployed.** Provider facts come from official Render and Neon pages read on 2026-11-11.

## 1. Repository and M10 integration (verified)

- The working tree was clean. After `git fetch --prune`, `main` = `origin/main` = `0ec42f6`.
- The M10 head `a560cbe` is an ancestor of `main`, and `main`'s tree is identical to it.
  Earlier milestone heads (PRs #1–#15) were verified in M10.
- Open PRs: Dependabot only (#7–#13; the three `actions/*` v7 PRs were force-updated today).
  None is mixed into M11.
- Every `npm run` command and file path that the deployment docs, workflows, `render.yaml` and
  `CLAUDE.md` reference exists. This was checked with a script, not by reading. The CLI paths
  used in the image (`node_modules/next/dist/bin/next`, `node_modules/prisma/build/index.js`)
  exist.
- **GitHub Actions results are still not observable**: private repository, no CLI, and the
  browser pane isn't signed in to GitHub. So the M10 `docker` start-up test and the CI drill
  **have never been seen to pass**. The local checks are the only evidence.

## 2. What exists (from M10)

| Capability     | State                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Health         | `/api/health/live` (no DB) and `/api/health` (readiness: DB, unfinished or failed migrations, pending migrations).                                                                                                                     |
| Start-up check | Exits with status 1 on a fatal production configuration (D-049).                                                                                                                                                                       |
| Image          | Node as PID 1, non-root, liveness HEALTHCHECK.                                                                                                                                                                                         |
| Deploy         | `deploy.yml`: manual, production only. Preflight requires the head of `main` with `verify` and `docker` green, then the protected `production` environment, an encrypted backup, the Render hook, a readiness wait and the smoke test. |
| Backups        | `backup.yml` (manual, production only), `db:backup` with checksums, `db:restore` (one transaction, row-count check), `db:verify --source` and `--backup`.                                                                              |
| Platform       | `render.yaml`: one production service, auto-deploy off, migrations in `preDeployCommand`.                                                                                                                                              |
| Docs           | DEPLOYMENT, ROLLBACK, DATABASE_BACKUP, PRODUCTION_OPERATIONS, DEPLOYMENT_ARCHITECTURE.                                                                                                                                                 |

## 3. Findings

| ID   | Severity       | Finding                                                                                                                                                                                                                                                                  | Plan                                                                                                                                                                                                                                                                                                                 |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 | high (staging) | **There is no staging path.** `deploy.yml` and `backup.yml` hard-code the `production` environment and `PRODUCTION_*` secret names, and `render.yaml` defines only the production service. Staging would need copy-and-paste workflows, which invites mixing up secrets. | A reusable deploy workflow with an `environment` input; thin `deploy-staging.yml` and `deploy.yml` callers; generic secret names scoped to each GitHub environment; `render.staging.yaml`.                                                                                                                           |
| S-02 | high           | **Nothing stops staging from using the production database, or production from using staging's.** A pasted wrong URL would silently connect. A production backup restored into staging would put real learner data in staging.                                           | A database environment marker (`DeploymentMarker` row). Readiness returns 503 when it doesn't match `APP_ENV`. The deploy workflow checks it **before** any backup or migration, and marks a new, empty database only. A restored production backup carries the `production` marker, so staging refuses to serve it. |
| S-03 | medium         | **The environment isn't identified.** `APP_ENV` only labels Sentry events. There is no UI marker and no `env` in the logs.                                                                                                                                               | `APP_ENV` (`staging` or `production`) is fatal if missing on Render. It appears in liveness and logs, and a visible "Staging" banner shows in the interface.                                                                                                                                                         |
| S-04 | medium         | **The `render.yaml` plan name `starter` isn't a current plan ID.** The Blueprint spec lists `free`, `0.5c-512mb`, `1c-2g`, …                                                                                                                                             | `0.5c-512mb`.                                                                                                                                                                                                                                                                                                        |
| S-05 | medium         | **Pre-deploy commands aren't available on free Render services**, so the $0 staging couldn't migrate. Production would also have two migration paths.                                                                                                                    | One path for both: the deploy workflow runs `prisma migrate deploy` with the direct URL, after the marker check and the backup, before the hook. Remove `preDeployCommand`. Readiness still blocks code on an old schema.                                                                                            |
| S-06 | low            | **Deploy hooks support `?ref=<sha>`**, but deploy.yml deployed whatever the branch head was and so required the SHA to be `main`'s head.                                                                                                                                 | Pass `ref`, and require only that the commit is on `main` and green. Production also requires a successful staging deployment of the same SHA.                                                                                                                                                                       |
| S-07 | medium         | **`db:restore` checks row counts but not content before committing.** A tampered value that keeps the counts is restored, and only a later `db:verify` notices.                                                                                                          | Compare per-table checksums inside the restore transaction, and roll back on a mismatch.                                                                                                                                                                                                                             |
| S-08 | medium         | **Backup encryption has never been executed.** There is no `age` on the development machine, and CI doesn't exercise it.                                                                                                                                                 | A CI encrypt → decrypt → compare round trip. It stays **unverified until CI runs**.                                                                                                                                                                                                                                  |
| S-09 | medium         | **The migration and failure drills are manual and one-off.**                                                                                                                                                                                                             | `npm run drill:migrations` and `npm run drill:backup` on disposable databases, run in CI too.                                                                                                                                                                                                                        |
| S-10 | medium         | **There is no acceptance suite that can run against a deployed, invite-only server.** The e2e suite registers freely and needs direct database access.                                                                                                                   | A `playwright.staging.config.ts` suite that uses only HTTP: an owner-created invite code, synthetic accounts and a staging admin login.                                                                                                                                                                              |
| S-11 | low            | Template values pasted unchanged (`REPLACE_ME…`) aren't caught.                                                                                                                                                                                                          | Fatal in production for any required variable.                                                                                                                                                                                                                                                                       |
| S-12 | info           | Secure cookies: Auth.js uses `useSecureCookies ?? url.protocol === "https:"`, so an https `AUTH_URL` behind Render's TLS gives `__Secure-` cookies. This can't be observed until a real deploy.                                                                          | Staging acceptance checks the cookie flags.                                                                                                                                                                                                                                                                          |
| S-13 | info           | The client IP is the right-most `X-Forwarded-For` entry with `TRUSTED_PROXY_HOPS=1`. Render's exact header chain isn't documented on the pages read.                                                                                                                     | The staging acceptance procedure compares the audit-log IP with the tester's own IP.                                                                                                                                                                                                                                 |
| S-14 | info           | Neon region IDs weren't confirmed on an official page in this session. Render regions are `oregon`, `ohio`, `virginia`, `frankfurt` and `singapore` (Blueprint spec).                                                                                                    | The owner checks the region pair in the Neon console at creation.                                                                                                                                                                                                                                                    |

No secrets, credentials or database URLs were found in the repository (scan of tracked files).

## 4. Staging deployment plan

1. **Local (this milestone):** S-01 to S-11, the drills, the acceptance suite, the docs, then
   the PR.
2. **Owner approvals (M11_STAGING_ARCHITECTURE.md, "Approvals"):**
   - a Neon Free project
   - a Render Free service from `render.staging.yaml`
   - the GitHub `staging` environment and its secrets
   - a staging backup key
3. **First staging deploy (after approval):**
   - Run `deploy-staging.yml` for the merged M11 commit.
   - Mark the new database `staging`.
   - Seed a staging admin.
   - Run the acceptance suite and the post-deploy checklist.
   - Run a backup and restore drill.
   - Run a deliberate failed-deploy drill.
4. **Beta readiness assessment** with real staging results.
