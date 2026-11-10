# API

Mutations in HanziQuest are mostly **Next.js server actions**. They are still public HTTP
endpoints, so every one validates input with Zod and checks authorization on the server. JSON
route handlers will be added for the offline-sync and attempt APIs (M2–M3).

## Route handlers

| Method   | Path          | Auth | Purpose                                                            |
| -------- | ------------- | ---- | ------------------------------------------------------------------ |
| GET/POST | `/api/auth/*` | –    | Auth.js endpoints (session, CSRF, credentials callback, sign-out). |

## Server actions

| Action                  | Module                               | Permission           | Input                                          | Result                                              |
| ----------------------- | ------------------------------------ | -------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `loginAction`           | `features/authentication/actions.ts` | public, rate limited | `{ email, password }`, `callbackUrl?`          | Redirects on success, or `{ error }`                |
| `registerAction`        | same                                 | public, rate limited | `{ displayName, email, password }`             | Redirects to `/home`, or `{ error?, fieldErrors? }` |
| `logoutAction`          | same                                 | signed in            | –                                              | Redirects to `/`                                    |
| `setLessonStatusAction` | `features/administration/actions.ts` | `curriculum:publish` | `{ lessonId, status: "PUBLISHED" \| "DRAFT" }` | `{ ok, message? }`                                  |
| `setUserRoleAction`     | same                                 | `users:manage-roles` | `{ userId, role, grant }`                      | `{ ok, message? }`                                  |

Error messages are deliberately generic. For example, sign-in failures never reveal whether an
email exists.

## Planned endpoints

`/api/attempts` and `/api/sync` (idempotent by client event id), `/api/lessons/:id/package`
(offline download), `/api/progress` and `/api/reviews`. They will be documented here when they
ship.
