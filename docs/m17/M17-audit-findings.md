# M17 audit findings

**Severity** follows the mission's definitions. Because progression is visible only to the
learner and to aggregate analytics, no finding is rated High or Critical.

**Class 1** means an existing-policy bug: fixed here. **Class 2** means a product decision: it
waits for the owner.

**Evidence** comes from `tests/integration/progression-integrity.test.ts` (the matrix) unless
stated otherwise.

| ID                                                                                     | Severity | Class                      | Status                                                                        |
| -------------------------------------------------------------------------------------- | -------- | -------------------------- | ----------------------------------------------------------------------------- |
| F-01 Locked-lesson content counts toward progression                                   | Medium   | 2                          | **Verified, unfixed.** Proposal: `M17-locked-practice-policy.md`              |
| F-02 Backdated attempt times forge spaced repetition, streak days and extra daily caps | Medium   | 2                          | **Verified, unfixed.** Proposal below                                         |
| F-03 A lesson unpublished or archived mid-session could still be completed             | Low      | 1                          | **Verified, fixed**                                                           |
| F-04 Concurrent placement submissions were both graded                                 | Low      | 1                          | **Verified, fixed**                                                           |
| F-05 A lesson with no published exercises completes vacuously                          | Medium   | 1                          | Verified by #48's own tests. **Fixed in #48 (unmerged)**, not duplicated here |
| F-06 An attempt may name any session the learner owns                                  | Low      | 2 (semantics undocumented) | **Verified, unfixed.** No completion effect                                   |
| F-07 Guided mistake counts are client-reported                                         | Info     | —                          | Documented and accepted (SECURITY.md)                                         |
| F-08 `hintsUsed` is client-reported                                                    | Info     | —                          | Inherent: hints are shown in the browser                                      |
| F-09 The learner API doesn't require completed onboarding                              | Info     | —                          | Potential (code reading). No progression gain                                 |
| F-10 Changing time zone shifts "today" for caps and goals                              | Low      | 2                          | Potential (code reading). Not exercised                                       |

---

## F-01 · Locked-lesson content counts toward progression (Medium, Class 2)

- **Affected:** `submitAttempt`, reached through `/practice/character/[hanzi]`, `POST /api/attempts` and `POST /api/sync`.
- **Root cause:** `submitAttempt` checks that the exercise is published and in a learner-visible lesson. It never checks lesson state. Lesson state is enforced only when starting a lesson session, on the lesson practice page and on lesson download.
- **Reproduction** (matrix, "F-01" group; also the 2026-11-27 probe):
  1. A brand-new learner (lesson B is `LOCKED`) submits a session-less freehand attempt on lesson B's character.
  2. The same attempt, naming the learner's own lesson-A session.
  3. The same attempt through offline sync.
- **Actual:** the attempt is graded `EXCELLENT` and awards **10 XP**. It creates a `CharacterMastery` row and a `ReviewSchedule` row. The character then enters the review queue (`LEARNER_REVIEWABLE_CHARACTER` needs visibility, not reach), and counts toward achievements (`characters_written`). It doesn't unlock or complete anything: the lesson stays `LOCKED`, which is tested.
- **Expected:** **undocumented.** `SECURITY.md` says attempts are accepted "only for published exercises in published lessons… Locked lessons can't be started." It doesn't say whether locked content may count. That makes this a product decision, not a broken rule.
- **Exploitable by an ordinary learner:** yes, from the UI: locked lesson → character → Practise.
- **Affected records:** `ExerciseAttempt`, `AttemptCharacterResult`, `XPTransaction`, `DailyActivity`, `CharacterMastery`, `ReviewSchedule`, `Streak`, `UserAchievement`.
- **Proposed remediation:** Option B, preview practice, in `M17-locked-practice-policy.md`. It needs approval.
- **Regression test:** the matrix's F-01 group pins today's behaviour. Flip it with the approved policy.

## F-02 · Backdated attempt times replay as spaced reviews (Medium, Class 2)

- **Affected:** `submitAttempt` (online and sync), `applyAttemptProgress`, and the mastery replay.
- **Root cause:** `occurredAt` is client-supplied, and accepted from 30 days back to 5 minutes ahead. The window exists for offline practice (D-022, D-024). The replay orders history by `occurredAt` and advances SRS only when a review is "due". The XP day, daily caps and streak days come from `occurredAt` too.
- **Reproduction** (matrix, "F-02"): in one sitting, submit graded attempts with `occurredAt` set to 25 days ago, then each time to the moment the stored schedule says it is due.
- **Actual:** the character reaches **FAMILIAR or better**. The tested assertion is `["FAMILIAR", "MASTERED"]`. **DailyActivity is booked on 3 or more past days**, so streak days and per-day XP caps are minted retroactively. Every request is made now.
- **Expected:** undocumented. D-020 says "writing it ten times in one sitting doesn't inflate intervals". That holds for honest timestamps only.
- **Exploitable:** with scripting. It needs ink that passes grading, and a learner can replay their own.
- **Proposed remediation** (needs approval: it changes which attempts are accepted):
  1. `POST /api/attempts`, the online path, accepts only `occurredAt` within the clock skew of now. The browser always stamps attempts at submit time, and network failures are queued to sync instead (`practice-runner.tsx`), so this changes nothing for honest learners. On its own it doesn't close the issue, because sync is still open.
  2. Bound sync attempts by evidence of offline access. Require `occurredAt` ≥ the device's `DownloadedContentVersion.downloadedAt` for a lesson containing the exercise, minus the skew. This needs the first download time kept, not overwritten on re-download, which is an expand migration. It fits D-025: "offline means downloaded lessons".
  3. Optionally, use `min(occurredAt, receivedAt)` ordering for SRS "due" checks. That changes D-022's replay and isn't recommended without data.

## F-03 · Completion after unpublishing or archiving (Low, Class 1, fixed)

- **Affected:** `completeLessonSession`.
- **Root cause:** starting a lesson, attempts and downloads all check visibility. Completion didn't. `visibility.ts` says hidden content is hidden "including through direct links, offline downloads and the API".
- **Reproduction:** start lesson A and attempt everything. Then set the lesson to DRAFT (or archive the curriculum), then complete.
- **Actual before the fix:** completed, with the 20 XP completion grant.
- **After the fix:** `not_found`, no XP, the progress row isn't COMPLETED. Republishing lets the same session complete. Both cases are tested.
- **Ordinary learner?** No. It needs an admin action between start and finish.

## F-04 · Concurrent placement submissions both graded (Low, Class 1, fixed)

- **Affected:** `submitPlacement`.
- **Root cause:** the `IN_PROGRESS` check ran outside the transaction, followed by an unconditional update (check-then-act).
- **Reproduction:** submit the same assessment twice concurrently (`Promise.allSettled`).
- **Actual before the fix:** **both fulfilled**. That created duplicate `AssessmentResult` rows, and two completions were recorded.
- **After the fix:** a conditional `updateMany … status: IN_PROGRESS` runs first in the transaction. One submission is graded and the other gets `conflict`. The result count equals the number of questions. Tested both with and without tested-out lessons.
- **Ordinary learner?** Yes, by double-submitting. The impact is duplicate rows only. No XP is involved: placement grants none.

## F-05 · Empty lessons complete vacuously (Medium, Class 1, fixed in #48)

With 0 published exercises, D-019's checks pass trivially. #48 (D-084) refuses it and is green.
It isn't duplicated here. **Merge #48** to close it.

## F-06 · An attempt may name any owned session (Low)

`submitAttempt` checks session ownership only. The session's lesson, type and completed state
aren't checked. Effects:

- the XP reason label: a review session gives `REVIEW_COMPLETED`;
- `sessionId` on the attempt.

It has **no completion effect**, which is tested: completion counts only the session lesson's
own exercises. Requiring the exercise to belong to the session's lesson (or, for a review
session, to be due) is a reasonable tightening. But offline sync re-attaches session-less
attempts at completion, so the semantics need writing down first. That's why it's left for the
owner, in the same decision as F-01.

## F-07 to F-10

- **F-07.** Guided mistake counts are labelled `trust: "client-reported"`. They earn at most 5 XP and never count as mastery (D-012, D-020). Accepted.
- **F-08.** Hints are rendered in the browser, so the server can't verify `hintsUsed`. Under-reporting turns a hinted attempt into independent recall. Inherent. If it matters, server-delivered hints would be the mitigation.
- **F-09.** `requireApiUser` checks ACTIVE, not onboarding. A learner who skips onboarding gets the default time zone (UTC) and goal (30). No extra reward.
- **F-10.** The time zone is editable (onboarding and profile). Caps and the daily goal are per local day, so switching can create about one extra "day". Limited, and not exercised by a test.

## What was checked and holds

The threat model rows marked ✅. In particular:

- server-side grading;
- idempotency;
- forged XP and scores;
- concurrency under the advisory lock;
- cross-user ids;
- suspended and anonymous access;
- D-019 completion;
- no admin write path to progress.
