# M18 handover

**Branch:** `feature/m18-enforcement`, from `main` `b6c5160`. **Not merged and not deployed.**
No production or staging database was accessed. Only the local `hanziquest` and
`hanziquest_test` were used.

## Commits

| Commit        | Content                                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d177eba`     | The implementation: `attempt-context.ts`, the `submitAttempt` integration, completion and sync re-attachment, M15 overview, runner notice, migration, tests |
| (docs commit) | `docs/m18/*`, D-085 in `DECISIONS.md`, `SECURITY.md`, `OFFLINE.md`, `PROGRESS.md`, `CLAUDE.md` guidance. Docs only.                                         |

## Validation (local `npm run ci:local` on `d177eba`)

**Result: 25 PASS, 4 BLOCKED, 2 NOT RUN, exit code 0.**

| Check                                                                                                            | Result                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install tree, dependency audit, migration safety (18 migrations, none destructive), lint, format, types, content | PASS                                                                                                                                                                                                                                              |
| Unit                                                                                                             | 330 passed                                                                                                                                                                                                                                        |
| Integration (fresh test database)                                                                                | **222 passed**, including 30 in the matrix                                                                                                                                                                                                        |
| Migrate and seed, backup and migration drills                                                                    | PASS                                                                                                                                                                                                                                              |
| Production build, smoke test, local Docker-equivalent start-up and refusal                                       | PASS                                                                                                                                                                                                                                              |
| Chromium e2e                                                                                                     | **46 passed, 1 flaky, 25 skipped.** The flaky test is `disputes.spec.ts`: the admin resolved-list wait timed out once and passed on retry. That flow isn't changed by M18. The offline e2e tests (`offline-progress`, `offline-accounts`) passed. |
| Docker (3 steps), `age` encryption                                                                               | **BLOCKED:** not installed locally. GitHub CI runs them.                                                                                                                                                                                          |
| Firefox e2e                                                                                                      | **NOT RUN locally** (advisory). GitHub CI runs it. On `main` it has 4 pre-existing failures.                                                                                                                                                      |

**Coverage gap:** the docs commit came after this run. It changes no code; formatting was checked
on it.

## Dependencies

- **#48** (D-084, empty lessons) is open. M18 doesn't depend on it.
- **Expected conflict:** both #48 and M18 add an entry at the top of `DECISIONS.md`, so whichever
  merges second gets a conflict there. Resolve it by keeping both, with D-085 above D-084.
- `sessions.ts`: the hunks are separate. Check with `git merge-tree` before merging.
- **#54** (explorer) uses the same lesson-state source. No file overlap.

## Remaining risks

See `M18-security-review.md`:

- device time inside a legitimate offline window;
- client-reported guided mistakes and hints;
- legacy pre-M18 progress isn't rewritten;
- time-zone changes;
- #48 is unmerged.

## Deploy notes (for the owner's manual flow)

- **Migration:** additive only. The workflow migrates before the deploy hook (D-050, D-055).
- **Order:** staging first.
- **What learners will notice:**
  - practising a locked lesson's character now shows a preview notice instead of XP;
  - online attempts never fail because of a wrong device clock;
  - offline attempts dated before a lesson's download on that device are rejected.

## Final review (2026-11-28, after #57 merged; branch `fix/m18-review`)

| Concern                        | Finding                                                                                                                                                      | Change                                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Preview notice              | **Confirmed:** "This counts once you reach its lesson" implied later credit, which contradicts D-085                                                         | Now "Preview practice: this doesn't count toward your progress.", also on the end screen. A pure `saveStatusText` function with a unit test, which fails if the text promises later credit.                                                                                                                               |
| 2. Offline authorization reuse | Not confirmed. Time evidence is scoped to learner, device and the lessons containing the exercise. A download never grants eligibility.                      | 6 adversarial tests: download of A versus a locked B exercise; versus another curriculum's shared-character exercise; another learner reusing a device id; a forged download row for a locked lesson; session-less attempts claiming another lesson or another learner's session                                          |
| 3. First download preserved    | Holds. The download route's update never touched it.                                                                                                         | The recording moved, unchanged, into `features/offline/downloads.ts` and is tested: re-downloads, including ones dated earlier, keep it; other learners and devices get their own                                                                                                                                         |
| 4. Offline time                | Holds: 5-minute skew, future clamp, 30-day limit, retries, duplicates                                                                                        | A **RESIDUAL** test pins the documented limit: inside a real download window, chosen spaced times are accepted, but never before the download                                                                                                                                                                             |
| 5. Session-less offline        | Holds. The same eligibility and session checks apply.                                                                                                        | Covered by 2                                                                                                                                                                                                                                                                                                              |
| 6. Analytics                   | Learner surfaces (Progress, Home summary, achievements) read only counted tables. **The admin overview mixed raw attempts and the pass rate with previews.** | The admin overview shows "Practice attempts (all, previews included)", "Preview practice (not counted)", and a pass rate over counted attempts only. M15 overview already excluded previews.                                                                                                                              |
| 7. Migration                   | The backfill and existing records were untested                                                                                                              | `drill:migrations` step 2b: migrate to just before M18, insert a download and an attempt, apply M18. `firstDownloadedAt` equals `downloadedAt`; the attempt keeps `countsForProgress = true`, its time and XP; `clientOccurredAt` stays null. Rollback: the old code ignores the columns, and there is no down migration. |
| 9. Wording                     | D-085's title said "trusted time"                                                                                                                            | Now "validated time". SECURITY.md and OFFLINE.md state that the device clock is trusted inside the window.                                                                                                                                                                                                                |
