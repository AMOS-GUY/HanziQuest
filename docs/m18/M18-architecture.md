# M18 architecture: pathways, enforcement map, design and test plan

Traced from the code on `main` `857a430`. **Nothing here is implemented yet.** See
`M18-baseline.md` for why.

## Pathways that can create progression

```text
Browser (PracticeRunner: lesson | review | free character | admin preview*)
   │  online                                   │  offline / network failure
   ▼                                           ▼
POST /api/attempts ─────────────┐        IndexedDB outbox ──► POST /api/sync
POST /api/sessions              │                              (processSyncBatch)
POST /api/sessions/:id/complete │                                │  attempt │ lesson.complete
                                ▼                                ▼          ▼
                     submitAttempt ◄───────────────────────────────┘   startLessonSession
                     (parse, idempotency, time window,                completeLessonSession
                      published exercise, session owner,
                      server regrading)
                                │  one transaction + pg_advisory_xact_lock(userId)
                                ▼
                     applyAttemptProgress ── AttemptCharacterResult
                       ├─ recomputeCharacter ── CharacterMastery, ReviewSchedule (replay by occurredAt)
                       ├─ DailyActivity (exercisesCompleted, xpEarned, goalMet)
                       ├─ grantXp ── XPTransaction (idempotency keys) ── daily-goal bonus
                       ├─ recomputeStreak ── Streak
                       └─ checkAchievements ── UserAchievement (+ XP)
completeLessonSession ── LessonProgress COMPLETED ── applyLessonCompletion (XP, achievements)
submitPlacement (server action) ── LessonProgress TESTED_OUT, AssessmentResult (no XP)
Admin: publish, unpublish, archive (curriculum:publish) changes eligibility only
* admin preview submits nothing
```

**Every progression write goes through `submitAttempt` → `applyAttemptProgress`,
`completeLessonSession` → `applyLessonCompletion`, or `submitPlacement`.**

- No route writes XP, mastery or schedules directly.
- The only other writer is `progress:rebuild` (CLI), which replays mastery.
- Enforcement therefore belongs in `submitAttempt`, plus one check in `completeLessonSession`.

## Enforcement map (today → M18)

| Check                                             | Today                                        | M18 (planned)                                                                           |
| ------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Signed in, ACTIVE                                 | `requireApiUser`                             | unchanged                                                                               |
| Exercise published, lesson visible                | `submitAttempt`                              | unchanged                                                                               |
| **Lesson reached (F-01)**                         | **none**                                     | `submitAttempt`: an ineligible attempt is stored as a preview, with no progress effects |
| **Session belongs to lesson and exercise (F-06)** | owner only                                   | `submitAttempt`: owner, type, lesson ⊇ exercise, not completed                          |
| **Authoritative time (F-02)**                     | client `occurredAt` (−30 days to +5 minutes) | online: server time. Sync: validated against server-recorded authorization.             |
| Completion counts only official attempts          | n/a                                          | `completeLessonSession` and sync re-attachment ignore preview attempts                  |
| Lesson start locked or unpublished                | `startLessonSession`                         | unchanged                                                                               |

## Facts the design depends on

- **Exercises and lessons are many-to-many** (`LessonExercise @@id([lessonId, exerciseId])`).
  Exercises are per curriculum (D-007). Characters and mastery are global per learner. The
  same character can sit in a reached lesson of curriculum X and a locked lesson of curriculum
  Y.
- **Free character practice** (`getCharacterPractice`) picks the first published guided and
  freehand exercise for a character in _any_ visible lesson. It may pick curriculum Y's
  exercise even when the character is reached in X. So eligibility must be decided **per
  character**, not per exercise lesson.
- **Offline evidence the server records:**
  - `LearningSession.startedAt`: server time, for online-started sessions. Attempts queued after
    a mid-lesson network loss carry this `sessionId`.
  - `DownloadedContentVersion(deviceId, lessonId)`. **`downloadedAt` is overwritten on
    re-download.** The first authorization time is lost, so a column is needed.
  - `SyncEvent.receivedAt` and `ExerciseAttempt.receivedAt`: server receipt times.
  - The sync batch's `deviceId` is the same IndexedDB id used for downloads (`getDeviceId`).
- **Offline flows to preserve:**
  1. A downloaded lesson practised offline (`/offline/practice`, session start fails, attempts
     queued session-less, then `lesson.complete`).
  2. A lesson started online that loses the network (attempts queued _with_ `sessionId`).
  3. A network failure before the session starts (session-less, maybe no download).
- **M15** `measurement/overview.ts` counts `ExerciseAttempt` rows directly, so it must exclude
  preview attempts. `engine.ts` replays `AttemptCharacterResult`, which previews won't have.

## Design (ready to implement after #48 and #55 merge)

### Migration (additive, expand only, reversible by dropping the columns)

- `ExerciseAttempt.countsForProgress Boolean @default(true)`. Existing rows stay `true`: they
  did count, and history isn't rewritten.
- `ExerciseAttempt.clientOccurredAt DateTime?`: the client's claim, diagnostic only.
- `DownloadedContentVersion.firstDownloadedAt DateTime @default(now())`, backfilled from
  `downloadedAt` and never overwritten on re-download. The backfill is conservative: the true
  first download was at or before this.

### One context resolver in `submitAttempt` (`features/exercises/attempt-context.ts`)

It runs after the idempotency lookup, so duplicates and retries return the stored outcome
unchanged.

1. **Session (F-06).** If `sessionId` is given:
   - the session must be owned (as today);
   - `LESSON` type: `session.lessonId` must contain the exercise, the lesson must be visible,
     and the session must not be completed;
   - `REVIEW` type: the exercise must be a free-writing exercise of a character the learner has
     a schedule for, or a placement check.

   Otherwise refuse with `conflict` (sync marks the event rejected). An optional `lessonId` in
   the payload must equal `session.lessonId` and contain the exercise.

2. **Eligibility (F-01).** Eligible when every character of the exercise is taught
   (`LessonCharacter`) in at least one learner-visible lesson the learner has reached. Reached
   means any state but `LOCKED`, from `getLessonStatesForLevel` for the levels involved.
   Shared characters therefore count wherever they are reached. Ineligible means preview:
   - the attempt is stored with `countsForProgress = false` and `xpAwarded = 0`;
   - `applyAttemptProgress` is **not called**, so there are no character results, mastery,
     schedule, daily activity, XP, goal, streak or achievements;
   - the response includes the server evaluation and `counted: false, reason: "preview"`.
3. **Time (F-02).**
   - **Online** (no `deviceId`): `occurredAt = now`. The client value is kept in
     `clientOccurredAt`, and the browser clock is never a reason to refuse.
   - **Sync:**
     - **Authorization start:** the later of the session's `startedAt` (if a valid session is
       given) and the device's `firstDownloadedAt` for a lesson containing the exercise, minus
       5 minutes of skew.
     - **Timestamps:** earlier than the authorization start is rejected ("predates offline
       access"). Later than now is clamped to now. With no evidence (flow 3), the time is
       normalized to now.
     - **Kept:** the 30-day maximum age.
4. **Completion.** `completeLessonSession` counts only `countsForProgress` attempts. Sync
   `lesson.complete` re-attaches only those.

### Residual risk (to document)

Inside a legitimate offline window (from the first download to now), a learner can still choose
timestamps. For example: download, wait 20 days, then submit spaced times. Closing this would
need a trusted device clock or server-issued offline tickets. That's out of scope, and it is
recorded as residual.

## Test plan (maps to the mission's §8)

Each case lives in the existing integration suites (`progression-integrity.test.ts`, extended
from #55, plus `progress.test.ts` for sync). Cases that need a browser go in the e2e suite.
Every case asserts persisted rows, not just responses.

- **A. Preview:**
  - feedback returned;
  - 0 XP and no `XPTransaction`;
  - no `CharacterMastery` and no `AttemptCharacterResult`;
  - no `ReviewSchedule`;
  - streak and `DailyActivity` unchanged;
  - no `UserAchievement`;
  - can't complete or unlock;
  - duplicates and retries;
  - direct API and sync;
  - a forged `preview: false` or `counted` field is ignored (the schema strips it);
  - shared character reached in curriculum X but locked in Y counts;
  - a word with one locked character is a preview.
- **B. Session:**
  - valid;
  - another learner's session;
  - another lesson's session;
  - an unrelated exercise;
  - a completed session;
  - a forged `lessonId`;
  - a review session with an unlearned character;
  - a shared exercise;
  - locked attempts through the API and sync;
  - duplicates;
  - completion can't use unrelated attempts (re-attachment ignores previews).
- **C. Online time:**
  - stored `occurredAt` equals server now for a backdated, future-dated or skewed client time;
  - `clientOccurredAt` kept;
  - idempotent;
  - replay, schedule, streak and goal use server time (M17 F-02 test flipped: a backdated
    sequence no longer reaches FAMILIAR).
- **D. Offline time:**
  - after download, accepted with its original time (including several days later);
  - before the first download, rejected;
  - before the session start, rejected;
  - future times clamped;
  - a manipulated spaced batch before authorization is rejected, and one inside the window is
    accepted (residual, asserted and documented);
  - retry, duplicates, and a partial batch and its retry;
  - boundary ± skew;
  - a time-zone day boundary;
  - a re-download doesn't move `firstDownloadedAt`;
  - offline preview;
  - an offline locked attempt.
- **E. Regression:**
  - M17 F-01 to F-06;
  - #48's empty lesson;
  - lock protections;
  - idempotency;
  - daily caps;
  - replay;
  - the existing sync and offline e2e (`offline-progress.spec.ts`).
