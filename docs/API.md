# API

Mutations in HanziQuest are mostly **Next.js server actions**. They are still public HTTP
endpoints, so every one validates input with Zod and checks authorization on the server. JSON
route handlers serve the practice runner and offline sync.

## Route handlers

| Method   | Path                         | Auth    | Purpose                                                                                                                                         |
| -------- | ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/POST | `/api/auth/*`                | –       | Auth.js endpoints (session, CSRF, credentials callback, sign-out).                                                                              |
| POST     | `/api/sessions`              | learner | `{ lessonId }` or `{ type: "REVIEW" }` → `201 { sessionId }`. 403 if the lesson is locked, 404 if unpublished, 409 if no review is due.         |
| POST     | `/api/sessions/:id/complete` | owner   | `200 { completed, lessonId, nextLessonId, progress }`. 409 if exercises remain or too many were skipped. Idempotent; lesson XP is granted once. |
| POST     | `/api/sync`                  | learner | Uploads queued offline events; see below.                                                                                                       |
| POST     | `/api/lessons/:id/download`  | learner | `{ deviceId }` → offline package `{ lessonId, title, contentVersion, payload }`. 403 if locked. Records the device's content version.           |
| POST     | `/api/attempts`              | learner | Records an attempt; see below. `201` when new, `200` with `duplicate: true` on replay.                                                          |
| GET      | `/api/characters/:hanzi`     | public  | Stroke data `{ strokes, medians }` (Make Me a Hanzi format). Cacheable for a day.                                                               |

All learner writes are rate limited (120 per minute per user, `429` with `Retry-After`). Errors
use one shape: `{ "error": { "code", "message", "details?" } }` (400 invalid_request, 401, 403,
404, 409, 429, 500).

### `POST /api/attempts`

```jsonc
{
  "clientEventId": "uuid", // idempotency key, generated on the device
  "exerciseId": "…",
  "sessionId": "…", // optional
  "occurredAt": "2026-11-10T09:00:00Z", // within the last 30 days, ≤ 5 min in the future
  "durationMs": 8000,
  "hintsUsed": 0,
  "kind": "writing", // or "guided" { mistakes } or "skip"
  "drawings": [[{ "points": [{ "x": 0.2, "y": 0.3, "t": 0 }] }]], // strokes per character
}
```

The server re-evaluates `drawings` and ignores any client score or XP value. It returns
`{ attemptId, duplicate, result, score, mode, evaluation, xpAwarded, progress }`, where
`progress` is `{ xpAwarded, dailyGoalReached, streak, achievements[] }` (null on a duplicate). Bounds: ≤ 6 characters, ≤ 40
strokes each, ≤ 600 points per stroke, coordinates within [-0.25, 1.25].

## Server actions

| Action                                                                                                                                        | Module                                          | Permission             | Input                                                           | Result                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `loginAction`                                                                                                                                 | `features/authentication/actions.ts`            | public, rate limited   | `{ email, password }`, `callbackUrl?`                           | Redirects on success, or `{ error }`                                         |
| `registerAction`                                                                                                                              | same                                            | public, rate limited   | `{ displayName, email, password }`                              | Redirects to `/home`, or `{ error?, fieldErrors? }`                          |
| `logoutAction`                                                                                                                                | same                                            | signed in              | –                                                               | Redirects to `/`                                                             |
| `setLessonStatusAction`                                                                                                                       | `features/administration/actions.ts`            | `curriculum:publish`   | `{ lessonId, status: "PUBLISHED" \| "DRAFT" }`                  | `{ ok, message? }`                                                           |
| `setUserRoleAction`                                                                                                                           | same                                            | `users:manage-roles`   | `{ userId, role, grant }`                                       | `{ ok, message? }`                                                           |
| `completeOnboardingAction`                                                                                                                    | `features/onboarding/actions.ts`                | signed in              | onboarding answers + `takePlacement`                            | Redirects to `/placement` or `/home`                                         |
| `submitPlacementAction`                                                                                                                       | same                                            | signed in              | `{ assessmentId, answers }` (option index or null per question) | `{ summary }`. Graded on the server; answers are never sent to the client.   |
| Curriculum actions (`create/update` curriculum, level, unit, lesson, character, word, exercise; `setLessonWords`; custom exercise add/remove) | `features/administration/curriculum-actions.ts` | `curriculum:write`     | Form data validated by the Zod schemas in `curriculum-admin.ts` | `FormState { ok, message, fieldErrors }`; creates redirect to the new record |
| `validateImportAction` / `importContentAction`                                                                                                | same                                            | `content:import`       | Curriculum JSON (≤ 2 MB)                                        | Validation issues, or an import summary (new lessons as drafts)              |
| `recordHandwritingSampleAction`                                                                                                               | `features/handwriting/lab-actions.ts`           | `handwriting:validate` | Participant code, character, category, ink, consent             | Engine verdict for the sample                                                |
| `updateProfileAction`, `changePasswordAction`, `deleteAccountAction`                                                                          | `features/account/actions.ts`                   | signed in (self only)  | Profile fields / current + new password / password + "DELETE"   | `FormState`; password change and deletion sign out                           |
| `setUserStatusAction`                                                                                                                         | same                                            | `users:moderate`       | `{ status: ACTIVE \| SUSPENDED, reason }`                       | `FormState`                                                                  |

Error messages are deliberately generic. For example, sign-in failures never reveal whether an
email exists.

### Operational and admin endpoints (M4)

| Method | Path                             | Auth                       | Purpose                                                                                                                                                                                  |
| ------ | -------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`                    | public                     | Readiness: `{status, database, migrations, release, latencyMs}`. 503 when the database is down or a migration in the build is unapplied, unfinished or failed. No configuration details. |
| GET    | `/api/health/live`               | public                     | Liveness: `{status, release}`. Never queries the database (M10).                                                                                                                         |
| POST   | `/api/client-errors`             | public, 30 / 10 min per IP | Error boundaries report `{message, name?, digest?, path?}` (8 KB max). Logged and forwarded to Sentry if configured.                                                                     |
| GET    | `/api/admin/handwriting/samples` | `handwriting:validate`     | Validation samples re-scored with the current engine, plus metrics. `?strokes=1` adds raw ink.                                                                                           |

All JSON route handlers cap the request body (413 `payload_too_large`) and reject cross-site
writes whose `Origin` doesn't match the app (403). Admin pages are additionally gated by
`src/proxy.ts`.

### `POST /api/sync`

```jsonc
{
  "deviceId": "uuid", // random id stored in the browser; no personal data
  "events": [
    // ≤ 25 per request, applied in order
    {
      "id": "uuid",
      "type": "attempt",
      "clientCreatedAt": "…",
      "payload": {/* /api/attempts body without clientEventId */},
    },
    {
      "id": "uuid",
      "type": "lesson.complete",
      "clientCreatedAt": "…",
      "payload": { "lessonId": "…", "sessionId": null, "attemptIds": ["uuid", "…"] },
    },
  ],
}
```

Response: `{ "results": [{ "id", "status": "processed" | "duplicate" | "rejected", "error?", "result?" }] }`.
Each event id is stored in `SyncEvent`, so re-uploading a batch returns `duplicate` without
side effects. An attempt event's id becomes the attempt's `clientEventId`. Validation and
domain failures are `rejected` with a learner-readable message and never retried. Unexpected
server errors fail the request (500) and the device retries later.

Progress and review data are rendered by server components (`/progress`, `/review`, `/home`)
from `features/progress/queries.ts`; there is no separate JSON endpoint yet.
