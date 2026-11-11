# M11 staging architecture (2026-11-11)

**Design, not provisioned.** Nothing has been created on Render, Neon or GitHub. Provider
limits and prices come from the official pages read on 2026-11-11 (sources at the end). Items
marked _estimate_ or _unverified_ are for the owner to confirm.

## Diagram

```
                         GitHub (private repo)
   PR ──► CI: verify (+ drills) and docker ──► merge to main
                                                   │
             owner: Actions → "Deploy staging (manual)", full SHA + "deploy staging"
                                                   │
   ┌──────────── preflight: commit on main, verify + docker green for that SHA ────────────┐
   │ environment "staging" (required reviewer: owner) ── staging secrets only               │
   │   1. db:environment --expect staging   (refuses production or unknown databases)       │
   │   2. encrypted backup (staging age key) → artifact, 30 days                           │
   │   3. prisma migrate deploy (direct URL)                                               │
   │   4. mark a new database "staging"                                                    │
   │   5. Render deploy hook ?ref=<SHA>  ────────────────┐                                  │
   │   6. wait: /api/health release=<SHA>, env=staging   │                                  │
   │   7. smoke test (read-only)                         │                                  │
   └─────────────────────────────────────────────────────┼──────────────────────────────────┘
                                                         ▼
   Render (Free, region R)  hanziquest-staging ──TLS──► learners: synthetic accounts only
     APP_ENV=staging, banner, logs env=staging           │ pooled URL, sslmode=require
                                                         ▼
   Neon (Free, project "hanziquest-staging", region R)   DeploymentMarker = "staging"

   Production (later, separate): Render 0.5c-512mb + Neon Launch, its own GitHub environment,
   secrets, backup key and marker. deploy.yml requires the same SHA to have succeeded on
   staging first.
```

## Resources and cost

| Service                                         | Plan                              | Monthly                      | Usage-based charges                                                                                                         | Limits that matter                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render web service `hanziquest-staging`         | **Free** (`plan: free`)           | **$0**                       | none on Free; bandwidth limits apply                                                                                        | Spins down after 15 min without inbound traffic; about 1 min to wake. 750 free instance hours per workspace per month. No pre-deploy command. One instance. Render may restart it at any time. |
| Neon project `hanziquest-staging`               | **Free**                          | **$0**                       | none: limits suspend compute instead of billing                                                                             | 100 CU-hours/project/month; 1 GB storage/project; 6-hour history (no long PITR); scale-to-zero after 5 min (can't be disabled); 10 branches; 5 GB egress                                       |
| GitHub `staging` environment, Actions           | included                          | $0 within the plan's minutes | Private repos have a monthly Actions minutes allowance (_check the plan_). Each CI run is about 25–35 minutes (_estimate_). | Without a payment method, workflows stop when minutes run out, with no charge                                                                                                                  |
| **Staging total**                               |                                   | **$0**                       |                                                                                                                             |                                                                                                                                                                                                |
| Production (M10 recommendation, for comparison) | Render `0.5c-512mb` + Neon Launch | **about $14–28**             | Neon compute per CU-hour; Render bandwidth over the included amount                                                         | DEPLOYMENT_ARCHITECTURE.md                                                                                                                                                                     |

**Free-tier risks:**

- **Neon compute hours.** Render checks readiness (which queries the database) while the
  staging instance is awake. At 0.25 CU, 100 CU-hours is about 400 awake hours a month. If
  staging stays awake around the clock (720 h), Neon suspends compute late in the month. That
  costs nothing but makes staging unavailable. Mitigations:
  - set Neon's maximum compute to 0.25 CU;
  - accept that staging sleeps when unused;
  - if it runs out, wait for the monthly reset.
- **Render free hours (750 per workspace)** are shared with any other free service in the
  workspace.
- **Cold starts:** about 1 min after 15 minutes idle. The acceptance suite and the deploy
  workflow allow for it.
- **Neon's 6-hour history** is enough for synthetic data. Staging's off-site backups use
  `backup.yml` with the staging key.

**Cancellation:**

- Render: Dashboard → service → Settings → Delete.
- Neon: Project settings → Delete project.
- GitHub: delete the `staging` environment, which removes its secrets.

Nothing is irreversible except data deletion. Staging data is synthetic, so deleting it loses
nothing real.

**Region:** pick one Render region (oregon, ohio, virginia, frankfurt or singapore; it can't be
changed later) and the Neon AWS region closest to it. Neon's region list wasn't confirmed on an
official page in this session; check it in the Neon console.

## Environment separation

| Concern                     | Staging                                                                       | Production                         | Enforced by                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                    | Neon project `hanziquest-staging`                                             | separate Neon project              | Separate projects. The `DeploymentMarker` row ("staging" or "production") is checked by readiness (503 on mismatch) and by `db:environment` before any backup or migration. |
| Real learner data           | **never**                                                                     | yes                                | A production backup restored into staging carries the "production" marker, so staging returns 503. Policy: never copy production data to staging.                           |
| App secrets (`AUTH_SECRET`) | own value                                                                     | own value                          | Separate Render services. The start-up check refuses `REPLACE_ME` and known placeholders.                                                                                   |
| Deploy and backup secrets   | GitHub environment `staging`                                                  | GitHub environment `production`    | Environment-scoped secrets with the same names; a job sees only its own environment's.                                                                                      |
| Backup encryption key       | staging `age` key pair                                                        | production key pair                | Different `BACKUP_AGE_RECIPIENT` per environment. The private keys stay with the owner, separately.                                                                         |
| Identification              | `APP_ENV=staging`: banner, logs `env=staging`, health `environment`           | `APP_ENV=production`               | Start-up check (fatal if missing on Render). The deploy workflow checks the reported environment.                                                                           |
| Registration                | invite-only; `open` is **fatal**                                              | invite-only (owner may open later) | Start-up check                                                                                                                                                              |
| Reset links                 | off                                                                           | off                                | `PASSWORD_RESET_LINKS` unset (D-047)                                                                                                                                        |
| Admin accounts              | one synthetic staging Super Admin, seeded once (M11_STAGING_CONFIGURATION.md) | real staff                         | Seed procedure                                                                                                                                                              |
| Auto-deploy                 | off                                                                           | off                                | `autoDeployTrigger: "off"`                                                                                                                                                  |

## Security boundaries

- **Staging is reachable on the internet** (the Render URL), so it is protected like
  production: invite-only, the same authentication, RBAC, rate limits, CSP and HSTS. Only
  synthetic accounts and synthetic data are allowed.
- **Secrets never leave their stores** (Render, GitHub environment, the owner's password
  manager). Workflows mask them. The drills and docs never print connection strings.
- **The deploy job** can only reach the staging database and hook. Even a mis-pasted
  production URL is stopped by the marker guard before anything is written.
- **Supply chain:** the same image and CI as production. Dependabot majors are reviewed
  separately and not mixed into M11.

## Backup plan (staging)

| Layer             | Staging                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Provider history  | Neon Free: 6 hours                                                                                                 |
| Pre-deploy backup | Every staging deploy: an encrypted artifact (staging key), kept 30 days                                            |
| Off-site          | `backup.yml` with `environment: staging`, manually. Restore-verified on the runner.                                |
| Drills            | `npm run drill:backup` (local and CI). A staging restore drill after the first deploy (M11_STAGING_ACCEPTANCE.md). |

## Deployment flow

See the diagram. In short: a reviewed merge to `main`, green CI, then the owner dispatches
`deploy-staging.yml` and approves the environment job. The workflow:

1. guards the database
2. takes a backup
3. migrates
4. marks a new database
5. deploys the exact SHA
6. waits for readiness on that SHA and environment
7. runs the smoke test
8. writes a summary (release, backup artifact, result)

## Rollback flow

1. A failed build or a failed readiness check means Render keeps the previous release serving.
   The workflow fails with the last health response.
2. For a bad release that serves: Render → Events → the previous deploy → Rollback, or
   re-dispatch `deploy-staging.yml` with the previous SHA. Migrations are additive, so the old
   code runs on the newer schema.
3. Data: restore the pre-deploy artifact into a new Neon branch or project (DATABASE_BACKUP.md).
   Staging data is synthetic, so recreating the database and re-seeding is also acceptable.

Details are in ROLLBACK.md and M11_STAGING_OPERATIONS.md.

## Approvals the owner must give

M11_STAGING_CONFIGURATION.md, "Provisioning steps", lists each one with its exact settings.

| #   | Action                                                                                                                       | Cost | Security implication                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------- |
| 1   | Create a Neon account and a Free project `hanziquest-staging` in region R; set max compute 0.25 CU                           | $0   | Creates a database reachable over TLS with credentials    |
| 2   | Generate the staging `age` key pair on the owner's machine; store the private key offline                                    | $0   | Losing it makes staging off-site backups unreadable       |
| 3   | Create the GitHub environment `staging`: required reviewer the owner, no admin bypass, deployment branches limited to `main` | $0   | Gates every staging deploy and backup                     |
| 4   | Create the Render service from `render.staging.yaml` (Free plan) and enter its secrets                                       | $0   | A public staging URL                                      |
| 5   | Add the staging secrets to the GitHub environment                                                                            | $0   | Stores the staging database URL and deploy hook in GitHub |
| 6   | Dispatch `deploy-staging.yml` for the merged M11 commit and approve it                                                       | $0   | Migrates and deploys staging                              |
| 7   | Seed the staging admin; create a 1-day acceptance invite; run `npm run test:staging`                                         | $0   | Creates synthetic accounts on staging                     |

## Sources (official, read 2026-11-11)

- https://render.com/docs/free
- https://render.com/docs/deploys
- https://render.com/docs/deploy-hooks
- https://render.com/docs/environment-variables
- https://render.com/docs/blueprint-spec
- https://render.com/pricing.md
- https://neon.com/docs/introduction/plans
- https://neon.com/pricing
