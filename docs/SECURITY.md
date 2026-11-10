# Security

## In place (M1)

| Control          | Implementation                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password storage | bcrypt, cost 12 (`src/lib/auth/password.ts`). Sign-in compares against a dummy hash when the email is unknown, keeping response timing similar.                                                         |
| Sessions         | Auth.js v5 JWT in an HTTP-only cookie, signed with `AUTH_SECRET`, 30-day lifetime. The JWT holds only the user id.                                                                                      |
| Account status   | Every server-side check reloads the user. Non-`ACTIVE` users are treated as signed out.                                                                                                                 |
| Authorization    | Role → permission map (`src/lib/permissions`). Pages use `requirePagePermission` (404 when denied). Server actions use `assertPermission` (401/403). Hidden buttons are never relied on.                |
| Role safety      | Only Super Admins can grant or revoke Super Admin. Admins can't remove their own Super Admin role. The last Super Admin can't be removed. LEARNER can't be removed.                                     |
| Input validation | Zod schemas on every action and in services (`src/lib/validation`).                                                                                                                                     |
| Rate limiting    | Sign-in: 10 per 15 min per email+IP. Registration: 5 per hour per IP. Admin mutations: 60 per min per user.                                                                                             |
| Audit log        | Registration, sign-in, lesson publish/unpublish and role grants/revocations, written in the same transaction as the change, with IP and user agent.                                                     |
| Content history  | A `ContentRevision` snapshot is stored before every publish/unpublish.                                                                                                                                  |
| Open redirects   | `callbackUrl` is restricted to same-origin relative paths (`safeRedirectPath`).                                                                                                                         |
| Headers          | CSP (`frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), HSTS, `nosniff`, `X-Frame-Options: DENY`, strict referrer policy, restrictive Permissions-Policy. `X-Powered-By` is removed. |
| Data exposure    | Admin queries `select` explicit fields and never return `passwordHash`. The Prisma client is `server-only`.                                                                                             |
| Secrets          | `.env` is git-ignored. `.env.example` lists every variable with no real values. CI generates a throwaway `AUTH_SECRET`.                                                                                 |

### Learning data (M2)

- Handwriting results are **computed on the server** from raw strokes. Client-sent scores and
  results are ignored.
- Attempt replay is idempotent (`clientEventId` is unique). Reusing another user's id returns 409.
- Attempts are accepted only for published exercises in published lessons, with a bounded
  payload and timestamp. Locked lessons can't be started.
- Placement answers are graded on the server from a question plan derived from the assessment
  id. Correct answers are never sent to the browser.
- Guided-practice mistake counts are client-reported and labelled as such. They never count
  as independent recall and will only earn capped XP (M3).

## Known limitations / planned hardening

1. **Rate limiter is in-memory, per instance.** `REGISTER_LIMIT_PER_HOUR` raises the registration limit for automated tests only. On serverless or multi-instance hosting the
   limits apply per instance. Before public launch, move the store to PostgreSQL or Redis.
2. **CSP allows `'unsafe-inline'` scripts**, because the App Router bootstraps with inline
   scripts. Next step: a nonce-based CSP set from `proxy.ts`.
3. **No email verification or password reset yet.** Both need an email provider (an external
   service; credentials required).
4. **Admin page titles** (`<title>`) are still sent with the 404 response when a learner opens an
   admin URL. This reveals that an admin route exists but no data. Low risk.
5. **No account lockout notifications** and no 2FA for admins (post-beta).
6. **Moderation actions** (suspend/reactivate) exist in the data model (`UserStatus`) but have
   no UI or action yet.

## Reporting

Report suspected vulnerabilities privately to the project owner. Don't open a public issue.
