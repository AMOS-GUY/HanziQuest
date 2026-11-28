# M18 security review

**Attacker:** a signed-in learner who can:

- modify the browser code;
- call `/api/*` directly with any body;
- change the device clock;
- replay or reorder requests, and send concurrent ones;
- create devices (`deviceId`);
- hand-build offline sync batches.

## Entry points that can write progression (re-checked on `d177eba`)

`grep` for writes to `exerciseAttempt`, `attemptCharacterResult`, `characterMastery`,
`reviewSchedule`, `xPTransaction`, `dailyActivity`, `streak`, `userAchievement` and
`lessonProgress` finds exactly these writers:

- `features/exercises/attempts.ts`
- `features/progress/record.ts`
- `features/learning/sessions.ts`
- `features/assessment/placement.ts`
- `features/offline/sync-service.ts`
- `scripts/rebuild-progress.ts` (an operator CLI)

All attempt writes go through `submitAttempt`, and the enforcement is inside it.

## Attempts to bypass

| Attempt                                                                          | Result                                                               |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Send `preview: false`, `counted: true`, `countsForProgress: true` or `xpAwarded` | Stripped by the schema. Eligibility comes from the database. Tested. |
| Practise a locked character through `/practice/character`, the API or sync       | Preview. No side effects. Tested.                                    |
| Name a reached lesson's session for a locked exercise                            | `conflict`: the exercise isn't in the session's lesson. Tested.      |
| Name a review session for an unlearned character                                 | `conflict`. Tested.                                                  |
| Claim `lessonId` of a reached lesson for a locked exercise                       | `conflict`. Tested.                                                  |
| Use another learner's session                                                    | `not_found`. Tested.                                                 |
| Reuse a finished session                                                         | `conflict`. Tested.                                                  |
| Re-attach preview attempts or other lessons' attempts at offline completion      | Not attached. Completion counts only counted attempts. Tested.       |
| Backdate online attempts to fake spaced reviews, streak days or past caps        | Server time. Mastery stays LEARNING, one activity day. Tested.       |
| Backdate offline attempts before the download or session start                   | Rejected. Tested.                                                    |
| Future-date offline attempts                                                     | Clamped to now. Tested.                                              |
| Invent a device to get an early download time                                    | A new device's first download is _now_. Past times can't be created. |
| Replay a batch or an attempt; send concurrently                                  | Idempotent: the stored outcome, no new rows. Tested.                 |
| Re-download to move the authorization window                                     | The download route never updates `firstDownloadedAt` (code review).  |
| Malformed or partial batch                                                       | Each event is judged alone. Rejected events stay rejected. Tested.   |

## Residual risks (not closed by M18)

1. **Device time inside a legitimate offline window.**
   - The gap: between a lesson's first download on a device and now, the device's clock is
     trusted, as D-085 allows for offline learning. A learner who downloaded a lesson 25 days
     ago can still submit offline attempts with chosen spaced times inside those 25 days.
   - What limits it: the true download date bounds it, and so does the 30-day limit.
   - Fully closing it would need a trusted clock, such as server-issued signed time tokens,
     which this architecture doesn't have.
   - Medium-low. Self-only.
2. **Client-reported effort signals (pre-existing, M17 F-07 and F-08).**
   - Guided mistake counts can earn at most 5 XP, and never mastery.
   - `hintsUsed` can be under-reported.
3. **Legacy data.** Progress earned before M18 through locked practice or backdating isn't
   rewritten. Schedules created that way keep those characters reviewable.
4. **Time-zone changes (M17 F-10).** "Today" can be shifted by about a day. This is unchanged and
   remains a policy question.
5. **#48 is unmerged.** An empty lesson can still be completed on `main` until #48 merges
   (M17 F-05).

## Not done, by design

- No new session-expiry policy.
- No device attestation.
- No server-signed offline tickets.

These are recorded as options for residual 1 only.

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
