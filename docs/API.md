# API

Mutations in HanziQuest are mostly **Next.js server actions**. They are still public HTTP
endpoints, so every one validates input with Zod and checks authorization on the server. JSON
route handlers will be added for the offline-sync and attempt APIs (M2–M3).

## Route handlers

| Method   | Path                         | Auth    | Purpose                                                                                                    |
| -------- | ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| GET/POST | `/api/auth/*`                | –       | Auth.js endpoints (session, CSRF, credentials callback, sign-out).                                         |
| POST     | `/api/sessions`              | learner | `{ lessonId }` → `201 { sessionId }`. 403 if the lesson is locked, 404 if unpublished.                     |
| POST     | `/api/sessions/:id/complete` | owner   | `200 { completed, lessonId, nextLessonId }`. 409 if exercises remain or too many were skipped. Idempotent. |
| POST     | `/api/attempts`              | learner | Records an attempt; see below. `201` when new, `200` with `duplicate: true` on replay.                     |
| GET      | `/api/characters/:hanzi`     | public  | Stroke data `{ strokes, medians }` (Make Me a Hanzi format). Cacheable for a day.                          |

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

The server re-evaluates `drawings` and ignores any client score. It returns
`{ attemptId, duplicate, result, score, mode, evaluation }`. Bounds: ≤ 6 characters, ≤ 40
strokes each, ≤ 600 points per stroke, coordinates within [-0.25, 1.25].

## Server actions

| Action                     | Module                               | Permission           | Input                                                           | Result                                                                     |
| -------------------------- | ------------------------------------ | -------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `loginAction`              | `features/authentication/actions.ts` | public, rate limited | `{ email, password }`, `callbackUrl?`                           | Redirects on success, or `{ error }`                                       |
| `registerAction`           | same                                 | public, rate limited | `{ displayName, email, password }`                              | Redirects to `/home`, or `{ error?, fieldErrors? }`                        |
| `logoutAction`             | same                                 | signed in            | –                                                               | Redirects to `/`                                                           |
| `setLessonStatusAction`    | `features/administration/actions.ts` | `curriculum:publish` | `{ lessonId, status: "PUBLISHED" \| "DRAFT" }`                  | `{ ok, message? }`                                                         |
| `setUserRoleAction`        | same                                 | `users:manage-roles` | `{ userId, role, grant }`                                       | `{ ok, message? }`                                                         |
| `completeOnboardingAction` | `features/onboarding/actions.ts`     | signed in            | onboarding answers + `takePlacement`                            | Redirects to `/placement` or `/home`                                       |
| `submitPlacementAction`    | same                                 | signed in            | `{ assessmentId, answers }` (option index or null per question) | `{ summary }`. Graded on the server; answers are never sent to the client. |

Error messages are deliberately generic. For example, sign-in failures never reveal whether an
email exists.

## Planned endpoints

`/api/sync` (batch offline events), `/api/lessons/:id/package` (offline download),
`/api/progress` and `/api/reviews`, all in M3.
