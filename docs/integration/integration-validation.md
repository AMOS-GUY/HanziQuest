# Integration validation (2026-11-28)

## #48: conflict resolution (`dd6a7bb`)

- `main` was merged into the branch with a normal merge commit. No history was rewritten and
  nothing was force-pushed.
- **`DECISIONS.md`:** both sections were kept, newest first: D-085 (2026-11-28) above D-084
  (2026-11-21).
  - Against `main`: 0 lines removed, and only D-084's section added.
  - Against #48's head: 0 lines removed.
- **`sessions.ts`:** merged automatically. D-084's no-exercises guard runs after D-085's
  visibility check and the counted-attempts query.
- **Targeted tests:** `empty-lesson`, `progression-integrity`, `learning`: 49 passed.
- **Local `ci:local` on `dd6a7bb`:**
  - The first run failed one unit test in `operations.test.ts`: "invite codes … hash them
    case- and dash-insensitively". The cause is a **pre-existing, rare bug** (issue I-1 below),
    not #48.
  - The re-run: **25 PASS, 4 BLOCKED, 2 NOT RUN, exit 0**.

    | Suite        | Result                         |
    | ------------ | ------------------------------ |
    | Unit         | 342 passed                     |
    | Integration  | 231 passed                     |
    | Chromium e2e | 51 passed, 0 flaky, 29 skipped |

- **GitHub CI on `dd6a7bb`:** `verify` success, `docker` success. MERGEABLE, CLEAN.

## #58: updated to `main` (`30ae516`)

- `main` (with #59) merged in with no conflicts. #58's files don't overlap #59's.
- **Targeted:**
  - `save-status` and `choice` unit tests: 8 passed;
  - `progression-integrity`: 37 passed;
  - `drill:migrations`, including step 2b (backfill: `firstDownloadedAt` equals `downloadedAt`;
    existing attempts keep `countsForProgress`, their time and XP): all checks passed.
- **Local `ci:local` on `30ae516`:** **25 PASS, 4 BLOCKED, 2 NOT RUN, exit 0.**

  | Suite        | Result                         |
  | ------------ | ------------------------------ |
  | Unit         | 345 passed                     |
  | Integration  | 229 passed                     |
  | Chromium e2e | 51 passed, 0 flaky, 29 skipped |

- **GitHub CI on `30ae516`:** see `integration-handover.md`, which records the final reading.

## Combined check (a local branch, not pushed, deleted afterwards)

`main` + #48 + #58 merged together:

- **No conflicts.**
- **Decisions:** D-085 (with #58's "validated time" title) and D-084 both present.
- **Migrations:** 18, the newest `20261127200200_m18_progression_integrity`. No duplicates.
  Neither PR adds a migration or changes the schema. `prisma validate` and
  `db:check-migrations` pass.
- **Dependencies:** no `package.json` or lockfile changes, and `npm ls --all` is OK.
- **Checks:** lint and types clean, unit 345 passed, and the progression integration suites
  (`empty-lesson`, `progression-integrity`, `learning`, `progress`, `placement`,
  `session-start-race`) 79 passed.

## Not run locally (GitHub CI runs them)

- Docker build and run (3 steps) and `age` encryption: BLOCKED, not installed.
- Firefox e2e: advisory. `main` has 4 pre-existing failures there.

## Issue found: I-1, pre-existing, not fixed here

`features/invites/invites.ts` `normaliseCode` strips a leading "HQ". A generated code whose
random part also starts with "HQ" (for example `HQ-HQ7K2-9ABCD`) hashes differently when typed
without its prefix (`HQ7K2-9ABCD`).

- **Reproduced:** with that code the two hashes differ; with a control code they match.
- **Origin:** introduced in M9 (`b53b11f`).
- **Effect on the tests:** the unit test picks a random code, so it fails about 1 run in 1,024.
- **Effect on learners:** a learner given such a code who omits the "HQ-" prefix is told the
  code is invalid. Codes are normally pasted in full.
- **Not fixed** because it is unrelated to these PRs. The fix: strip "HQ" only when the
  normalised code is longer than the 10-character body, and add a deterministic test for that
  case.
