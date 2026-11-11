# M11 staging acceptance (2026-11-11)

Repeatable checks for a deployed staging server. **Staging doesn't exist yet**, so every
"result" below is from a **local staging rehearsal**: a production build with
`APP_ENV=staging`, served over http on a fresh local database that was migrated, seeded and
marked `staging` with `db:environment`. These are not results from Render or Neon.

## Automated suite: `npm run test:staging`

`playwright.staging.config.ts` and `tests/staging/`. HTTP only: no database access, no local
server. Global setup:

- waits up to 3 minutes for a free instance to wake;
- **refuses any server that reports `environment: production`**;
- checks the required inputs.

```bash
STAGING_BASE_URL=https://<staging origin> \
STAGING_INVITE_CODE=<1-day, 10-use invite labelled "acceptance"> \
STAGING_ADMIN_EMAIL=<staging admin> STAGING_ADMIN_PASSWORD=<…> \
npm run test:staging
```

Each run creates three synthetic learners (`staging-check-<run>-…@example.test`) through the
invite, and makes 2 refused registration attempts. With `REGISTER_LIMIT_PER_HOUR=20` that
allows several runs an hour from one IP.

| #   | Test                                                                    | Covers                                                                                                                       | Local rehearsal                   |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | infrastructure: liveness, readiness, environment and release            | Liveness; readiness (database, migrations, `databaseEnvironment`); release id; no connection details in health output        | pass                              |
| 2   | infrastructure: security headers and the staging banner                 | CSP, nosniff, no `x-powered-by`; HSTS (on https only); the "Staging" banner                                                  | pass (HSTS skipped: http)         |
| 3   | security: anonymous visitors can't reach protected pages or APIs        | protected routes go to login; `/admin` too; API 401/403; a cross-site POST gets 403                                          | pass                              |
| 4   | security: registration is invite-only                                   | no code and a wrong code are refused                                                                                         | pass                              |
| 5   | security: wrong passwords are refused, then rate limited                | invalid authentication; the login limiter (synthetic address)                                                                | pass                              |
| 6   | application: invited learner registers, onboards and sees the dashboard | invite registration, onboarding, dashboard; secure cookie flags (on https only)                                              | pass (cookie flags skipped: http) |
| 7   | application: learning path, lesson, writing, review and progress        | learning path, lesson navigation, character writing (graded Good or Excellent), review page, progress (XP > 0)               | pass                              |
| 8   | security: a learner gets 404 on admin pages and admin APIs              | RBAC on `/admin`, `/admin/users`, `/admin/operations`; admin API refused                                                     | pass                              |
| 9   | offline: download, practise offline, sync once, no duplicates           | download a lesson, go offline, open it, record an attempt, reconnect, sync; XP unchanged after another sync pass             | pass                              |
| 10  | offline: another account on the same device sees nothing of the first   | sign-out clears downloads; "Not signed in"; the second account has no downloads and 0 XP                                     | pass                              |
| 11  | security: logout, session persistence and revocation on password change | persistence across reloads; a password change signs out the other device                                                     | pass                              |
| 12  | administration: staff sign-in, curriculum, content, feedback and users  | admin login; overview, curricula, lessons, characters, feedback, users, operations; invite-only shown; the reset card is off | pass                              |

**Local rehearsal run (2026-11-11): 12 passed, 0 failed, in 49 s** (after one selector fix in
test 11). Chromium only.

## Covered elsewhere (can't be tested against a live server)

| Check                                                      | Where                                                                                                                                               |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending migration detection                                | `npm run drill:migrations` (503 `pending`), unit and integration tests                                                                              |
| Failed migration and recovery                              | `npm run drill:migrations`                                                                                                                          |
| Database unavailable                                       | `npm run drill:migrations` (fast 503 `unavailable`)                                                                                                 |
| Graceful shutdown                                          | CI `docker` job: SIGTERM, stops within 15 s. Render waits up to `maxShutdownDelaySeconds` (production 30 s). **Not observed yet (CI not visible).** |
| Container starts as non-root, refuses a placeholder secret | CI `docker` job (**not observed yet**)                                                                                                              |
| Backup, restore and tampering                              | `npm run drill:backup`; `backup.yml` on staging after approval                                                                                      |

## Manual checks on the first real staging deploy

1. **Deploy record:** the `deploy-staging.yml` summary shows the SHA, the release reported by
   `/api/health`, the backup artifact and "success".
2. **Client IP:** sign in as the staging admin, then check Admin → Audit logs → `user.login`.
   The IP must be your public IP (search "what is my IP"). If not, see
   M11_STAGING_CONFIGURATION.md.
3. **Cookies:** the suite asserts them on https. Also check in DevTools → Application →
   Cookies: `__Secure-authjs.session-token`, Secure, HttpOnly, Lax.
4. **Service worker cache:** DevTools → Application → Cache Storage holds only
   `hq-sw-…-shell` and `hq-sw-…-assets` (no signed-in pages, no `/api`).
5. **Logs:** Render logs show JSON lines with `"env":"staging"`. Search for `@`, `password`
   and `token=`: no emails, passwords or tokens should appear.
6. **Failed-deploy drill:**
   - Set `APP_ENV` to `qa` in Render and redeploy the same SHA through the workflow.
   - Expect the deploy to fail (start-up exit), the workflow to fail with the last health
     response, and the previous release to keep serving.
   - Set `APP_ENV` back to `staging`.
7. **Restore drill:**
   - Run `backup.yml` with `environment: staging`.
   - Download the artifact and decrypt it with the staging key.
   - `db:restore` into a scratch database, then `db:verify --backup` (DATABASE_BACKUP.md).
8. **Wrong-database guard:**
   - Temporarily point the GitHub `staging` secret `DIRECT_DATABASE_URL` at a scratch database
     that has accounts but no marker (for example, a restore from step 7).
   - Dispatch a deploy. It must stop at "Database belongs to this environment".
   - Restore the secret.

Record the results, dates and release ids in the log below.

## Results log

| Date       | Where                             | Release         | Result                                                                                             |
| ---------- | --------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| 2026-11-11 | **local rehearsal** (not staging) | `m11-rehearsal` | suite 12/12; production-on-staging-database 503 `mismatch`; staging with open registration exits 1 |
| —          | staging (Render and Neon)         | —               | **not run: no staging exists yet**                                                                 |
