# Hosting and database options (researched 2026-11-10)

> **Superseded by DEPLOYMENT_ARCHITECTURE.md (M10, 2026-11-11).** That document uses official
> prices read on 2026-11-11. This page is kept as the earlier research record.

Prices change often. **Verify on the provider's own pricing page before signing up.** Each
figure below says where it came from: _official_ means read on the provider's page or docs on
the date above; _third-party_ means pricing aggregators or blogs, which often disagree and may
be out of date. Nothing has been purchased.

## What HanziQuest needs

- A long-running Node.js 24 server (`next start` or the `Dockerfile`) behind HTTPS. Service
  workers and PWA install require HTTPS.
- PostgreSQL 15+ with **point-in-time recovery** and connection pooling for any serverless
  app host.
- `proxy.ts` and route handlers use Prisma, so they need the Node.js runtime, not an edge runtime.
- Beta scale: up to a few hundred learners. One small instance (512 MB to 1 GB RAM) is enough.
  Measure before scaling.

## App hosting

| Option                 | Smallest always-on price                                                               | Source                                                   | Notes                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Render** web service | Starter about **$7/mo** (512 MB, 0.5 CPU); workspace plans Hobby $0 / Pro about $25/mo | third-party (pricing tables didn't render on render.com) | Free services **spin down after 15 min** idle and take about 1 min to start (official docs), so they're unsuitable for the beta. Docker or native Node. Simplest fit. |
| **Railway**            | Hobby **$5/mo**, including $5 of usage credit; Pro $20/mo per seat                     | third-party                                              | Usage-metered (CPU, RAM, egress), so the bill depends on load. Good developer experience.                                                                             |
| **Fly.io** Machines    | about **$3–4.40/mo** for 512 MB shared CPU                                             | official page, conflicting figures                       | Cheapest compute. You run more yourself (volumes, regions). Managed Postgres starts at about $38/mo (third-party, unverified).                                        |
| **Vercel**             | Pro **$20 per member per month**; Hobby is **non-commercial only**                     | official docs (Hobby restriction), third-party (price)   | Serverless. Needs a pooled DB URL. Fine technically, but Hobby can't be used if HanziQuest is commercial.                                                             |

## Managed PostgreSQL

| Option                   | Price model                                                                                                                   | Point-in-time recovery                                                                                                                        | Source                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Neon** Free            | $0. 100 CU-hours/month, 1 GB per project; compute suspends after 5 min idle; hitting limits suspends compute or blocks writes | 6 h history, no instant restore                                                                                                               | official (neon.com/pricing, updated 2026-11-04) |
| **Neon** Launch          | No minimum. $0.106 per CU-hour, $0.35 per GB-month                                                                            | Up to **7 days**, instant restore $0.20 per GB-month of change history                                                                        | official                                        |
| **Neon** Scale           | $0.222 per CU-hour, $0.35 per GB-month                                                                                        | Up to 30 days                                                                                                                                 | official                                        |
| **Render Postgres**      | Smallest paid about $6/mo (third-party)                                                                                       | PITR on paid databases only: **3 days** on the Hobby workspace, **7 days** on Pro; logical backups kept 7 days. Free DBs expire after 30 days | backups: official docs; price: third-party      |
| **Supabase** Pro         | $25/mo per project                                                                                                            | Daily backups kept 7 days; PITR is a paid add-on (about $100/mo for 7 days, third-party, unverified)                                          | third-party                                     |
| **Fly Managed Postgres** | About $38/mo + storage                                                                                                        | Managed backups                                                                                                                               | third-party, unverified                         |

Neon's connection pooling is included on all plans (official). A CU is about 4 GB RAM plus CPU.
At beta load, set Neon's minimum compute to the smallest size and allow scale-to-zero only if
a cold start of about 1 s on the first request after idle is acceptable.

## Recommendation for the beta

**Render web service (Starter) + Neon Launch**, in the same region as most testers.

- About $7/mo for the app (verify) plus Neon usage. A 0.25 CU compute running all month is
  about 182 CU-hours × $0.106 ≈ $19; with scale-to-zero, much less at low traffic. Storage
  under 1 GB costs cents. Add about $0.20 per GB-month of change history for 7-day PITR.
  **Estimate: roughly $10–30/month.** Watch the first invoice.
- Neon Launch gives 7-day point-in-time recovery, which `DEPLOYMENT.md` requires. Neon Free's
  6-hour window isn't enough for production.
- Fully compatible: the Docker image or `npm start` on Render; on Neon, the **pooled** URL as
  `DATABASE_URL` for the app and the **direct** URL for `npm run db:deploy`, `db:backup` and
  restores.
- Lowest-cost alternative: Fly.io Machines + Neon. A higher-convenience alternative: Render
  for both app and Postgres (Pro workspace for 7-day PITR).

Not recommended for the beta: any free app tier that sleeps (first request takes about 1 min),
Neon Free (no adequate restore window), Vercel Hobby (non-commercial terms).

## Review (M9, 2026-11-11)

The recommendation stands: Render Starter with Neon Launch. Nothing was purchased or
provisioned. Since the original research, the app also:

- reports migration state on `/api/health`, so point the platform's health check there;
- needs `REGISTRATION_MODE` left unset (invite-only);
- should run `npm run db:check-migrations` before `npm run db:deploy` in the release step.

The Neon free tier is still unsuitable for production (a 6-hour restore window). Re-check the
prices on the providers' own pages before signing up; the figures above date from 2026-11-10.

## Compatibility checklist

- [x] Node 24 / Docker image (CI builds it)
- [x] Health check path: `/api/health`
- [x] `TRUSTED_PROXY_HOPS=1` behind Render, Railway or Fly edge proxies (check each
      platform's `X-Forwarded-For` behaviour after first deploy with a test request)
- [x] Migrations as a release step (`npm run db:deploy`), not at container start
- [x] Shared rate limiting in PostgreSQL (multi-instance safe)
- [ ] Region chosen near testers (owner)
- [ ] Custom domain and HTTPS (owner)

## Sources

- [Neon pricing (official)](https://neon.com/pricing)
- [Render free tier docs (official)](https://render.com/docs/free)
- [Render Postgres backups (official)](https://render.com/docs/postgresql-backups)
- [Render pricing 2026 (third-party)](https://www.activepieces.com/blog/render-pricing-2026-free-tier-workers-total-cost.md)
- [Railway pricing 2026 (third-party)](https://temps.sh/blog/railway-pricing-2026)
- [Fly.io pricing (official)](https://fly.io/pricing.md) and [Fly.io pricing 2026 (third-party)](https://temps.sh/blog/fly-io-pricing-2026)
- [Vercel Hobby plan (official)](https://vercel.com/docs/plans/hobby)
- [Supabase pricing (official)](https://supabase.com/pricing.md) and [Supabase pricing guide 2026 (third-party)](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)
