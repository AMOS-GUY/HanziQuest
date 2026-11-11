# M11 staging configuration and security review (2026-11-11)

The template is `.env.staging.example` (placeholders only). Production's variables are in
DEPLOYMENT.md. **No real staging values exist yet.**

## Variables

Secret = must never appear in git, logs, screenshots or chat. Differs = the staging value must
differ from production's.

| Variable                                                     | Purpose                                                                                                                                                 | Required                   | Secret                                                    | Lives in                                             | Differs                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------- | ---------------------------------------------------- | ----------------------------- |
| `NODE_ENV`                                                   | production runtime                                                                                                                                      | yes (`production`)         | no                                                        | Render (Blueprint)                                   | same                          |
| `APP_ENV`                                                    | Names the deployment. Drives the banner, `env` in logs, the health `environment`, and the database marker check. Fatal if missing or invalid on Render. | yes                        | no                                                        | Render (Blueprint)                                   | **yes** (`staging`)           |
| `DATABASE_URL`                                               | The app's **pooled** Neon URL (`-pooler` host, `sslmode=require`)                                                                                       | yes, fatal                 | **yes**                                                   | Render                                               | **yes** (staging project)     |
| `DATABASE_POOL_MAX`                                          | Connections per instance (1–100; fatal outside)                                                                                                         | no (3 on staging)          | no                                                        | Render (Blueprint)                                   | may                           |
| `MIGRATE_DATABASE_URL` / `DIRECT_DATABASE_URL`               | The **direct** URL for migrations, backups and the guard. Not set on Render.                                                                            | yes, for the workflows     | **yes**                                                   | GitHub `staging` environment (`DIRECT_DATABASE_URL`) | **yes**                       |
| `AUTH_SECRET`                                                | Session signing. At least 32 characters; the placeholder and `REPLACE_ME` values are fatal.                                                             | yes, fatal                 | **yes**                                                   | Render                                               | **yes**                       |
| `AUTH_URL`                                                   | The public https origin                                                                                                                                 | yes, fatal (https)         | no                                                        | Render                                               | **yes**                       |
| `AUTH_TRUST_HOST`                                            | Lets Auth.js trust Render's proxy host. Fatal unless `true`.                                                                                            | yes                        | no                                                        | Render (Blueprint)                                   | same                          |
| `TRUSTED_PROXY_HOPS`                                         | How many `X-Forwarded-For` hops to trust, for the client IP (fatal outside 0–5)                                                                         | yes (`1`)                  | no                                                        | Render (Blueprint)                                   | same, verified per deployment |
| `REGISTER_LIMIT_PER_HOUR`                                    | Registrations per IP per hour (default 5; a warning above 50)                                                                                           | no (`20` on staging)       | no                                                        | Render                                               | **yes**                       |
| `REGISTRATION_MODE`                                          | Unset means invite-only. `open` is **fatal on staging**.                                                                                                | must be unset              | no                                                        | —                                                    | —                             |
| `PASSWORD_RESET_LINKS`                                       | Unset means off (D-047; the procedure isn't approved)                                                                                                   | must be unset              | no                                                        | —                                                    | —                             |
| `APP_RELEASE`                                                | Release id. Unset on Render, which falls back to `RENDER_GIT_COMMIT`.                                                                                   | no                         | no                                                        | —                                                    | —                             |
| `SENTRY_DSN`                                                 | Optional error reporting; use a separate staging project                                                                                                | no                         | treat as secret                                           | Render                                               | **yes**                       |
| `DEPLOY_HOOK_URL`                                            | Render deploy hook of the **staging** service                                                                                                           | for deploys                | **yes** ("Your deploy hook URL is a secret", Render docs) | GitHub `staging` environment                         | **yes**                       |
| `APP_URL`                                                    | The staging origin, used by the workflow's readiness wait and smoke test                                                                                | for deploys                | no                                                        | GitHub `staging` environment                         | **yes**                       |
| `BACKUP_AGE_RECIPIENT`                                       | The **staging** `age` public key                                                                                                                        | for deploys and backups    | public key (keep the private key secret)                  | GitHub `staging` environment                         | **yes**                       |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`                   | First staging admin, once                                                                                                                               | first seed only            | password: **yes**                                         | the owner's shell, then cleared                      | **yes**                       |
| `STAGING_BASE_URL`, `STAGING_INVITE_CODE`, `STAGING_ADMIN_*` | Acceptance suite inputs                                                                                                                                 | for `npm run test:staging` | invite and password: **yes**                              | the owner's machine                                  | —                             |

Email: HanziQuest sends no email (no provider). Staging must not send any. Render Free blocks
SMTP ports 25, 465 and 587 anyway.

## Start-up fails safely (verified locally)

The start-up check runs in `instrumentation-node.ts` and exits with status 1 on any fatal
problem, so Render marks the deploy failed and the previous release keeps serving.

| Case                                                                                                                                     | Result (local `next start`, production build)                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placeholder `AUTH_SECRET`                                                                                                                | exit 1 (M10, re-run in M11)                                                                                                                                    |
| `APP_ENV=staging` with `REGISTRATION_MODE=open`                                                                                          | exit 1, `Invalid configuration: REGISTRATION_MODE`                                                                                                             |
| Missing `APP_ENV` on Render, `REPLACE_ME` values, a non-PostgreSQL URL, an out-of-range pool or proxy hops, `AUTH_TRUST_HOST` not `true` | fatal; unit tests (`tests/unit/operations.test.ts`)                                                                                                            |
| Production app on a database marked `staging`                                                                                            | serves, but readiness returns **503** `databaseEnvironment: mismatch`. Render keeps the old release; the deploy workflow refuses earlier, in `db:environment`. |

## Secure cookies behind Render's proxy

Auth.js chooses secure cookies with `useSecureCookies ?? url.protocol === "https:"`, where
`url` comes from `AUTH_URL` and trusted forwarding headers (`@auth/core/lib/init.js`). With an
https `AUTH_URL`, the session cookie is `__Secure-authjs.session-token` with `Secure`,
`HttpOnly`, `SameSite=Lax` and `Path=/`. Render terminates TLS and forwards to the app over
HTTP, which is why `AUTH_TRUST_HOST=true` is required.

**Unverified until a real https deploy.** The acceptance suite asserts the cookie name and
flags whenever `STAGING_BASE_URL` is https. Locally it ran over http, so that assertion was
skipped by design.

## Client IP and rate limits behind the proxy

`ipFromHeaders` takes the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` positions from the right
(default 1: the entry appended by Render's proxy). Entries further left come from the client
and can be forged, so they're ignored. Rate limits (login, registration, reset, client errors)
key on that IP and are shared through PostgreSQL. Render's documentation read in this session
doesn't describe its header chain.

**Verify on the first staging deploy** (M11_STAGING_ACCEPTANCE.md, manual check 2): the audit
log's `user.login` IP must equal the tester's public IP. If it shows a Render or Cloudflare
address, raise `TRUSTED_PROXY_HOPS` by one and redeploy. Never set it higher than the real
number of proxies, or clients can choose their own IP.

## Provisioning steps (owner, after approval)

These are the exact actions behind approvals 1–7 in M11_STAGING_ARCHITECTURE.md. **None has
been done.**

1. **Neon:**
   - Create a project named `hanziquest-staging`, Free plan, region near the chosen Render
     region, PostgreSQL 17 (or 16).
   - Settings → Compute: maximum 0.25 CU.
   - Copy the **pooled** and **direct** URLs into the password manager, labelled STAGING.
2. **Backup key:**
   - On your machine, run `age-keygen -o hanziquest-staging-backup.key`.
   - Store the file offline and in the password manager.
   - The printed `age1…` public key is `BACKUP_AGE_RECIPIENT`.
   - This must not be the production key.
3. **GitHub environment:** Settings → Environments → New, `staging`:
   - required reviewers: you
   - prevent self-review: off (you are the only reviewer)
   - deployment branches: `main` only
   - **Create and protect it before adding any secret.**
4. **Render:**
   - New → Blueprint → this repository, with the Blueprint path `render.staging.yaml`. If
     there is no path option, create a Web Service by hand: Docker, Free, the chosen region,
     branch `main`, auto-deploy **off**, health check path `/api/health`, and the environment
     variables from the template.
   - Enter `DATABASE_URL` (pooled), `AUTH_SECRET` (new: `openssl rand -base64 32`), `AUTH_URL`
     (the service URL) and `REGISTER_LIMIT_PER_HOUR=20`.
   - Settings → Deploy Hook: copy it.
   - The service's first automatic build happens without migrations, so readiness reports 503
     until step 6. That is expected.
5. **GitHub secrets** on `staging`: `DEPLOY_HOOK_URL`, `APP_URL`, `DIRECT_DATABASE_URL`,
   `BACKUP_AGE_RECIPIENT`.
6. **First deploy:**
   - Actions → Deploy staging (manual): the full SHA of the merged M11 commit and
     `deploy staging`.
   - Approve the job. It refuses unless the database is empty or already marked staging, backs
     it up, migrates, marks it `staging`, deploys the SHA, and waits for readiness and the smoke
     test.
7. **Seed and admin.** From your machine, at the deployed commit:
   ```bash
   DATABASE_URL="<staging DIRECT url>" SEED_ADMIN_EMAIL="<you>+staging-admin@<your domain>" \
     SEED_ADMIN_PASSWORD="<generated, saved in the password manager>" npm run db:seed
   ```
   Then clear your shell history entry (`history -d` or close the terminal).
   - Sign in on staging and change the password once.
   - Admin → Invites: create a 1-day, 10-use invite labelled `acceptance`.
8. **Acceptance:** follow M11_STAGING_ACCEPTANCE.md.

Re-purposing a marked database (rare, deliberate): only by hand, in SQL, after a backup.
`db:environment` never changes a marker.

## Staging security review (Phase F)

| Area                      | How it is protected                                                                                          | Evidence                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Login and logout          | Auth.js credentials, bcrypt, constant-time compare; logout clears the session                                | e2e `auth-journey`; staging suite (local rehearsal)                             |
| Session persistence       | 30-day JWT. `issuedAt` is fixed at sign-in; the role and status are read from the database on every request. | e2e `session-security`; staging suite                                           |
| Session revocation        | `credentialsChangedAt` ends older sessions (password change, reset)                                          | e2e and the staging suite: another device is signed out after a password change |
| Secure cookies            | `__Secure-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` when `AUTH_URL` is https                            | code review; the staging suite asserts it on https (**not yet run on https**)   |
| Callback URLs             | Auth.js derives them from `AUTH_URL`; `safeRedirectPath` only allows same-site paths                         | code review; unit tests                                                         |
| RBAC and admin protection | `proxy.ts` returns 404 for non-staff on `/admin`; pages `requirePagePermission`; actions `assertPermission`  | unit `permissions`; e2e; staging suite: learner 404, admin 200                  |
| API authorization         | Session user only; another user's ids rejected                                                               | integration; staging suite: anonymous 401/403                                   |
| Rate limiting             | PostgreSQL store; login 10 per 15 min per email and IP, 30 per hour per email; registration per IP           | unit `rate-limit`; staging suite: the limiter triggers on a synthetic address   |
| CSRF and origin           | Next's server-action origin check; `handleApi` origin check; Auth.js CSRF token                              | unit `api-boundary`; staging suite: a cross-site POST gets 403                  |
| Invite-only               | Production default; `open` fatal on staging                                                                  | integration `invites`; e2e; staging suite                                       |
| Reset links               | Off (unset); the admin card says "Turned off"                                                                | unit and integration; staging suite                                             |
| Error redaction           | Generic 500s; logs mask emails and tokens and drop secret fields; error reports strip query strings          | unit `api-boundary`; staging suite: health contains no connection details       |
| Private data isolation    | Every query is scoped to the session user; offline data is per account                                       | integration; e2e `offline-accounts`; staging suite                              |
| Environment isolation     | `APP_ENV` and `DeploymentMarker`                                                                             | drills, integration, local rehearsal                                            |

No new authentication policy was introduced. The changes are stricter start-up checks and
readiness conditions only.
