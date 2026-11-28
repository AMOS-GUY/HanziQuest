# M18 test matrix

**Where the tests are:**

- **New:** `tests/integration/progression-integrity.test.ts`. Every case checks persisted rows
  through a `sideEffects()` probe covering XP rows, character results, mastery, schedules,
  daily activity, streak length, achievements and completions.
- **Existing:** tests already in the repository, named by file.
- **e2e:** `tests/e2e/*` through `npm run ci:local`.

Results are in the PR description and `M18-handover.md`.

## A. Locked preview practice

| #   | Case                                                                                        | Test                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Feedback returned                                                                           | New "is graded with feedback…" (band and evaluation)                                                                                             |
| 2–7 | No XP, mastery, mastery history (`AttemptCharacterResult`), schedule, streak or achievement | The same test (`sideEffects` equals `NONE`)                                                                                                      |
| 8–9 | Can't complete; can't unlock                                                                | The same test (still LOCKED, start refused); "offline completion attaches only…"                                                                 |
| 10  | Duplicate preview, including concurrent                                                     | New "retries and duplicates stay previews"                                                                                                       |
| 11  | Direct API                                                                                  | `submitAttempt` is what `POST /api/attempts` calls. Every F-01 test.                                                                             |
| 12  | Offline sync                                                                                | New "offline sync can't turn a preview into progress"; "an offline locked attempt is a preview"                                                  |
| 13  | Forged flags                                                                                | New "forged client flags change nothing"                                                                                                         |
| 14  | Shared characters                                                                           | New "a character shared with a reached lesson elsewhere counts…"; "a word with one unreached character is a preview"                             |
| 15  | Reached through another lesson, and no retroactive credit                                   | New "once the lesson is reached, attempts count, and earlier previews are never credited"; control "a reached lesson's attempt counts as before" |

## B. Attempt, session and lesson

| #     | Case                                                                                      | Test                                                                                 |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | Valid                                                                                     | New "accepts the session's own lesson"                                               |
| 2     | Another learner's session                                                                 | New "refuses another learner's session"; existing `learning.test`                    |
| 3–6   | Another lesson; unrelated exercise or curriculum; session and lesson or exercise mismatch | New "refuses exercises of other lessons…"; "refuses a lesson id that doesn't match…" |
| 7     | Invalid state (finished)                                                                  | New "refuses a finished session…"                                                    |
| 8     | Forged lesson id                                                                          | New "refuses a lesson id…" (including a locked exercise claiming a reached lesson)   |
| 9     | Shared character, legitimate                                                              | A14                                                                                  |
| 10–11 | Locked lesson through the API and sync                                                    | A11 and A12                                                                          |
| 12    | Duplicate                                                                                 | New "refuses a finished session; a retry … is still idempotent"                      |
| 13    | Unrelated data can't complete a lesson                                                    | New "offline completion attaches only the lesson's own counted attempts"             |
| —     | Review session takes only reviewed characters                                             | New "a review session only takes characters the learner is reviewing"                |

## C. Online time

| #   | Case                                                                                        | Test                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4 | Server time authoritative; old, future or skewed claims ignored and not refused; claim kept | New "ignores a backdated, future or skewed client clock…"; `learning.test` "validates kind, drawing count and time"                                 |
| 5   | Idempotent                                                                                  | New "duplicates stay idempotent"                                                                                                                    |
| 6–9 | Mastery, schedule, streak and daily goal use server time                                    | New "a backdated 'spaced' sequence no longer builds mastery, streak days or past activity (M17 F-02)"; character results carry the server time (C1) |

## D. Offline time

| #        | Case                                                       | Test                                                                                |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1, 2, 11 | Legitimate offline attempt, synced days later              | New "accepts a downloaded lesson practised offline days ago…"                       |
| 3, 4     | Predates download or session                               | New "rejects attempts dated before…"; "uses the session start as evidence…"         |
| 5        | Future                                                     | New "allows clock skew…, clamps future times…"                                      |
| 6        | Manipulated spaced history                                 | New "a manipulated spaced history before the download is refused entirely"          |
| 7–10     | Retry, duplicate, partial failure and its retry            | New "rejects attempts dated before … and a retry changes nothing"                   |
| 12, 14   | Boundary ± skew                                            | New "allows clock skew at the boundary…" (−4 min accepted, −6 min rejected)         |
| 13       | Time-zone boundary                                         | New "books an accepted offline attempt on the learner's local day…" (Asia/Shanghai) |
| 15, 16   | Offline preview, offline locked attempt                    | New "…an offline locked attempt is a preview"                                       |
| —        | No server record                                           | New "with no server-recorded access, uses the server's time"                        |
| —        | End-to-end offline flow (download, offline practice, sync) | Existing e2e `offline-progress.spec.ts`, `offline-accounts.spec.ts`                 |

## E. Regression

| Item                            | Test                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| M17 F-01, F-02, F-06            | Groups A, C and D (the M17 characterization tests replaced)                                     |
| M17 F-03, F-04                  | New "completion follows publication", "placement is graded once" (kept)                         |
| M17 F-05, #48 empty lesson      | **#48 is unmerged.** Its test isn't on this branch. `merge-tree` with #48 is checked in the PR. |
| Lock protections                | New A1 (start refused); existing `learning.test`; e2e `learning-journey`                        |
| Idempotency, caps, replay, sync | Existing `progress.test`. The streak and review tests now simulate days with the server clock.  |

## Not covered by an automated test

- **DST transitions specifically.** Days use `Intl` per time zone (`calendar.ts`). There's no
  DST-specific case.
- **The download route's "re-download never moves `firstDownloadedAt`".** Checked by code
  review: the update sets only `contentVersion` and `downloadedAt`. The e2e covers a single
  download.
