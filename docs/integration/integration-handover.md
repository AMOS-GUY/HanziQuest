# Integration handover (2026-11-28)

**No PR was merged by this mission, and nothing was deployed.** No production or staging data
was accessed.

## Final state

|                               | Head                                            | GitHub                                                                                              | Local `ci:local`                                                    |
| ----------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `main`                        | `6a2ae56` (#59 merged by the owner)             | CI success                                                                                          | —                                                                   |
| **#48** empty lessons (D-084) | `dd6a7bb` (`main` merged in, conflict resolved) | **MERGEABLE, CLEAN; `verify` and `docker` success**                                                 | 25 PASS / 4 BLOCKED / 2 NOT RUN, exit 0 (after one re-run, see I-1) |
| **#58** M18 review            | `30ae516` (`main` merged in, no conflict)       | MERGEABLE. `docker` success. **`verify` in progress** at the last reading. Check it before merging. | 25 PASS / 4 BLOCKED / 2 NOT RUN, exit 0                             |
| **#59** M19                   | merged as `6a2ae56`                             | merged                                                                                              | (validated before it merged)                                        |

**BLOCKED and NOT RUN locally** (GitHub CI runs them):

- **BLOCKED:** Docker (3 steps) and `age` encryption.
- **NOT RUN:** Firefox e2e (advisory) and the report upload.

## What was done

- **#48:** the `DECISIONS.md` conflict is resolved by keeping both D-085 and D-084, unchanged,
  newest first. No code conflict.
- **#58:** brought up to date with `main`.
- **Combined:** `main` + #48 + #58 checked together. No conflicts, both decisions present, 18
  migrations with no duplicates and no schema change, no dependency change, and the tests pass.
  See `integration-validation.md`.

## Protected areas (confirmed untouched by this mission)

- XP, mastery, streaks, review scheduling, completion, unlocking and placement policies.
- The D-085 enforcement code.
- Authentication and authorization.
- Schema and migrations.
- Offline sync.
- Content.
- Deployment.

The only edits were the merge commits and the `DECISIONS.md` conflict resolution.

## Outstanding risks and issues

- **I-1 (pre-existing, P3):** invite codes whose random part starts with "HQ" don't match
  without their prefix. The unit test fails at random, about 1 run in 1,024. Recommend a small
  follow-up PR; the fix is in `integration-validation.md`.
- **#58 GitHub `verify`:** was still running when this was written.
- **Residual risks from M18** are unchanged and documented: device time inside an offline
  window, client-reported guided mistakes and hints, legacy data.

## Recommended merge sequence

1. **#48.** It is green and CLEAN, and it closes M17 F-05 (empty lessons can be completed for
   XP).
2. **#58,** once its GitHub `verify` passes. It merges cleanly with or without #48. If #48 is
   merged first, GitHub may ask to update #58's branch; `merge-tree` shows that will be clean.
3. **This docs PR,** in any order. It only adds `docs/integration/`.
4. Then a follow-up for I-1.
