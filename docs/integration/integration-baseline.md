# Integration baseline (2026-11-28)

Recorded before anything was changed. It is verified on GitHub and with git, not taken from
earlier handovers.

| Item                                         | State at start                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                                       | `6a2ae56`: **#59 (M19) was already merged** by the owner. Its tree is identical to #59's reviewed head `b7e32b3`. CI on `6a2ae56` was running at the start and later finished with success. |
| #48 `fix/empty-lesson-completion`            | Open. Head `6e859a6`, base `76a6775`. **CONFLICTING (DIRTY)**. CI on the old head: success. No reviews or comments.                                                                         |
| #58 `fix/m18-review`                         | Open. Head `68aaff1`, base `4193d91` (before #59). CLEAN. CI success. No reviews or comments.                                                                                               |
| #59 `feature/m19-learner-experience-quality` | **Merged** (`6a2ae56`).                                                                                                                                                                     |
| Deployments                                  | None. `deploy.yml` and `deploy-staging.yml` have no runs.                                                                                                                                   |
| Databases                                    | Only the local `hanziquest` and `hanziquest_test` were used. No staging or production access.                                                                                               |

## The three diffs, as inspected

- **#48:** `completeLessonSession` refuses lessons with no published exercises, and
  `setLessonStatus` refuses to publish such a lesson. It also has D-084 and
  `tests/integration/empty-lesson.test.ts`. Nothing else.
- **#58:**
  - the preview notice (`save-status.ts`, `practice-runner.tsx`);
  - the admin overview's counted and raw metrics;
  - `features/offline/downloads.ts`, called by the download route;
  - 7 adversarial integration tests;
  - the `drill:migrations` step 2b;
  - documentation wording (D-085 title, SECURITY, OFFLINE, `docs/m18`).

  It has no migration and no policy change.

- **#59** (merged): UX and accessibility fixes F-01 to F-09, and the disputes e2e isolation.

## Conflict

#48 conflicted with `main` only in `docs/DECISIONS.md`: D-084 (#48) and D-085 (from #57) were
both inserted at the top.
