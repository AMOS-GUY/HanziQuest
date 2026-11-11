# M6 quality and reliability audit (2026-11-11)

Scope: the code on `main` after M5 (PR #5), audited on `feature/m6-quality`. The audit read
the server boundary (every route handler, server action and admin page), the learning, progress,
offline-sync and account services, the schema and migrations, and the existing tests. It then
added regression tests for each gap it found, and fixed the confirmed defects.

## Method

1. **Server boundary inventory.** Every `route.ts` and `"use server"` file, and how each
   authenticates and authorises.

   | Area                                                                                                     | Result                                                                                                                 |
   | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `/api/attempts`, `/api/sessions`, `/api/sessions/:id/complete`, `/api/sync`, `/api/lessons/:id/download` | `requireApiUser` (active user, unrevoked session), per-user write limit, `readJson` size cap, `handleApi` origin check |
   | `/api/admin/handwriting/samples`                                                                         | `assertPermission("handwriting:validate")`                                                                             |
   | `/api/characters/:hanzi`, `/api/health`                                                                  | Public by design (openly licensed stroke data; no personal data)                                                       |
   | `/api/client-errors`                                                                                     | Anonymous by design: per-IP limit, 8 KB cap, schema-validated                                                          |
   | Admin server actions (curriculum, users, roles, feedback, handwriting lab)                               | `assertPermission(...)` with the specific permission plus the admin mutation limiter                                   |
   | Account, onboarding, placement, terms actions                                                            | Signed-in user only; ownership comes from the session, never from input                                                |
   | Admin pages (20)                                                                                         | All call `requirePagePermission`; `proxy.ts` also returns a bare 404 to non-staff                                      |

2. **Ownership and isolation.** Every service that takes an id from the client (session,
   assessment, sync event, attempt, lesson) checks it belongs to the caller. New tests confirm
   this for sessions, sync events and offline lesson completion.
3. **Failure conditions.** These were exercised in tests: interrupted sync, concurrent duplicate
   uploads, duplicate submissions, double completion, revoked and suspended sessions, malformed
   and oversized bodies, cross-site requests and database outages.
4. **Schema and migrations.** Constraints, indexes and transactions were checked. No migration
   contains `DROP`, `ALTER COLUMN`, `DELETE` or `TRUNCATE`. All seven earlier migrations are
   additive.

## Defect register (prioritised)

| ID    | Priority   | Status | Defect                                                                                                                                                                                                                                                                                                       | Fix and regression test                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M6-01 | **High**   | Fixed  | Lessons of a **draft or archived curriculum** stayed reachable. The learning path hid them, but direct links, offline download, sessions, attempts, reviews and character pages only checked `lesson.status`. Archiving a curriculum (for example after a content error) did not take it away from learners. | `features/curriculum/visibility.ts` (`LEARNER_VISIBLE_LESSON`, `isLearnerVisible`) is now used by every learner-facing lesson query. `quality.test.ts` "D-M6-01" (fails without the fix). History is kept, and republishing restores access.                                                                                                                                                                                                      |
| M6-05 | **High**   | Fixed  | **The admin had no way to publish a curriculum.** `createCurriculum` starts it as DRAFT and the update form omitted status, so a curriculum built in the admin never reached the learning path. After M6-01, its lessons are hidden completely.                                                              | `setCurriculumStatus` (publish, unpublish, archive) adds a content revision and an audit entry in one transaction, requires `curriculum:publish`, and refuses to publish without a published lesson. The curriculum page has Publish, Unpublish and Archive controls with confirmations. Tests: `quality.test.ts` "D-M6-05", `curriculum-admin.test.ts`, and an e2e check that a published lesson stays hidden until its curriculum is published. |
| M6-02 | Medium     | Fixed  | Two concurrent uploads of the same offline queue (two tabs, or a retry racing a slow request) failed with a **500** on the `SyncEvent` unique key, so the whole batch errored.                                                                                                                               | `sync-service.ts` inserts with `skipDuplicates`; event application was already idempotent. It still refuses an id owned by another user. Covered by `quality.test.ts` "D-M6-02" (fails without the fix).                                                                                                                                                                                                                                          |
| M6-03 | Low        | Fixed  | Onboarding, placement submission, profile update and terms acceptance had **no rate limit**. Each writes rows and audit entries, so they could be used to flood the audit log.                                                                                                                               | They now use the per-learner write limiter (120 per minute).                                                                                                                                                                                                                                                                                                                                                                                      |
| M6-04 | Low (perf) | Fixed  | No index on `ExerciseAttempt.sessionId`. Lesson completion filters by it, and the `SET NULL` cascade scans it.                                                                                                                                                                                               | Migration `attempt_session_index` (additive `CREATE INDEX`).                                                                                                                                                                                                                                                                                                                                                                                      |

No defect was found in: XP idempotency (unique `idempotencyKey`), per-learner advisory locking,
duplicate attempt handling (`clientEventId` plus P2002 recovery), lesson completion rules,
session revocation, the admin 404 gate, or terms enforcement.

## Accepted risks and open items

| ID   | Risk                                                                                                                                                              | Why it is accepted or what is needed                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Guided (traced) practice reports its **mistake count from the browser**, because Hanzi Writer's quiz runs client-side.                                            | Guided practice only earns half XP within the daily caps and **never** counts towards mastery or reviews. A modified client gains little XP. |
| R-02 | The character page (`/practice/character/:hanzi`) lets learners practise any character taught in a published lesson, **including lessons still locked for them**. | This is free practice by design. XP is still capped per exercise per day. Revisit if the team wants strict gating.                           |
| R-03 | CSP allows `'unsafe-inline'` scripts (App Router bootstrap).                                                                                                      | Reviewed in M9.                                                                                                                              |
| R-04 | Registration is limited to 5 per hour per IP. A classroom behind one NAT would hit it.                                                                            | Raise `REGISTER_LIMIT_PER_HOUR` for school pilots.                                                                                           |
| R-05 | Audit-log retention is not automated (IP addresses and user agents are stored).                                                                                   | Owner decision (LEGAL_REVIEW.md); a script is in M9.                                                                                         |
| R-06 | Firefox and physical devices are untested. Playwright's Firefox can't start on this machine.                                                                      | Owner or testers.                                                                                                                            |
| R-07 | Handwriting accuracy on real learners is unmeasured.                                                                                                              | Needs the five-tester pilot.                                                                                                                 |
| R-08 | Accessibility and responsive layout have not been audited automatically.                                                                                          | M8 adds axe checks.                                                                                                                          |

## Tests added

- `tests/integration/quality.test.ts` (11 tests)
  - Curriculum visibility: archived and draft curricula.
  - Concurrent duplicate uploads, and event ids owned by another user.
  - Isolation: progress summaries and details, using another learner's session, and an offline
    `lesson.complete` that names another learner's attempts.
  - A retried attempt after its exercise was archived.
  - Seven malformed attempt payloads, none of which write anything.
  - Concurrent double completion, which awards lesson XP once.
- `tests/unit/api-boundary.test.ts` (12 tests)
  - Error mapping for every error class.
  - A database outage gives a generic 500 with no connection string leaked, and is reported.
  - Malformed JSON, oversized bodies and a lying `Content-Length`.
  - Cross-site origin rejection.
  - `/api/health`: 200 when healthy, and 503 without details when the database is down.
- `tests/e2e/session-security.spec.ts` (3 tests)
  - A password change ends a second device's session for pages and the API, the old password
    fails and the new one works.
  - Suspension takes effect immediately, and reactivation restores access.
  - Anonymous requests get 401, cross-site requests 403, and malformed JSON 400.

## Test record

See the M6 entry in `docs/PROGRESS.md` for the exact commands and results of this milestone.
