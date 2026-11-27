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
