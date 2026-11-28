# M18 baseline: progression integrity enforcement

## Update, 2026-11-28: implementation started

**Verified, not assumed:**

| Item                           | State                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main`                         | `b6c5160`: #56 (this folder's first docs) on top of `490f38b` (#55 M17, merged 2026-11-27 19:58 UTC). CI on `b6c5160` was running at the start.                                                                                                                                                                                     |
| **#55**                        | **Merged.** Its F-03 and F-04 fixes are present (`sessions.ts` visibility check, `placement.ts` conditional `updateMany`), and so is its 10-test matrix.                                                                                                                                                                            |
| **#48** (empty lessons, D-084) | **Still open, not merged.** It isn't needed for M18's baseline. M18 doesn't depend on it and doesn't duplicate it. Its change is a separate hunk in `completeLessonSession`. The only overlap is the top of `DECISIONS.md`, where both add an entry, so whichever merges second gets a two-entry conflict: keep both, newest first. |
| #54 (explorer)                 | Open. It reads lesson states, the same source M18's eligibility uses.                                                                                                                                                                                                                                                               |
| Branch                         | `feature/m18-enforcement` from `b6c5160`.                                                                                                                                                                                                                                                                                           |
| Environment                    | Local only (`localhost:5433`, `hanziquest` and `hanziquest_test`). No staging or production access.                                                                                                                                                                                                                                 |

**Known baseline failures:**

- **GitHub Firefox (advisory):** 4 tests on `main`: `accessibility` light and dark, `disputes`,
  `offline-progress`.
- **Local:** Docker and `age` aren't installed.
- **Long-lived local test database:** `disputes.test.ts` "nobody reviews their own dispute"
  fails against the long-lived local `hanziquest_test`. It holds 46 open disputes from earlier
  runs, and the queue shows the oldest 20. `ci:local` creates a fresh test database. Its result
  is in `M18-handover.md`.

## Original report (2026-11-27, before #55 merged)

Implementation was blocked then: #55 and #48 were open, and M18 had to build on #55. That's
resolved for #55. The architecture and design analysis is in `M18-architecture.md`.
