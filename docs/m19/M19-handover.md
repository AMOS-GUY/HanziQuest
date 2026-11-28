# M19 handover

**Branch:** `feature/m19-learner-experience-quality`, from `main` `4193d91`. **Not merged and not
deployed.** Only local databases were used.

| Commit        | Content                            |
| ------------- | ---------------------------------- |
| `190e196`     | All fixes and tests (F-01 to F-09) |
| (docs commit) | `M19-validation.md`, this handover |

## Summary

- **Audited:** about 20 learner, onboarding and public surfaces at 6 viewport sizes, light and
  dark.
- **Findings:** 9 fixed and 4 not fixed, with no P0 or P1 (`M19-findings.md`).
  - **Fixed:** 6 P2, 3 P3.
  - **Not fixed:** N-01 to N-04, deferred to open PRs, inherent, or test-environment only.
- **Tests:** 12 unit tests and 4 e2e tests added. The flaky dispute e2e is fixed.

## Dependencies

- `git merge-tree` is clean against #49, #51, #52, #54, #58 and the docs PRs.
- #48 conflicts only with `main`, in `DECISIONS.md`, from M18. M19 doesn't touch that file.

## Next

1. Merge #49. Practice pages then get their `<h1>` (N-01).
2. A real screen-reader pass (NVDA or VoiceOver) over onboarding, placement and character
   practice.
3. After #49, #52 and #58 settle, a follow-up on the practice runner's feedback and end screens,
   which M19 audited but didn't change.
