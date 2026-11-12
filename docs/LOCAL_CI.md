# Local CI (temporary, 2026-11-12 → 2026-12-01)

The GitHub Actions minutes for this private repository are used up until **2026-12-01**, so no
CI runs on GitHub until then. Until then, every change is verified with `npm run ci:local`. It
reproduces `.github/workflows/ci.yml` on the development machine, in the same order, against
disposable local databases. **It is not GitHub CI**, and nothing it reports may be described as
"CI passed". The workflows themselves are unchanged.

## Prerequisites

| Need                                      | Why                                       | Check                                                   |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Node 24 and `npm install` done            | everything                                | `node --version`                                        |
| Local PostgreSQL on :5433                 | disposable `hq_localci_*` databases       | `npm run db:local` (keep it running)                    |
| `.env` pointing at the **local** database | the runner refuses anything else          | `npm run db:inspect -- --pooled` shows "LOCAL database" |
| Playwright Chromium                       | step 19                                   | `npx playwright install chromium` (once)                |
| Free ports 3100, 3101, 3200, 3300, 3301   | e2e servers, smoke, container equivalents | stop other local servers first                          |
| Optional: Docker                          | the `docker` job (steps 22–24)            | `docker --version`                                      |
| Optional: `age`                           | the backup drill's encryption round trip  | `age --version`                                         |
| Network access to registry.npmjs.org      | step 02, the dependency audit             | —                                                       |

`psql` isn't needed: the runner creates and drops databases with the `pg` driver.

## Running it

```bash
npm run ci:local -- --fresh --with-firefox     # the full run used before every PR
npm run ci:local                               # same steps, on a dirty tree, keeping build artifacts
npm run ci:local -- --keep-going               # report every step even after a failure
npm run ci:local -- --install                  # step 01 runs `npm ci` instead of `npm ls`
npm run ci:local -- --skip-e2e                 # quick iteration only: NOT a CI equivalent
```

What the flags do:

- **`--fresh`** refuses to start unless the working tree is clean, so the results map to a
  commit. It then deletes `.next`, `test-results` and `playwright-report` first.
- **Stop the dev server** (`npm run dev` or the app preview) before a `--fresh` run: deleting
  `.next` breaks a running dev server.
- **Exit code:** 0 when no required step failed, 1 otherwise. BLOCKED steps and the advisory
  Firefox step don't change it, exactly as in CI. Required checks are never skipped silently:
  every BLOCKED or NOT RUN step is listed with its reason.
- **Output:** `.local/local-ci/<run>/` (git-ignored) holds `summary.md`, one log per step and
  `env.txt`. Connection strings and the per-run `AUTH_SECRET` are masked.

Individual checks are the same npm scripts CI calls:

| What                        | Command                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| lint, format, types         | `npm run lint`, `npm run format:check`, `npm run typecheck`       |
| unit tests                  | `npm test`                                                        |
| integration tests           | `npm run test:integration` (uses `TEST_DATABASE_URL`, local only) |
| migrations                  | `npm run db:check-migrations -- --base origin/main`               |
| drills                      | `npm run drill:migrations`, `npm run drill:backup`                |
| build, browser tests, smoke | `npm run build`, `npm run test:e2e`, `npm run smoke -- <url>`     |

## Database isolation

- **Preflight.** It refuses to start if `DATABASE_URL`, `TEST_DATABASE_URL`,
  `MIGRATE_DATABASE_URL` or `DRILL_DATABASE_URL` is not on localhost. It also refuses if any
  environment variable contains a host listed in `.env.staging.local`. That file's hosts are
  read for this comparison only; the file is never loaded and nothing from it is printed. Both
  refusals were tested.
- **Disposable databases.** Each run creates `hq_localci_<id>`, `…_test` and `…_restore` on the
  local server, the same shape as CI's service container, and drops them at the end, also after
  a failure.
- **A clean environment per step.** Each step's environment is the CI job's:
  - `CI=true`, `AUTH_URL=http://localhost:3100`, `AUTH_TRUST_HOST=true`, a fresh random
    `AUTH_SECRET`
  - `DATABASE_URL` and `TEST_DATABASE_URL` pointing at the disposable databases
  - empty `SEED_ADMIN_*`: CI's seed creates no admin
  - **removed:** `MIGRATE_DATABASE_URL`, `DRILL_DATABASE_URL`, `SEED_TARGET`,
    `ALLOW_REMOTE_DATABASE`, `APP_ENV`, `RENDER`, `E2E_BASE_URL`, `STAGING_*`
- **The M11 hosted-database guards still apply inside every step:** Prisma `migrate dev`,
  `reset` and `db push`, the seed, `next dev`, integration tests, e2e and the drills. The runner
  doesn't relax any of them.

## Step mapping (ci.yml → local)

### `verify` job

| ci.yml step                                                | Local                                                  | Equivalence                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| actions/checkout (fetch-depth 0)                           | the working tree; `--fresh` requires it to be clean    | equivalent (full history is local)                                                                           |
| actions/setup-node 24                                      | the installed Node                                     | equivalent if Node 24 (recorded per run)                                                                     |
| Install dependencies (`npm ci`)                            | `npm ls --all` (default), or `npm ci` with `--install` | `npm ls` proves the installed tree matches the lockfile; it doesn't reinstall from scratch                   |
| Dependency audit                                           | same command                                           | equivalent (needs the network)                                                                               |
| Migration safety                                           | `db:check-migrations -- --base origin/main` (PR form)  | equivalent; run `git fetch` first so `origin/main` is current                                                |
| Generate ephemeral auth secret                             | random 32 bytes per run                                | equivalent                                                                                                   |
| Lint, Formatting, Type check, Validate content, Unit tests | same commands                                          | equivalent                                                                                                   |
| Create test database (psql)                                | `CREATE DATABASE` through the `pg` driver              | equivalent (no psql needed)                                                                                  |
| Integration tests                                          | same, against the disposable test database             | equivalent                                                                                                   |
| Migrate and seed                                           | same                                                   | equivalent                                                                                                   |
| Backup and restore drill                                   | the same 4 commands as sub-steps 13a–d                 | equivalent                                                                                                   |
| Install age                                                | detects `age`                                          | **BLOCKED while `age` is missing**                                                                           |
| Migration drill                                            | same                                                   | equivalent                                                                                                   |
| Backup drill                                               | same                                                   | equivalent except the `age` round trip (skipped by the drill itself when `age` is missing, and reported)     |
| Production build                                           | same                                                   | equivalent                                                                                                   |
| Install Playwright browser                                 | checks that Chromium is installed                      | equivalent (CI downloads it)                                                                                 |
| End-to-end tests                                           | same (`CI=true`: 2 workers, 1 retry, like CI)          | equivalent on Windows Chromium                                                                               |
| End-to-end tests (Firefox, advisory)                       | same with `--with-firefox`                             | **BLOCKED on this machine:** Firefox fails to launch (`spawn UNKNOWN`, Windows side-by-side error, since M5) |
| Smoke test                                                 | same, on :3200, waiting for readiness                  | equivalent                                                                                                   |
| Upload Playwright report                                   | not applicable                                         | reports stay local                                                                                           |

### `docker` job

| ci.yml step                                                                              | Local                                                       | Equivalence                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build production image                                                                   | `docker build` when Docker exists                           | **BLOCKED: no Docker**                                                                                                                                                                                                   |
| Start-up test (migrate in the image, liveness, readiness, non-root, SIGTERM stop < 15 s) | with Docker: the same; without: **23L**, a local equivalent | 23L starts the app with the image's exact `CMD` (`node node_modules/next/dist/bin/next start`) and checks liveness and readiness. **The image build, non-root user and SIGTERM handling in the container stay BLOCKED.** |
| Refuses to start with a placeholder secret                                               | with Docker: the same; without: **24L**                     | 24L runs the same command with the placeholder secret and requires a non-zero exit. The behaviour is the same at process level, but not inside the container.                                                            |

### Other workflows (not reproduced, by design)

| Workflow                                          | Why not                                                                 | Covered locally by                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `deploy-staging.yml`, `deploy.yml`, `_deploy.yml` | need a GitHub environment, secrets, Render and Neon, and owner approval | the drills (marker guard, migrations, backups), the staging acceptance suite (when staging exists) |
| `backup.yml`                                      | needs a hosted database and the `age` key                               | `drill:backup`                                                                                     |
| Dependabot                                        | GitHub service                                                          | none needed                                                                                        |

## Known differences from GitHub Actions

|                | GitHub Actions             | Local                                |
| -------------- | -------------------------- | ------------------------------------ |
| OS             | ubuntu-latest (Linux)      | Windows 11                           |
| PostgreSQL     | **17** (service container) | **18.6** (embedded, :5433)           |
| Database tools | psql                       | `pg` driver                          |
| Encryption     | `age` installed with apt   | **not installed**                    |
| Container      | Docker                     | **not installed**                    |
| Firefox        | runs (advisory)            | **fails to launch**                  |
| Browsers       | freshly downloaded         | pre-installed Playwright 1.65 builds |

The migrations use no PostgreSQL 18-only features, and `db:check-migrations` and the drills are
version-agnostic. Still, the first GitHub run after 2026-12-01 is the real PostgreSQL 17 check.

## Still unverified until GitHub CI runs again

1. **The `docker` job:**
   - the image build
   - migrations from inside the image
   - the non-root user
   - SIGTERM handled in under 15 s
   - the refusal inside the container
2. **The backup drill's `age` encryption round trip**, and so the encryption step used by
   `_deploy.yml` and `backup.yml`.
3. **Firefox e2e** (advisory).
4. **Linux-specific behaviour and PostgreSQL 17.**
5. **The CI-only fixes not yet seen green on GitHub:** the `apt-get update` before `age`, and
   the explicit `MIGRATE_DATABASE_URL` in the restore steps.

## Resuming GitHub Actions on 2026-12-01

1. Check that the Actions usage has reset: Settings → Billing → Actions. Consider a spending
   limit of $0 so a future overrun blocks instead of billing.
2. Re-run CI on `main` (Actions → CI → Run workflow, or push a no-op commit through a PR).
   Record the `verify` and `docker` results here and in PROGRESS.md.
3. Open or refresh PRs merged during the gap (`feature/local-ci` and later) so each gets a real
   CI run. Treat any PR merged on local evidence only as **unverified on GitHub** until then.
4. If something only fails on GitHub (Linux, PostgreSQL 17, Docker, `age`), fix it on a branch.
   Never weaken the check.
5. Keep `npm run ci:local` as the pre-push routine; it remains useful.
6. After a green Firefox run, remove `continue-on-error` from the Firefox step
   (INTEGRATION_AUDIT.md).

## Results

**Final verification (2026-11-12): run `20261112T102916-7fba`, commit `c0ac9be` (the runner and
docs as submitted; later commits change docs only), `npm run ci:local -- --fresh --with-firefox`.**

- The working tree was clean (enforced by `--fresh`), and `.next`, `test-results` and
  `playwright-report` were removed first.
- `origin/main` was `f079947`.
- Node 24.18.0; local PostgreSQL 18.6, reported by the runner itself (GitHub CI: postgres:17).
- **Exit code 0: 25 PASS, 5 BLOCKED, 1 NOT RUN, 0 FAIL.** All disposable `hq_localci_*`
  databases were dropped afterwards.
- Before the run, the preflight was self-tested: a hosted URL in `DATABASE_URL`,
  `TEST_DATABASE_URL`, `MIGRATE_DATABASE_URL` or `DRILL_DATABASE_URL`, or any variable containing
  the staging host, was refused (exit 1) before anything connected. Lint, Prettier and the type
  check pass on the runner.

The previous fresh run (`20261112T064912-61ef`, commit `ee05d63`) had the same result. Its summary
printed "postgres ?" because of a reporting bug, fixed in `829cb4e`.

| #     | ci.yml step                           | Result                         | Evidence or reason                                                                                                            |
| ----- | ------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 00    | checkout, setup-node                  | PASS                           | clean tree, Node 24.18.0                                                                                                      |
| 01    | Install dependencies                  | PASS                           | `npm ls --all`: the installed tree matches the lockfile (`npm ci` itself not re-run)                                          |
| 02    | Dependency audit                      | PASS                           | 0 high/critical in production dependencies                                                                                    |
| 03    | Migration safety                      | PASS                           | 12 migrations, none destructive, none edited since `origin/main`                                                              |
| 04    | Ephemeral auth secret                 | PASS                           | random per run                                                                                                                |
| 05–08 | Lint, Formatting, Type check, Content | PASS                           |                                                                                                                               |
| 09    | Unit tests                            | PASS                           | 160 tests                                                                                                                     |
| 10    | Create test database                  | PASS                           | through the `pg` driver (CI: psql)                                                                                            |
| 11    | Integration tests                     | PASS                           | 94 tests, on the disposable test database                                                                                     |
| 12    | Migrate and seed                      | PASS                           | fresh disposable database                                                                                                     |
| 13a–d | Backup and restore drill              | PASS                           | backup, migrate restore database, restore, verify (checksums, FKs, app reads)                                                 |
| 14    | Install age                           | **BLOCKED**                    | `age` isn't installed                                                                                                         |
| 15    | Migration drill                       | PASS                           | fresh, upgrade, pending, failure and recovery, marker, database down                                                          |
| 16    | Backup drill                          | PASS (encryption part BLOCKED) | restore, verify, 6 corrupted or tampered cases rejected; the `age` round trip was skipped by the drill                        |
| 17    | Production build                      | PASS                           |                                                                                                                               |
| 18    | Playwright browser                    | PASS                           | Chromium installed                                                                                                            |
| 19    | End-to-end tests (Chromium)           | PASS                           | **36 passed, 18 skipped, 0 failed** (5.3 min, `CI=true`)                                                                      |
| 20    | Firefox e2e (advisory)                | **BLOCKED**                    | `browserType.launch: spawn UNKNOWN`: Firefox can't start on this machine (22 couldn't launch, 2 skipped, 3 needed no browser) |
| 21    | Smoke test                            | PASS                           | all checks on a production server (:3200)                                                                                     |
| —     | Upload Playwright report              | NOT RUN                        | no artifact store locally                                                                                                     |
| 22    | docker: build image                   | **BLOCKED**                    | no Docker                                                                                                                     |
| 23    | docker: start-up test                 | **BLOCKED**                    | no Docker. Local equivalent **23L PASS**: the image's `CMD` started; liveness ok; readiness `migrations: ok`                  |
| 24    | docker: placeholder-secret refusal    | **BLOCKED**                    | no Docker. Local equivalent **24L PASS**: exit code 1                                                                         |

**Genuine failures: none.** The 18 skipped e2e tests are phone copies of desktop-only flows and
the opt-in screenshot runs, the same as on CI.

**First run (2026-11-12): run `20261112T063513-80ca`, commit `34bdef7`**, the first version of
the runner, with `--keep-going --with-firefox`. **Exit 0**: every verify step that could run
passed, `age` and Docker were unavailable, and Firefox failed to launch. It turned up no code
failures, only runner improvements, made in `ee05d63`:

- PASS/FAIL/BLOCKED/NOT RUN classification
- notes that show the first real error line
- local container equivalents
- `--fresh`
- a real Chromium check
- the `DEP0190` warning fixed

A stray `next start -p 3300` left by an earlier session was stopped before the final run.

## Getting Docker, age and Firefox (investigated, nothing installed)

All three are free. Each needs software installed on the development machine, which is the
owner's decision. None affects the database guards or the project.

| Tool                        | Cost         | Option                                                                                                                                                                            | Notes                                                                                                                                                                                                                                                     |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **age** (backup encryption) | free (BSD-3) | `winget install FiloSottile.age`, or the official release zip from github.com/FiloSottile/age (check the release checksum)                                                        | A single small binary, no service and no admin rights for the zip. It enables step 14 and the drill's encryption round trip. It's the same tool the workflows use.                                                                                        |
| **Firefox for Playwright**  | free         | Install the **Microsoft Visual C++ Redistributable** (x64, from Microsoft: `winget install Microsoft.VCRedist.2015+.x64`), then `npx playwright install firefox --force`          | `spawn UNKNOWN` plus the Windows "side-by-side configuration is incorrect" error (seen since M5) point to a missing runtime. Not confirmed until it runs.                                                                                                 |
| **Container engine**        | free options | **Podman Desktop** (Apache-2.0) or **Rancher Desktop** (Apache-2.0); **Docker Desktop** is free for personal use and small businesses (check Docker's current subscription terms) | Needs WSL 2 or virtualisation and admin rights, and it's the heaviest change. The runner calls `docker` and uses `host.docker.internal`, so with Podman an alias, or `podman machine` with Docker compatibility, is needed. Then steps 22–24 run in full. |

No paid service is needed. Until these are installed, steps 14, 20 and 22–24 stay BLOCKED here and
are verified only by GitHub CI from 2026-12-01.
