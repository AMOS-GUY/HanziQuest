# M17 handover

**Branch:** `feature/m17-progression-integrity`, from `main` `857a430`. **Not merged and not
deployed.** No production or staging database was touched. All probes ran against
`hanziquest_test`.

## What changed

| Commit               | Content                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b37d28d`            | Class 1 fixes F-03 (completion re-checks visibility) and F-04 (placement graded once), and the matrix `tests/integration/progression-integrity.test.ts` |
| `a2ef4d7`, `051b4ec` | `docs/m17/*` and a PROGRESS M17 section                                                                                                                 |
| (this file)          | The handover. Docs only, added after the local CI run                                                                                                   |

There are no migrations, no schema changes, and no changes to XP values, thresholds, scheduling,
streaks or unlocking.

## Decisions waiting for the owner

1. **F-01: does practice on locked characters count?** Options A, B and C are in
   `M17-locked-practice-policy.md`. Option B (preview practice) is recommended, with "reached
   anywhere" for shared characters and no retroactive credit.
2. **F-02: trust in client attempt times.** Restrict the online window to clock skew, and bound
   sync attempts by the lesson's first download time. Details are in `M17-audit-findings.md`.
3. **F-06: binding an attempt to its session.** Decide it together with F-01.
4. **F-10: how often the time zone may change.** Low priority.

## Ordering and dependencies

- **#48** (empty lessons, D-084) is independent: `merge-tree` is clean, in different hunks of
  `completeLessonSession`. Merge it first, then add **D-085** (text in `M17-remediation.md`) to
  `DECISIONS.md`. Doing that now would conflict with #48's D-084 at the top of the file.
- **#54** (explorer) is independent: `merge-tree` is clean.
- Implementing F-01 or F-02 means a new PR from this branch's tests. Flip the characterization
  assertions in that PR.

## Validation

See the PR description. It has the exact local and GitHub results, including what couldn't run
locally (Docker, `age`) and the advisory Firefox job.

## Recommended next mission

Implement the F-01 decision, Option B if approved, in `submitAttempt`. Implement F-06 in the same
change. Then decide F-02, which needs a small expand migration for the first-download time.
