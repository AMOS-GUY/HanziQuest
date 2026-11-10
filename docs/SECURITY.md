# Security

## In place (M1)

| Control          | Implementation                                                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage | bcrypt, cost 12 (`src/lib/auth/password.ts`). Sign-in compares against a dummy hash when the email is unknown, keeping response timing similar.                                                            |
| Sessions         | Auth.js v5 JWT in an HTTP-only cookie, signed with `AUTH_SECRET`, 30-day lifetime. The JWT holds only the user id.                                                                                         |
| Account status   | Every server-side check reloads the user. Non-`ACTIVE` users are treated as signed out.                                                                                                                    |
| Authorization    | Role → permission map (`src/lib/permissions`). Pages use `requirePagePermission` (404 when denied). Server actions use `assertPermission` (401/403). Hidden buttons are never relied on.                   |
| Role safety      | Only Super Admins can grant or revoke Super Admin. Admins can't remove their own Super Admin role. The last Super Admin can't be removed. LEARNER can't be removed.                                        |
| Input validation | Zod schemas on every action and in services (`src/lib/validation`).                                                                                                                                        |
| Rate limiting    | Sign-in: 10 per 15 min per email+IP and 30 per hour per email. Registration: 5 per hour per IP. Learning writes: 120 per min. Admin mutations: 60 per min per user. Shared PostgreSQL store in production. |
| Audit log        | Registration, sign-in, lesson publish/unpublish and role grants/revocations, written in the same transaction as the change, with IP and user agent.                                                        |
| Content history  | A `ContentRevision` snapshot is stored before every publish/unpublish.                                                                                                                                     |
| Open redirects   | `callbackUrl` is restricted to same-origin relative paths (`safeRedirectPath`).                                                                                                                            |
| Headers          | CSP (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive Permissions-Policy. `X-Powered-By` is removed.    |
| Data exposure    | Admin queries `select` explicit fields and never return `passwordHash`. The Prisma client is `server-only`.                                                                                                |
| Secrets          | `.env` is git-ignored. `.env.example` lists every variable with no real values. CI generates a throwaway `AUTH_SECRET`.                                                                                    |

### Learning data (M2)

- Handwriting results are **computed on the server** from raw strokes. Client-sent scores and
  results are ignored.
- Attempt replay is idempotent (`clientEventId` is unique). Reusing another user's id returns 409.
- Attempts are accepted only for published exercises in published lessons, with a bounded
  payload and timestamp. Locked lessons can't be started.
- Placement answers are graded on the server from a question plan derived from the assessment
  id. Correct answers are never sent to the browser.
- Guided-practice mistake counts are client-reported and labelled as such. They never count
  as independent recall and earn half XP.

### Progress and offline (M3)

- XP, mastery, streaks and achievements are computed only on the server from server-evaluated
  attempts. Any XP or score in a request body is ignored, and an integration test sends one to
  prove it.
- XP grants are idempotent (unique keys). Repeating an exercise earns XP at most 3 times per
  day, with a daily cap, so XP can't be farmed.
- Offline sync re-runs the same validation and evaluation as online submission. Events are
  idempotent by id, another user's event id is rejected, and the batch size is bounded.
- Offline data in the browser is isolated by account and cleared at sign-out (see
  `docs/OFFLINE.md`).

## M4 audit (2026-11-10)

Reviewed: authentication, sessions, passwords, RBAC, admin operations, API authorization, input
validation, rate limiting, audit logging, offline sync, database constraints, error handling,
environment variables and production configuration.

### Fixed in M4

| Finding                                                                                                                                                                                    | Fix                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The client IP for rate limiting came from the **left-most** `X-Forwarded-For` entry, which the client controls, so the per-IP sign-in and sign-up limits could be bypassed by spoofing it. | The entry appended by the trusted proxy is used (`TRUSTED_PROXY_HOPS`, default 1). Unit tested.                                                                                                                                                             |
| Sign-in was limited per email+IP only, so attempts spread across many IPs weren't capped.                                                                                                  | An added limit of 30 attempts per hour per email.                                                                                                                                                                                                           |
| Rate limits were in memory, per instance.                                                                                                                                                  | Shared PostgreSQL store (`RateLimitBucket`, atomic upsert), the default in production, with a memory fallback if the database is unavailable. The integration test found a time-zone bug (comparing a UTC timestamp with the session's `now()`), now fixed. |
| A JWT stayed valid after a password change.                                                                                                                                                | Password change sets `credentialsChangedAt`, and sessions issued before it are rejected on every request and in the admin gate.                                                                                                                             |
| Route handlers read request bodies with no size limit.                                                                                                                                     | `readJson` caps every body (256 KB per attempt, 4 MB per sync batch, 8 KB per client error), even without `Content-Length`. It returns 413, and the sync client shrinks its batches.                                                                        |
| Cross-site POSTs to JSON route handlers relied only on SameSite cookies.                                                                                                                   | `handleApi` rejects requests whose `Origin` isn't this host or `AUTH_URL` (403). Server actions already have Next's origin check.                                                                                                                           |
| Admin page titles leaked in 404 responses to learners (M1 limitation).                                                                                                                     | `src/proxy.ts` gates `/admin/**` before rendering: signed out goes to login; non-staff, suspended or revoked sessions get a bare 404. An e2e test checks the status and the title.                                                                          |
| Learners were sent Draft or Archived exercises, which the server then refused, so such a lesson could never be completed.                                                                  | Practice payloads and completion rules use published exercises only.                                                                                                                                                                                        |
| No moderation tools (M1 limitation).                                                                                                                                                       | Suspend and reactivate with a reason (`users:moderate`). Self-moderation is blocked, only Super Admins can moderate staff, and every change is audited.                                                                                                     |
| No self-service account controls.                                                                                                                                                          | Change password (current password required, rate limited), account deletion (password plus typing DELETE; the last Super Admin is protected), profile settings. All audited.                                                                                |
| Offline data survived sign-out (M3 limitation).                                                                                                                                            | Account isolation (see OFFLINE.md), tested in a real browser.                                                                                                                                                                                               |
| Unhandled errors were only logged to the console.                                                                                                                                          | Structured JSON error logs plus optional Sentry or GlitchTip reporting, with secrets redacted from messages and stack traces. Error boundaries report client crashes through a rate-limited endpoint.                                                       |
| A misconfigured production server could start.                                                                                                                                             | Start-up configuration check: fatal for a missing or short `AUTH_SECRET`, a missing `DATABASE_URL`, or a non-https `AUTH_URL`.                                                                                                                              |

### Reviewed and acceptable for beta

bcrypt cost 12 with a constant-time unknown-email path. Role changes and suspensions apply on
the next request. All admin mutations and curriculum edits are audited in the same transaction,
with content revisions. Zod validation on every action and route. Unique constraints give
idempotency (`clientEventId`, `SyncEvent.id`, `XPTransaction.idempotencyKey`). Handwriting
samples store a pseudonymous participant code only. Prisma queries are parameterised; the only
raw SQL uses tagged templates.

## Known limitations

1. **The CSP allows `'unsafe-inline'` scripts**, because the App Router bootstraps with inline
   scripts. A nonce-based CSP would make every page dynamic, including the static offline pages
   the service worker caches. Mitigations: no user HTML is ever rendered
   (`dangerouslySetInnerHTML` isn't used), plus `object-src 'none'` and `base-uri 'self'`.
   Post-beta.
2. **No email verification or password reset.** Both need an email provider (an external
   account). Until then, support would reset passwords by hand, which needs a documented
   identity check. That procedure doesn't exist yet.
3. **No 2FA for staff accounts** and no sign-in notifications. Post-beta. Keep the number of
   Super Admins small.
4. **The client IP depends on correct proxy configuration.** If the app is exposed directly
   without a proxy, set `TRUSTED_PROXY_HOPS=0`. Then all clients share one rate-limit key for
   IP-based limits, so always deploy behind the platform edge.
5. **Queued offline results aren't encrypted at rest** in IndexedDB (stroke coordinates only).
6. **Account deletion is immediate and permanent**, with no grace period. The interface says so
   before confirming.

## Reporting

Report suspected vulnerabilities privately to the project owner. Don't open a public issue.
