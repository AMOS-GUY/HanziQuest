# M15 plan: onboarding, retention and learning measurement (discovery, 2026-11-14)

Read-only discovery against the code on `feature/m14b-status-and-verification`. Scope comes from
ROADMAP.md (M15, approved order of 2026-11-12). Nothing here is built yet. M15 starts after the
M14-b follow-up PR is merged, and only with the owner's go-ahead.

## Existing implementation

| Area                 | What exists                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored learning data | `AttemptCharacterResult` (per character: mode, result, score, technique, `occurredAt`), `LearningSession`, `LessonProgress`, `DailyActivity`, `Streak`, `CharacterMastery`, `ReviewSchedule` (current state only), `PlacementAssessment` |
| Replay               | `replayCharacter` (`features/progress/mastery.ts`) rebuilds mastery and the schedule from attempt results: the basis for interval-at-review                                                                                              |
| Admin aggregates     | `/admin` shows counts for `analytics:read` (active learners, new accounts, attempts, independent passes, lessons completed, sync rejections, samples), with no per-learner data                                                          |
| Onboarding           | Goal and placement (`features/onboarding`, `features/assessment`); `completeOnboarding` is covered by e2e                                                                                                                                |
| Retention in the app | The home page shows characters due now; daily activity and streaks are recorded                                                                                                                                                          |
| Privacy              | The privacy notice says there are no analytics trackers; the CSP forbids third-party scripts                                                                                                                                             |

## Missing

1. **Metric services** (`features/measurement/*`, pure functions plus queries), each with an n:
   - **activation:** first lesson completed within 24 h of signing up
   - **return:** D1, D7 and D30 (from `DailyActivity`)
   - **due-review completion:** reviews done by the next day, among those due. The due dates
     aren't stored, so they're rebuilt by replay.
   - **recall success on due reviews, by interval bucket:** the core measure. It needs the
     interval in force at each review, so `replayCharacter` is extended to emit per-event
     intervals (a pure change with no new tracking).
   - **lapse rate**
   - **time to FAMILIAR and to MASTERED**
   - **placement accuracy:** tested-out characters that later fail
2. **Admin page** (`analytics:read`): aggregates only, a minimum cohort size (5, suppressed
   below that), n shown everywhere, and cohorts by signup week.
3. **Onboarding walkthrough** on a phone and a desktop, with each finding fixed or logged: copy,
   the length of placement, empty review states, a "come back tomorrow" message.
4. **Retention aids:** the next-review time on the home page (only "due now" today), a
   daily-goal streak with one grace day, and an optional in-app reminder. No email or push.
5. **Privacy notice:** one sentence on aggregate learning statistics. Bump `LEGAL_VERSION` only
   if that's material (owner).

## Dependencies

- Nothing external is needed to build it. Meaningful numbers need beta learners (M17).
- Legal wording goes with the M17 legal pass.
- It shouldn't overlap the M14-b follow-up PR (it doesn't touch the same files).

## Architectural risks

- **Replay cost:** recall by interval replays every learner's history. Bound it (cohort and date
  range), stream it per learner, and measure it with synthetic data, as for the review queue.
- **Small numbers:** suppress cohorts under the minimum, and show n and an interval (Wilson)
  for every rate.
- **Privacy drift:** no new tracking, no per-learner drill-down, CSP unchanged. That's enforced
  by tests that the page's queries return aggregates only.
- **Streak pressure:** the grace day and wording follow the calm-UX principles. No loss-framing
  copy.
- **Offline attempts:** `occurredAt` comes from the device. Use it for intervals, but keep
  server receipt for cohorts.

## Suggested sequence (one branch and PR each)

1. **M15-a (2 days):** extend replay with per-event intervals, plus the metric services and
   their tests (fixtures, local database).
2. **M15-b (1–2 days):** the admin measurement page with suppression; accessibility and e2e.
3. **M15-c (1–2 days):** the onboarding walkthrough on phone and desktop, then the fixes.
4. **M15-d (1 day):** retention aids (next-review time, the streak grace day).
5. **Docs and privacy wording** (owner review).

Estimate: 5–7 development days, consistent with the roadmap.

## Acceptance criteria (from the roadmap, made testable)

- Every metric is computed in a `features/*` service from stored data, with unit tests on
  fixtures and integration tests on the local database.
- Cohorts below the minimum are suppressed (test).
- No new third-party requests: the CSP is unchanged (an existing test).
- Recall by interval bucket can be produced for a cohort (an integration test with synthetic
  learners, labelled synthetic).
- The first-run path has been walked on phone and desktop, with its findings fixed or logged.

## Test strategy

- **Unit:** metric functions on hand-built event sequences, including edge cases (no reviews,
  only lapses, offline clocks).
- **Integration:** synthetic learners in the local database, with known expected values.
- **E2E:** the admin page (permission, suppression), onboarding paths (phone and desktop) and
  axe.
- **Performance:** synthetic cohorts (1,000 learners and 100,000 attempts), measured like the
  M14-b benchmarks.

## Owner decisions

1. Go-ahead for M15 after the M14-b follow-up PR.
2. The minimum cohort size (5 is proposed).
3. The privacy-notice sentence, and whether it's material (a `LEGAL_VERSION` bump).
4. Streak grace rules, and whether an in-app reminder is wanted at all.
