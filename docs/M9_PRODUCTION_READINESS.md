# M9 production and beta readiness (2026-11-11)

Branch: `feature/m9-production` (built on M8). **Nothing was deployed, purchased or
provisioned.** No real users were invited and no credentials were used. This document records
what is ready, what was verified locally, and what still needs the owner.

## Implemented in M9

| Area                     | What                                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Invite-only beta**     | `REGISTRATION_MODE` defaults to `invite` in production. Admin → Invites (Super Admin only) creates codes (shown once; only hashes stored), sets uses and expiry, and revokes them. Redemption is atomic and audited (D-041).                                                    |
| Configuration validation | The existing start-up check (`src/lib/env.ts`) now also warns when registration is open in production. Fatal problems stop the server from starting.                                                                                                                            |
| Safe migrations          | `npm run db:check-migrations`: no destructive or rollout-breaking SQL without an explicit, reasoned allowance, and no edits to migrations already on the base branch. Expand, then contract (D-042). Runs in CI.                                                                |
| CI                       | Added a production dependency audit (`npm audit --omit=dev --audit-level=high`) and the migration check. Dependabot sends weekly update PRs. Existing jobs: lint, format, types, unit, integration, backup drill, build, e2e, smoke, Docker.                                    |
| Health                   | `/api/health` also reports `migrations` and returns 503 while a migration is unfinished or failed.                                                                                                                                                                              |
| Logging                  | One structured JSON line per API request (method, path, status, ms). Emails, tokens and URL credentials are redacted (D-043). Error reporting is unchanged (stdout plus optional Sentry/GlitchTip).                                                                             |
| Operations visibility    | Admin → Operations:<br>- database latency, migration state, configuration warnings (names only)<br>- registration mode and invites, learners active this week<br>- untriaged feedback age<br>- stuck and rejected offline syncs, with reasons<br>- pilot samples, audit-log age |
| Retention                | `npm run ops:prune` (a dry run by default) for audit entries, processed sync events and expired rate-limit buckets. Periods are explicit and have minimums; an applied prune is audited.                                                                                        |
| Security headers         | Added COOP and CORP `same-origin`. The CSP decision was reviewed and kept (SECURITY.md, limitation 1).                                                                                                                                                                          |
| Abuse protection         | A rate limit on the public stroke-data route. The rate-limit table is in SECURITY.md.                                                                                                                                                                                           |
| Backup and recovery      | The local drill was re-run after the new migrations: every table matched and 69 foreign keys were checked with 0 orphans. A foreign-key cycle that would have broken restores was caught and removed before shipping.                                                           |
| Docs                     | DEPLOYMENT.md: environments, `REGISTRATION_MODE`, migration workflow, rollback including failed migrations, monitoring, retention. SECURITY.md, HOSTING.md review, DECISIONS D-041 to D-043, CLAUDE.md.                                                                         |

## Production readiness checklist

✅ means done and verified locally. ☐ means the owner must do it.

**Code and pipeline**

- ✅ Lint, format, types, 150 unit, 79 integration and 31 Chromium e2e tests pass (WebKit in
  PROGRESS.md).
- ✅ The production build passes. The smoke test passes 8/8 against a local production
  server.
- ✅ No production dependency vulnerabilities (`npm audit --omit=dev`).
- ✅ All migrations are additive. The migration safety check passes against `origin/main`.
- ✅ Invite-only registration is enforced on the server and is the production default
  (checked on a production start).
- ☐ **CI green on GitHub** for each PR. This session can't see GitHub Actions.
- ☐ **Merge M6 → M7 → M8 → M9** in order, with merge commits.

**Infrastructure** (see HOSTING.md and DEPLOYMENT.md)

- ☐ Create hosting and database accounts (recommended: Render Starter and Neon Launch).
  Choose a region near the testers.
- ☐ Set the secrets in the host's secret store: `AUTH_SECRET` (new, 32+ characters),
  `AUTH_URL`, `DATABASE_URL` (pooled), `TRUSTED_PROXY_HOPS`, optionally `SENTRY_DSN`, and
  `APP_RELEASE`. Leave `REGISTRATION_MODE` unset.
- ☐ From a trusted machine, run `npm run db:check-migrations`, `npm run db:deploy` (direct
  URL) and `npm run db:seed` with a temporary `SEED_ADMIN_*`. Remove those variables
  afterwards.
- ☐ Deploy, then run `npm run smoke -- https://<domain>`. Check that `/api/health` shows
  `migrations: ok`.
- ☐ Point an uptime monitor at `/api/health`, and the platform health check too.
- ☐ Custom domain and HTTPS. Check `X-Forwarded-For` handling with one test request.
- ☐ **Production recovery drill** (DEPLOYMENT.md). Record the date and timings in PROGRESS.md.
- ☐ Decide the retention periods, then schedule `npm run ops:prune -- … --apply`.

**Legal and people**

- ☐ Fill in the legal placeholders and have the privacy notice, terms and consent text
  reviewed (LEGAL_REVIEW.md). They are drafts and must not be presented as approved.
- ☐ Decide the minimum age and the data-export approach. Sign the providers' data
  processing agreements.
- ☐ Run the five-tester handwriting pilot (HANDWRITING_PILOT.md) **before** making any accuracy
  claim.
- ☐ Test on physical phones and tablets, with a stylus, in Firefox, and with a screen reader.
- ☐ Get a teacher review of the curriculum (everything is PROVISIONAL).
- ☐ Only then: create invites for the first testers (Admin → Invites) and share the beta
  guide.

## External actions requiring owner approval

1. Spending money: hosting, database, domain, and optionally error tracking.
2. Creating accounts with providers and accepting their terms and DPAs.
3. Generating and storing production secrets.
4. Running migrations and the seed against the production database, and the first deploy.
5. Publishing the legal documents once reviewed, and changing `LEGAL_VERSION` if needed.
6. Inviting real people, and collecting their handwriting with consent.
7. Opening registration (`REGISTRATION_MODE=open`), which should come only after all of the
   above.
8. Merging the M6–M9 pull requests.

## Known risks still open

- Handwriting accuracy on real learners is unmeasured, so there is no accuracy claim.
- CSP allows inline scripts (documented trade-off).
- There is no email verification or staff 2FA. Password reset is staff-issued links (fixed
  in the integration audit, D-045); emailed resets need an email provider.
- A moderate advisory remains in a lint-only dev dependency.
- Firefox, physical devices and real screen readers are untested. CI now has an advisory
  Firefox step (integration audit).
- ~~Testing out by placement opens lessons without scheduling writing reviews~~: fixed in the
  integration audit (D-044).

See `docs/INTEGRATION_AUDIT.md` for the state after the integration audit.
