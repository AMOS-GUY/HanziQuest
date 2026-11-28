# M17 remediation

Only Class 1 fixes are made here: places where existing rules already define the expected
behaviour. No XP value, threshold, scheduling rule, streak rule or unlocking rule was changed.

## Fixed

### F-03 · Completion follows publication

`src/features/learning/sessions.ts`: `completeLessonSession` loads the lesson with
`VISIBILITY_SELECT`. If `isLearnerVisible` is false, it throws `not_found` before any completion
check.

- **Rule enforced:** `visibility.ts` says hidden content is hidden "including through direct
  links, offline downloads and the API". Start, attempts and downloads already enforced this.
- **Behaviour change:** completing a session whose lesson was unpublished, or whose curriculum
  was archived, is refused, and no XP or progress row is written. If the lesson is republished,
  the same session completes. Offline `lesson.complete` events for such lessons are rejected,
  consistent with their attempts already being rejected.
- **Not duplicated:** the existing visibility helpers are reused. #48's empty-lesson check is a
  separate hunk in the same function, and `git merge-tree` is clean.

### F-04 · A placement check is graded once

`src/features/assessment/placement.ts`: the first statement in the transaction is now
`updateMany({ where: { id, userId, status: "IN_PROGRESS" } })`. If it updates no row, the
submission is refused with `conflict` ("already finished"). Results and tested-out lessons are
written only after it.

- **Rule enforced:** the existing "This placement check is already finished" refusal. The
  project rule is that "transitions are conditional single updates".
- **Behaviour change:** none for a single submission. Concurrent duplicates now get `conflict`
  instead of both being graded.

### Proposed decision entry (add as D-085 after #48 merges)

The entry is kept here because #48 adds D-084 at the same place in `DECISIONS.md`. Adding it now
would conflict.

> **D-085 · Completion and placement follow the existing rules under concurrency and
> publication changes (M17).** Completing a lesson re-checks learner visibility. Placement
> completion is a conditional transition, so it is graded once. No policy changed. Locked-lesson
> practice (F-01) and attempt-time trust (F-02) are open owner decisions
> (`docs/m17/M17-locked-practice-policy.md`, `docs/m17/M17-audit-findings.md`).

## Not fixed (owner decision)

| Finding                          | Why it isn't fixed                                      | Proposal                                   |
| -------------------------------- | ------------------------------------------------------- | ------------------------------------------ |
| F-01 locked practice counts      | Whether previews count is undocumented policy           | `M17-locked-practice-policy.md` (Option B) |
| F-02 backdated times             | Changes which offline attempts are accepted             | `M17-audit-findings.md` F-02               |
| F-06 attempt or session mismatch | The semantics with offline re-attachment need defining  | Together with F-01                         |
| F-10 time-zone re-bucketing      | Policy (how often a learner may change their time zone) | Not proposed yet                           |
| F-05 empty lessons               | Already fixed in #48                                    | Merge #48                                  |

## Central enforcement

The central mechanisms exist and every pathway uses them:

- `submitAttempt` for online, sync and review attempts;
- `applyAttemptProgress` and `applyLessonCompletion`, inside one locked transaction;
- `completeLessonSession` for the API and sync;
- `getLessonStatesForLevel` for eligibility.

No route bypasses them, and no new system is needed. The missing piece is an eligibility check
inside `submitAttempt` (F-01), whose behaviour is the policy decision. It is a small, single-point
change once that decision is made.
