# M18 baseline: progression integrity enforcement

Recorded on 2026-11-28 (UTC 2026-11-27 19:54), on a clean checkout.

## Prerequisite status: **implementation blocked**

| Item                                                              | State                                                                                                                                                                | Evidence                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `main`                                                            | `857a430` (#34). Unchanged since M17. CI green.                                                                                                                      | `git log 857a430..origin/main` is empty. CI run on `857a430`: success. |
| **#55 M17** (`feature/m17-progression-integrity`, head `b256a70`) | **Open, not merged.** GitHub `verify` was still running (in its final steps). `docker` passed. Local `ci:local` on `051b4ec`: 25 PASS, 4 BLOCKED, 2 NOT RUN, exit 0. | `gh pr view 55`, run `46057979768`                                     |
| **#48** empty-lesson completion (D-084, head `6e859a6`)           | **Open, not merged.** Green and CLEAN.                                                                                                                               | `gh pr view 48`                                                        |
| #54 M16.1 explorer (head `5cc8779`)                               | Open. Green and CLEAN. It reads lesson states, and M18's eligibility must agree with it.                                                                             | `gh pr view 54`                                                        |

**Why M18 can't start on `main`:**

- M18 changes `submitAttempt` and `completeLessonSession`. #55 changes `completeLessonSession` and
  `submitPlacement`, and #48 changes `completeLessonSession`.
- M18 must flip #55's F-01 and F-02 characterization tests
  (`tests/integration/progression-integrity.test.ts`). That file exists only on #55.
- D-085 must follow #48's D-084 at the top of `DECISIONS.md`.

Building on `main` would duplicate #55. Stacking on #55 would build on an unmerged, unreviewed
baseline. The mission forbids both ("do not create a competing implementation against an
unstable baseline").

**Next action (owner):** review and merge #48 and #55 (in either order: `merge-tree` is clean).
M18 then starts from the new `main`. The mapping and test plan in `M18-architecture.md` are
ready.

## Verified present on `main` (not assumed from M17's handover)

- `submitAttempt` (`features/exercises/attempts.ts`):
  - accepts `occurredAt` from 30 days back to 5 minutes forward;
  - checks session ownership only;
  - checks no lesson state.
- `applyAttemptProgress` (`features/progress/record.ts`) writes everything inside one
  learner-locked transaction.
- **M17's F-03 and F-04 fixes are not on `main`.** They're in #55.
- **#48's empty-lesson check is not on `main`.**

## Working tree and branches

The tree is clean. The docs-only branch `feature/m18-progression-enforcement` was cut from
`857a430` for this report. Open PRs touching the same files: #48 and #55 (`sessions.ts`), and
#55 (`placement.ts` and the new test file). #54, #51 and #52 read progress but don't write it.

## Known baseline failures

- **GitHub Firefox (advisory):** 4 tests fail on `main`: `accessibility` light and dark,
  `disputes`, `offline-progress`.
- **Local:** Docker and `age` aren't installed (BLOCKED).
