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

## M6–M9 review (2026-11-11)

**Fixed:**

- M6-01: lessons of unpublished curricula were reachable by direct link, download and the API.
- M6-02: concurrent sync uploads caused a 500.
- M6-03: four learner actions had no rate limit.
- M7-01: a provisional import could rewrite verified content.
- M7-02: the import audit entry was written outside the import transaction.

**Added in M9:**

- **Invite-only registration** (the default in production, D-041). Only hashes of the codes
  are stored, redemption is atomic, and a failed sign-up doesn't consume a code. Tested under
  concurrency and end to end on an invite-only server.
- **Headers:** `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Resource-Policy: same-origin`, in addition to CSP, HSTS, `nosniff`,
  frame-ancestors/`X-Frame-Options`, Referrer-Policy and Permissions-Policy.
- **Rate limit on the public stroke-data route:** 600 per minute per IP.
- **Structured request logs** with redaction of emails, tokens and URL credentials. Fields
  named like credentials are dropped.
- **CI:** `npm audit --omit=dev --audit-level=high`, and the migration safety check. Dependabot
  sends weekly update PRs.
- **Dependencies (2026-11-11):** 0 known vulnerabilities in production dependencies. 7
  moderate advisories in a lint-only dependency (`minimatch` via typescript-eslint, a ReDoS on
  glob patterns we write ourselves). Accepted until typescript-eslint releases a fix;
  `npm audit fix` without `--force` can't resolve it.

### Rate limits (abuse review)

| Limit                             | Key             | Applies to                                                                 |
| --------------------------------- | --------------- | -------------------------------------------------------------------------- |
| 10 / 15 min and 30 / h            | email+IP, email | sign-in                                                                    |
| 5 / h (`REGISTER_LIMIT_PER_HOUR`) | IP              | registration (and an invite in production)                                 |
| 120 / min                         | user            | attempts, sessions, sync, downloads, onboarding, placement, profile, terms |
| 60 / min                          | user            | admin and staff mutations                                                  |
| 5 / h, 3 / h, 10 / h              | user, IP, user  | password change, account deletion, feedback                                |
| 30 / 10 min, 600 / min            | IP              | client error reports, public stroke data                                   |
| 10 / h                            | IP              | password reset with a reset link                                           |

All of them are shared across instances through PostgreSQL in production.

## Known limitations

1. **The CSP allows `'unsafe-inline'` scripts**, because the App Router bootstraps with inline
   scripts. A nonce-based CSP would make every page dynamic, including the static offline pages
   the service worker caches. Mitigations: no user HTML is ever rendered
   (`dangerouslySetInnerHTML` isn't used), plus `object-src 'none'` and `base-uri 'self'`.
   Post-beta. Reviewed again in M9 and kept: the static, service-worker-cached offline pages
   can't carry a per-request nonce. The added COOP and CORP headers and the strict
   `connect-src 'self'` limit what an injected script could do. Since the integration audit,
   ESLint enforces the mitigation: `react/no-danger`, no `innerHTML`/`outerHTML` assignments and
   no created `script` elements (D-046).
2. **No email verification, and password reset is staff-assisted.** Email needs a provider
   (an external account). Until then, staff create single-use reset links (D-045, Admin → Users
   → a user → Password reset). They are **off in production** (`PASSWORD_RESET_LINKS`) until
   the owner approves the procedure below. The security review and its limitations are below.
3. **No 2FA for staff accounts** and no sign-in notifications. Post-beta. Keep the number of
   Super Admins small.
4. **The client IP depends on correct proxy configuration.** If the app is exposed directly
   without a proxy, set `TRUSTED_PROXY_HOPS=0`. Then all clients share one rate-limit key for
   IP-based limits, so always deploy behind the platform edge.
5. **Queued offline results aren't encrypted at rest** in IndexedDB (stroke coordinates only).
6. **Account deletion is immediate and permanent**, with no grace period. The interface says so
   before confirming.

## Password reset procedure (draft, needs owner approval)

**Not approved.** This is a draft for the owner. Until the owner approves it, leave
`PASSWORD_RESET_LINKS` unset in production. The admin card then says the feature is turned off,
and every link is refused.

### Who can create a link

- A **Moderator** or a **Super Admin** (the `users:moderate` permission), for a learner account.
- Only a **Super Admin** can create one for a staff account (any role other than Learner).
- Nobody can create one for their own account; they use Change password on their profile.
- Nobody can create one for a suspended or deleted account; reactivate it first.
- The server checks all of this again when the link is used (D-047). A link stops working if
  the person who created it is suspended or loses the Moderator role, or if the account is
  promoted to staff and the creator isn't a Super Admin.

### Verifying the recipient

1. The request must come from, or be confirmed by a reply from, **the email address on the
   account**. Look the account up in Admin → Users by that address and check that it matches
   exactly.
2. Don't accept a name, a display name, lesson history or "security questions" as proof. Don't
   accept a request from a different address, phone number or chat handle, even if the
   requester says they lost access to their email. Don't create a link in that case; refer it to
   the owner.
3. Never ask for, or accept, the learner's old or new password.

### Creating and delivering the link

1. In Admin → Users → the account → Password reset, give a reason (for example "asked by email
   on 11 Nov, replied from the account address") and create the link. The link is shown once.
   Only its hash is stored.
2. Create it with nobody watching your screen. Paste it straight into a reply to the
   **account's email address**, sent from the team mailbox. Don't paste it into chat, tickets or
   notes. Afterwards, clear your clipboard by copying something else.
3. Creating a new link cancels any earlier unused link for the account.

### When a link expires or doesn't work

- A link works **once**, for **24 hours**. After that, or once it has been used, the page says
  "This reset link is not valid any more" and asks the learner to contact the team.
- To help, go through the whole procedure again: verify the request and create a new link.
  Don't re-send an old link. Expired and used links are deleted by `npm run ops:prune`.
- A link also stops working if the account is suspended, the creator is suspended or demoted,
  the account is promoted to staff (unless a Super Admin created the link), or
  `PASSWORD_RESET_LINKS` is off.

### After the password is changed

- The account is **signed out on every device**: every session from before the change is
  refused. The learner logs in with the new password.
- The link is used up, and any other unused links for the account are deleted.
- The audit log has `user.password.reset_link` (who created it, for whom, the reason and the
  expiry) and `user.password.reset` (when it was used, with IP and user agent). Neither contains
  the token.

### Oversight

1. If the learner says they didn't ask for a reset, or a link was used that you didn't send,
   tell the owner. Check Admin → Audit logs for `user.password.reset_link` and
   `user.password.reset`.
2. The owner reviews the `user.password.reset_link` entries weekly during the beta: who issued
   each link, for whom and why.

### Without an email provider

- The app can't email the link itself, so a person has to copy it into an email (see the
  limitations below).
- The learner gets **no notice** that a link was created or that their password was changed.
- There is no self-service "forgot password", and email addresses aren't verified at sign-up.
  So "the address on the account" is the address the learner typed when registering.

Hosting note: reset links carry the token in the URL. The app logs paths without query
strings, but check that the platform's access logs don't keep query strings, or keep them
only briefly.

## Password reset security review (2026-11-11, D-047)

A code review of the complete implementation, plus tests. This is not a third-party penetration
test.

| Property                  | Implementation                                                                                                                                                                                                                                                                         | Evidence                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Who can create a link     | `users:moderate` (Moderator, Super Admin), checked server-side in the action. A staff account needs a Super Admin. Nobody can create one for their own account, or for a suspended or deleted account. The admin card is also hidden from other roles, but the server is what decides. | integration "guards who can issue links"                                              |
| Policy at the time of use | **Fixed in this review.** The atomic use checks that the issuer is still an active moderator, and a Super Admin if the account is staff today. Granting a staff role or suspending the account discards unused links.                                                                  | 5 integration tests, which fail without the fix                                       |
| Token and storage         | 256 random bits (base64url, 43 characters). Only `SHA-256("hanziquest-reset:" + token)` is stored. The audit log stores the row id, never the token.                                                                                                                                   | integration: the row and the audit entry don't contain the token                      |
| Single use                | Consumed by one guarded `UPDATE … WHERE usedAt IS NULL … RETURNING`, in the same transaction as the password change.                                                                                                                                                                   | integration: 4 parallel uses, exactly 1 succeeds                                      |
| Expiry                    | 24 hours (`RESET_TTL_HOURS`), checked in SQL at use. Expired and used rows are deleted by `ops:prune`.                                                                                                                                                                                 | integration (expiry, prune)                                                           |
| Earlier links             | A new link deletes the account's unused links, with the account row locked, so parallel requests can't leave two (**RS-07, fixed**). A successful reset deletes any others.                                                                                                            | integration "one live link per account", and 6 parallel creations leaving 1 live link |
| Session revocation        | The reset sets `credentialsChangedAt`. Every session issued before it is refused by `requireUser` and by the admin gate in `proxy.ts`.                                                                                                                                                 | e2e: the learner's other session is signed out                                        |
| Audit                     | `user.password.reset_link` (actor, reason, expiry, number of discarded links) and `user.password.reset` (the learner, IP, user agent). Each is written in the same transaction as the change it records. Role grants and suspensions record `discardedResetLinks`.                     | integration                                                                           |
| Brute force               | 2^256 search space. The reset action is limited to 10 per hour per IP. A wrong password doesn't use up the link.                                                                                                                                                                       | integration                                                                           |
| URL, history, referrer    | The page sets `Referrer-Policy: no-referrer`; the site default is `strict-origin-when-cross-origin`. The page is dynamic (`no-store`) and the service worker never caches it. **Fixed in this review:** the page removes the token from the address bar once loaded.                   | e2e: the address bar shows `/reset-password` (Chromium, WebKit)                       |
| Logs and error reports    | `onRequestError` and client error reports drop query strings before logging or sending to Sentry. `logEvent` masks long tokens. Neither the token nor the password is ever logged.                                                                                                     | code review (`instrumentation.ts`, `api/client-errors`, `monitoring/log.ts`)          |
| Disclosure to other staff | The link exists only in the issuing moderator's browser, in the action response. It isn't stored, emailed or shown in audit logs, and isn't shown again on reload.                                                                                                                     | code review                                                                           |
| Switch                    | `PASSWORD_RESET_LINKS` is off by default in production. When it is off, creating, checking and using a link are all refused in the service.                                                                                                                                            | unit + integration                                                                    |

**Limitations (accepted for the beta, owner to confirm):**

1. **Whoever creates a link can use it.** A Moderator can therefore take over any learner
   account, and a Super Admin any account. Without email, nothing technical prevents this.
   Detection: the audit entry with a reason, and the learner being signed out everywhere. Keep
   the number of Moderators small and review the entries (Oversight).
2. **No notice to the learner** that a link was created or used. Email is needed for that.
3. **The link travels by email.** Anyone who can read the learner's or the team's mailbox
   within 24 hours can use it. Mail scanners that open links don't use it up: the link is
   used only when the form is submitted.
4. **Platform access logs may record the query string.** This is outside the app. See the
   hosting note.
5. **Browser history isn't guaranteed clean.** Removing the token from the address bar
   replaces the history entry. Some browsers or history-sync services may already have
   recorded the first URL. That matters only until the link is used or expires.
6. **The identity check is procedural:** "only to the account's email address". Real-user
   recovery stays off until the owner approves it.

## Content review (M14-b)

| Control              | Implementation                                                                                                                                                                 | Tests                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Who decides          | `curriculum:review` (Super Admin, Content reviewer), checked in the server action and again in `recordReview`. Editors don't hold it. Reviewers can't edit or import.          | unit permissions matrix; integration; e2e least privilege |
| Content files        | May only declare PROVISIONAL: the schema rejects other values with a clear error, and the importer refuses again before writing (D-074). Every import route goes through both. | unit; integration `content-status.test.ts`; e2e           |
| Independent VERIFIED | VERIFIED needs a current REVIEWED approval of the same fingerprint by a different reviewer. No role is exempt (D-075).                                                         | integration `content-status.test.ts`                      |
| Edits                | Verification isn't an edit field. Creating sets PROVISIONAL and updates refuse any change, for every actor, Super Admins included.                                             | integration `provenance.test.ts`                          |
| Exact version        | Decisions carry the fingerprint the reviewer saw. Any other current version is refused. Later changes return approvals to PROVISIONAL, audited.                                | integration                                               |
| Self-review          | Refused if the reviewer changed, restructured or imported the version since the last approval.                                                                                 | integration                                               |
| Sources              | Approval follows the import source rules. Withdrawn approvals are handled by `content:provenance -- --reconcile [--apply]`.                                                    | unit; integration                                         |
| History and audit    | `ContentReview` rows are never updated or deleted. Every decision and invalidation is audited in the same transaction.                                                         | integration                                               |
| Concurrency          | Review locks are taken before writing (D-073). Duplicate approvals are refused.                                                                                                | `review-concurrency.test.ts`                              |
| Revoked or suspended | Roles and status are reloaded on every request. A form left open is refused after revocation (by the action) or suspension (by the proxy, before any action runs).             | e2e `admin-review.spec.ts`                                |
| Input                | Zod: entity type enum, id ≤ 64 characters, fingerprint format, note ≤ 1000 characters (at least 5 to request changes). Rate limited like admin mutations.                      | unit; e2e                                                 |
| Errors               | Refusals give the reason (no data from other records). Unexpected errors show a generic message, and details go to the server log.                                             | e2e                                                       |

Limitation (LOW, D-073): inside `/admin`, staff without a page's permission get the not-found
page with status 200, because the admin loading boundary starts the response first. Non-staff
and suspended accounts get a real 404.

## Reporting

Report suspected vulnerabilities privately to the project owner. Don't open a public issue.
