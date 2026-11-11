# Deployment architecture (M10, 2026-11-11)

**Recommendation, not a purchase.** Nothing has been registered, bought or connected. Prices were
read on the providers' own pages on 2026-11-11 (sources at the end). Anything marked
_estimate_ or _unverified_ must be checked by the owner before signing up. Budget target:
**under $30/month** running and **under $300** set-up.

## What HanziQuest needs

- **One long-running Node 24 process** (`next start` or the `Dockerfile`) behind HTTPS. PWAs
  and service workers need HTTPS. `proxy.ts` and the route handlers use Prisma, so they need
  the Node runtime, not an edge runtime.
- **PostgreSQL 15+** with point-in-time recovery (PITR) of at least 7 days (DATABASE_BACKUP.md).
  Plain PostgreSQL is enough: no extensions beyond the defaults.
- **No object storage.** There are no user uploads, and handwriting samples are database rows.
  Off-site backups are encrypted files (see "Backups").
- **Beta scale:** invite-only, at most a few hundred learners. 512 MB of RAM for the app and the
  smallest database tier are enough. Measure before scaling.
- **Shared rate limiting** is already in PostgreSQL, so more than one instance is safe.

## Architectures compared

### A. Render web service + Neon Launch (recommended)

| Item                                                   | Price (official)                         | Monthly estimate                                                                 |
| ------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------- |
| Render workspace: Hobby                                | $0                                       | $0                                                                               |
| Render web service: 512 MB, under 1 CPU (`0.5c-512mb`) | $7/month, billed per second              | $7.00                                                                            |
| Render bandwidth                                       | Hobby includes 5 GB/month, then $0.15/GB | $0–1.50 (estimate: 5–15 GB)                                                      |
| Neon Launch compute                                    | $0.106 per CU-hour, no monthly minimum   | 0.25 CU × 730 h = **$19.35** always on; about $5–8 with scale-to-zero (estimate) |
| Neon storage                                           | $0.35/GB-month                           | about $0.35 (under 1 GB)                                                         |
| Neon instant restore (7-day history)                   | $0.20/GB-month of change history         | about $0.20–0.50                                                                 |
| **Total**                                              |                                          | **about $14 (scale-to-zero) to $28 (always on)**                                 |

- **PITR:** up to 7 days on Launch. Restore in place or to a new branch. A branch lets the
  restore drill run against a copy of production without touching it.
- **Complexity:** low. Render builds the `Dockerfile` from the repo. Neon gives a pooled URL
  for the app and a direct URL for migrations and backups.
- **Compatibility:** standard PostgreSQL over TLS (`sslmode=require`). Prisma's `pg` adapter
  works with the pooled (PgBouncer, transaction mode) URL. The app uses no session-level
  features: advisory locks are transaction-scoped (`pg_advisory_xact_lock`), and that is
  fine in transaction mode.
- **Region and latency:** put both in the same region, near most testers. Possible pairs
  (_verify both lists when signing up_): Render Frankfurt ↔ Neon AWS eu-central-1; Render
  Virginia ↔ Neon AWS us-east-1; Render Singapore ↔ Neon AWS ap-southeast-1. Different regions
  add about 10–150 ms to every query.
- **Availability:** one instance, so a deploy or instance failure causes a short outage.
  Render keeps the old version serving until the new one passes its health check. That is
  acceptable for an invite-only beta. Scale-to-zero adds about 1 s to the first query after
  5 minutes idle.
- **Lock-in:** low. It's a Docker image plus standard PostgreSQL. Data leaves with `pg_dump` or
  `npm run db:backup`.

### B. Render web service + Render Postgres

| Item                                                          | Price (official)             | Monthly estimate              |
| ------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| Web service `0.5c-512mb`                                      | $7                           | $7.00                         |
| Postgres `0.1c-256mb` (100 connections)                       | $6, plus storage at $0.30/GB | about $6.30–7.50              |
| Bandwidth                                                     | as in A                      | $0–1.50                       |
| **Total (Hobby workspace)**                                   |                              | **about $13–16**              |
| **Total with a 7-day PITR window** (Pro workspace, $25/month) |                              | **about $38–41: over budget** |

- **PITR:** 3 days on Hobby, 7 days on Pro. Logical backups are kept for 7 days on every
  plan. PITR can't target the last 10 minutes.
- **Strengths:** one vendor, one bill, a private network between app and database, and the
  simplest set-up.
- **Weaknesses:**
  - The 3-day window is shorter than the 7 days DATABASE_BACKUP.md asks for. A problem found
    after a weekend may be unrecoverable.
  - The 256 MB database is tight.
  - Restores create a new database, so `DATABASE_URL` has to change.
  - Lock-in is low (standard PostgreSQL), but app and data share one account, so losing the
    account loses both.

### C. Fly.io Machines + Fly Managed Postgres (or + Neon)

| Item                                     | Price (official, from 2026-10-01) | Monthly estimate           |
| ---------------------------------------- | --------------------------------- | -------------------------- |
| Machine `shared-cpu-2x` 512 MB           | $4.39                             | $4.39                      |
| Managed Postgres Basic (shared-2x, 1 GB) | $38, plus $0.28/GB storage        | about $38.30               |
| **Total with Fly Postgres**              |                                   | **about $43: over budget** |
| **Total with Neon Launch instead**       |                                   | **about $10–25**           |

- Fly's documentation gives no PITR window for Managed Postgres (_unverified_).
- Fly also needs more operations work: `fly.toml`, regions, IP allocation and private
  networking.
- The cheapest compute, but the most to run yourself. Not recommended for a solo owner.

### Not recommended

- Free app tiers that sleep: Render Free spins down after 15 minutes.
- Neon Free: a 6-hour history and no instant restore.
- Vercel Hobby: non-commercial use only.
- Any database without PITR.

## Recommendation

**Architecture A: Render web service (Hobby workspace, `0.5c-512mb`) with Neon Launch, in the
same region.**

1. It is the only option that gives **7-day PITR under $30/month**.
2. A Neon branch makes restore drills safe and cheap.
3. Lock-in is low on both sides.
4. Set-up costs **$0**, with no paid add-ons. A custom domain, if the owner wants one, costs
   about $10–20 a year from any registrar (_estimate_).

**Health checks and cost.** Point Render's health check at `/api/health` (readiness: the
database is reachable and every migration is applied), so a broken release never takes
traffic. That check queries the database every few seconds, so **Neon won't scale to zero:
budget the always-on figure, about $28/month.** To cut that to about $14, the owner can point
the health check at `/api/health/live` instead. It skips the database, so a release on a
broken schema could take traffic; the deploy workflow still waits for readiness and runs the smoke test
after every deploy. Recommended: start with `/api/health`, and review it after the first
invoice.

## Supporting services (all optional, $0)

| Need             | Choice                                                                                                                                             | Cost                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Error reporting  | Sentry free plan, or self-hosted GlitchTip. The app sends events through the envelope API (`SENTRY_DSN`); without it, errors go to JSON logs only. | $0 (_check plan limits_)                             |
| Uptime           | Render's own health checks and notifications, plus any free external monitor on `/api/health`                                                      | $0                                                   |
| Logs             | Render's log viewer (retention depends on the plan; _verify_). Logs are JSON lines and can be shipped anywhere later.                              | $0                                                   |
| Off-site backups | `backup.yml`: an `age`-encrypted logical backup kept as a GitHub Actions artifact (30 days). The private key never enters GitHub.                  | $0 (within the Actions minutes included in the plan) |
| CI               | GitHub Actions                                                                                                                                     | included minutes                                     |

Cloudflare R2 or Backblaze B2 could keep backups longer than 30 days. Each needs an account,
so that is the owner's call.

## Data export and migration away

- **Database:** `npm run db:backup -- --source <direct URL>` (a portable NDJSON) or
  `pg_dump`. Restore into any PostgreSQL 15+ with `prisma migrate deploy`, then `db:restore`
  and `db:verify` (DATABASE_BACKUP.md).
- **App:** the same Docker image runs on any container host. Set the env vars from
  DEPLOYMENT.md, then move DNS.

## Sources (read 2026-11-11)

- Render pricing (official): https://render.com/pricing.md
- Render Postgres backups (official): https://render.com/docs/postgresql-backups
- Render Free limits (official): https://render.com/docs/free
- Neon pricing (official, page dated 2026-11-04): https://neon.com/pricing
- Fly.io pricing update, effective 2026-10-01 (official): https://fly.io/pricing-update/
- Fly Managed Postgres (official): https://docs.fly.io/mpg
- Vercel Hobby terms (official): https://vercel.com/docs/plans/hobby
- Earlier research with third-party figures: HOSTING.md (2026-11-10)
