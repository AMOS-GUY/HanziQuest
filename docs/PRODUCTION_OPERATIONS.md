# Production operations

Day-to-day running of the invite-only beta. **Not in use yet: there is no production.**
Written for one owner and a few staff. Related: DEPLOYMENT.md, ROLLBACK.md,
DATABASE_BACKUP.md, SECURITY.md.

## Post-deploy checklist (first deploy, then after platform or configuration changes)

These can't be verified locally over plain http, so check them on the real service:

- [ ] `/api/health` reports `"status":"ok"`, `"migrations":"ok"` and the deployed `release`.
- [ ] `npm run smoke -- https://<origin>` passes.
- [ ] **Secure cookies:**
  - after signing in, the browser's dev tools show the session cookie as
    `__Secure-authjs.session-token` with `Secure`, `HttpOnly` and `SameSite=Lax`;
  - there is no session cookie without the `__Secure-` prefix.
- [ ] **HTTPS only:**
  - `http://` redirects to `https://` (Render does this);
  - `Strict-Transport-Security` is present.
- [ ] **Client IP (rate limits):** sign in once, then check Admin → Audit logs → `user.login`.
      The IP must be your own public IP, not Render's proxy. If it isn't, adjust
      `TRUSTED_PROXY_HOPS` and redeploy.
- [ ] **Admin isolation:** signed out, `/admin` redirects to `/login`. As a learner, `/admin`
      returns 404.
- [ ] **Invite-only and reset links off:** Admin → Operations shows registration "invite" and
      no `PASSWORD_RESET_LINKS` warning. On the user page, the reset card says "Turned off".
- [ ] **Start-up warnings:** the deploy log has no `[config]` lines except an expected
      `SENTRY_DSN` notice, if Sentry isn't set up.
- [ ] **Service worker:** after one visit, DevTools → Application → Cache Storage holds only
      `hq-sw-…-shell` (offline pages, manifest, icons) and `hq-sw-…-assets` (`/_next/static`).
      It must hold no signed-in page and no `/api` response.

## Monitoring

| Signal        | Where                                                                                                                                     | Alert                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Readiness     | External uptime monitor on `GET /api/health` (every 1–5 min)                                                                              | non-200 for 2 checks → owner                               |
| Deploy health | Render events: a failed deploy or health check                                                                                            | Render notification (email)                                |
| Errors        | Sentry or GlitchTip if `SENTRY_DSN` is set; otherwise Render logs (`"level":"error"` JSON lines). Query strings and secrets are stripped. | new issue → owner                                          |
| Request log   | `api.request` lines: method, path without query, status and ms. No bodies or user ids; emails and tokens are masked.                      | —                                                          |
| App state     | Admin → Operations: DB latency, migrations, config warnings, sync backlog, feedback backlog                                               | daily glance during the beta                               |
| Workflows     | GitHub emails on a failed deploy (staging or production) or backup.yml run                                                                | —                                                          |
| Spend         | Render and Neon billing pages                                                                                                             | set spending alerts where offered; check the first invoice |

## Incident response

1. **Detect:** an alert, a tester report (in-app feedback, BUG_REPORTING.md) or a failed
   workflow.
2. **Assess** (5 minutes):
   - What is affected? Login, learning, sync, admin.
   - How many people?
   - Is data at risk?
   - Check `/api/health`, Render events and logs, and Admin → Operations.
3. **Contain:**
   - Roll back the app (ROLLBACK.md).
   - If accounts are compromised, suspend them (Admin → Users). Rotating `AUTH_SECRET` signs
     everyone out. Changing a user's password signs that user out.
   - If secrets leaked, rotate them (below).
4. **Recover:** fix forward or recover data (ROLLBACK.md, "Data recovery").
5. **Communicate:** tell affected testers what happened and what they need to do. A personal
   data breach may have legal reporting duties; the owner checks with the legal reviewer
   (LEGAL_REVIEW.md) without delay.
6. **Record** in the incident log below: time, impact, cause, actions and follow-ups.

## Secret rotation

| Secret             | How                                                                                                                                      | Effect                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `AUTH_SECRET`      | New value in Render, then redeploy                                                                                                       | Every session ends; everyone signs in again |
| Database password  | Reset it in Neon, update `DATABASE_URL` (Render) and `DIRECT_DATABASE_URL` (GitHub environment), then redeploy                           | Short reconnect                             |
| Render deploy hook | Regenerate it in Render, update the GitHub secret                                                                                        | None                                        |
| Backup key         | New `age-keygen`, update `BACKUP_AGE_RECIPIENT`; **keep the old private key** until all backups encrypted with it have expired (30 days) | None                                        |
| `SENTRY_DSN`       | Rotate it in Sentry                                                                                                                      | None                                        |

## Scheduled tasks

| Task                    | How                                                                                                                                                                                     | When                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Off-site backup         | backup.yml (schedule enabled after the first manual run)                                                                                                                                | weekly                                                  |
| Restore drills          | DATABASE_BACKUP.md                                                                                                                                                                      | quarterly                                               |
| Retention prune         | `npm run ops:prune -- --audit-days <n> --sync-days <n>` is a dry run; add `--apply`. Run it from a trusted machine with the direct URL, or as a Render cron job (paid; owner's choice). | monthly, once the periods are decided (LEGAL_REVIEW.md) |
| Reset-link audit review | Admin → Audit logs, `user.password.reset_link`                                                                                                                                          | weekly, _if_ reset links are ever approved              |
| Dependency updates      | Dependabot PRs. Patch and minor: merge after green CI. **Major: one at a time, read the changelog, CI and local e2e, owner approval** (M10_INFRASTRUCTURE_AUDIT.md section 5).          | weekly                                                  |

`ops:prune` deletes:

- audit entries older than `n` days (they hold IPs and user agents)
- processed sync events older than `n` days
- expired rate-limit buckets
- used or expired reset links

The minimums are 30 and 7 days. An applied prune is itself audited.

## Capacity

The beta starts on one 512 MB instance and the smallest Neon compute. Signals to scale:

- p95 `api.request` above 1 s
- memory restarts in Render events
- Neon CPU sustained above 70%

Before adding instances, keep instances × `DATABASE_POOL_MAX` below the pooler's limit. Rate
limits are already shared through PostgreSQL.

## Incident log

None yet.
