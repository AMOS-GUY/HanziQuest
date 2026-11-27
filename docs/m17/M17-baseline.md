# M17 baseline: progression integrity audit

Recorded on 2026-11-28, before any change, on a clean checkout.

> Naming: `docs/ROADMAP.md` uses "M17" for "Remaining beta launch blockers". The owner named this
> mission "M17 — Learning Progression Integrity". These docs use the owner's name. The roadmap
> isn't changed.

## Repository state

| Item                          | State                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                        | `857a430` ("Merge pull request #34", merged by the owner on 2026-11-27 19:09 UTC). It was `76a6775` at the previous session's end. #34 adds only M13 statistics (`src/lib/statistics`, the validation toolkit, docs), not progression code. |
| GitHub CI on `main` `857a430` | `docker` passed. `verify` was **in progress** when this was recorded.                                                                                                                                                                       |
| Working tree                  | Clean, on `main`. Branch `feature/m17-progression-integrity` created from `origin/main` (`857a430`).                                                                                                                                        |
| PR #54 (M16.1 explorer)       | **Open, not merged.** Head `5cc8779`. Not integrated here. Its files don't overlap this mission's (checked with `git merge-tree`).                                                                                                          |
| Environment                   | `.env` has local URLs only (`localhost:5433`, databases `hanziquest` and `hanziquest_test`). `.env.staging.local` exists. It is read only by `npm run staging:*`, which wasn't run. No production or staging credentials were used.         |
| Probes                        | Integration tests only, against `hanziquest_test`. Its guard refuses non-local hosts and names without "test". Fixtures are new curricula and new learners, archived at the end.                                                            |

## Open PRs that touch progression

| PR                                            | Overlap                                                                                                                                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#48** `fix/empty-lesson-completion` (D-084) | `completeLessonSession` refuses lessons with no published exercises. Same function as one M17 fix, in different hunks: `merge-tree` is clean. Its D-084 entry is at the top of `DECISIONS.md`. |
| #52 `feature/home-learning-loop`              | Reads progress for Home. No writes.                                                                                                                                                            |
| #51 `feature/learner-navigation`              | Navigation only.                                                                                                                                                                               |
| #49 `fix/a11y-page-headings`                  | Page headings only.                                                                                                                                                                            |
| #54 `feature/m16-vocabulary-explorer`         | Reads lesson states. No writes.                                                                                                                                                                |
| #46, #47, #50, #53                            | Documentation and toolkit. No progression code.                                                                                                                                                |

## Progression architecture (as found)

| Concern                        | Where                                                                            | Notes                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attempt validation and grading | `features/exercises/attempts.ts` `submitAttempt`                                 | The single entry for attempts, called by `POST /api/attempts` and by offline sync. Handwriting is re-graded on the server. Idempotent on `clientEventId`. Accepts only published exercises in learner-visible lessons. `occurredAt` must be within 30 days back and 5 minutes forward. |
| Progress effects               | `features/progress/record.ts` `applyAttemptProgress` and `applyLessonCompletion` | One transaction under the per-learner advisory lock (D-023). It writes per-character results, replays mastery and schedules (D-022), XP with idempotency keys (D-021), daily activity, streak and achievements.                                                                        |
| Mastery and schedules          | `features/progress/mastery.ts` (pure replay), `recomputeCharacter`               | Never written directly. `npm run progress:rebuild` recomputes them.                                                                                                                                                                                                                    |
| XP rules                       | `features/progress/xp-rules.ts`                                                  | Server only. A daily cap of 300 and 3 rewarded attempts per exercise per day (D-021).                                                                                                                                                                                                  |
| Lesson eligibility             | `features/progression/lesson-states.ts`                                          | Sequential lessons and levels (D-039). States are derived, not stored, apart from `LessonProgress`.                                                                                                                                                                                    |
| Visibility                     | `features/curriculum/visibility.ts`                                              | A published lesson in a published curriculum (D-037).                                                                                                                                                                                                                                  |
| Sessions and completion        | `features/learning/sessions.ts`                                                  | `startLessonSession` refuses locked and unpublished lessons. `completeLessonSession` enforces D-019.                                                                                                                                                                                   |
| Placement                      | `features/assessment/placement.ts`                                               | Graded on the server (D-017). Consecutive units only (D-018). A 24-hour retake rule (D-040). It writes `TESTED_OUT` only.                                                                                                                                                              |
| Offline                        | `features/offline/sync-service.ts`                                               | Re-runs `submitAttempt` and `completeLessonSession` (D-024).                                                                                                                                                                                                                           |
| Learner API auth               | `lib/api/learner.ts` `requireApiUser`                                            | ACTIVE users only, checked against the database on every request (D-005). Plus a write rate limit.                                                                                                                                                                                     |
| Admin                          | `features/administration/*actions.ts`                                            | `assertPermission`. No admin path writes learner progress. Admins affect eligibility only through publish status (`curriculum:publish`).                                                                                                                                               |

## Existing progression tests

The integration tests:

- `learning.test.ts`: lesson states, locked-lesson start refused, server-side grading, forged score ignored, idempotency and cross-user ids, hints, time bounds, unpublished exercises, completion rules (D-019), cross-user sessions.
- `progress.test.ts`:
  - XP once per attempt, repeat caps, skips, daily goal, lesson XP;
  - guided versus independent practice, reviews, streaks and time zones;
  - **concurrent submissions**;
  - sync order and idempotency, rejections, resumed sync;
  - technique, and a wrong character never advancing.
- `placement.test.ts`, `session-start-race.test.ts`, `empty-lesson.test.ts` (#48, unmerged).

The e2e tests: `learning-journey.spec.ts` (including "a locked lesson cannot be practised"), `offline-progress.spec.ts`, `session-security.spec.ts`.

## Documented decisions relied on

D-005, D-017 to D-024, D-033, D-037, D-039, D-040 and D-044, plus D-084 (proposed in #48). Also `SECURITY.md` "Learning data" and "Progress and offline".

## Known limitations of this environment

Docker and `age` aren't installed. Firefox e2e is advisory and optional locally. GitHub CI runs all three.
