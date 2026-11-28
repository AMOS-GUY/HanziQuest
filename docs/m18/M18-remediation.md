# M18 remediation: D-085 enforcement

**Approved by the owner:** D-085, with F-01 Option B, the F-02 timestamp policy and the F-06
attempt context. The policies weren't reopened, and no substitute was chosen.

## Where it is enforced

All of it is in one module, `src/features/exercises/attempt-context.ts`, which `submitAttempt`
calls. Every attempt path already runs through `submitAttempt`:

- `POST /api/attempts`;
- `POST /api/sync` (offline);
- review practice, which uses the same route.

There is no new route-level check, and no parallel XP, mastery or schedule path.
`applyAttemptProgress` is unchanged, apart from not being called for previews.

## Order inside `submitAttempt`

1. Parse the input. Unknown fields such as `preview`, `counted` or `xpAwarded` are stripped by
   the zod schema.
2. **Idempotency first.** A known `clientEventId` returns the stored outcome, `counted`
   included. So retries, replays and offline re-uploads never re-decide anything.
3. Check the exercise is published and in a learner-visible lesson. This is unchanged.
4. **F-06, session context.** If a `sessionId` is given:
   - it must exist and be the learner's (`not_found`);
   - it must not be completed (`conflict`).

   Then, by session type:
   - **`LESSON`:** the exercise must be in the session's lesson (`conflict`).
   - **`REVIEW`:** the exercise must be free writing, for a character the learner has a
     schedule or a placement check for (`conflict`).

   An optional `lessonId` (new, optional field) must contain the exercise and equal the
   session's lesson.

5. **F-02, time.**
   - **Online** (no device): `occurredAt` is the server's time.
   - **Offline sync:**
     - **Authorization start:** the session's `startedAt` if one was named; otherwise the
       device's `firstDownloadedAt` for a lesson containing the exercise.
     - **Before that, minus 5 minutes:** `conflict` (the event is marked rejected and never
       retried).
     - **Future times:** clamped to now.
     - **Older than 30 days:** `conflict`, as before.
     - **No record:** server time.
   - The client's claim is always stored in `clientOccurredAt`.
6. **F-01, eligibility.** A valid session already implies eligibility:
   - a lesson session can only start on a reached lesson, and lessons never re-lock;
   - a review session only takes characters under review.

   Otherwise the attempt counts if a reached, visible lesson contains the exercise, or if every
   character of the exercise is taught (`LessonCharacter`) in some reached, visible lesson.
   "Reached" means any state but `LOCKED` from `getLessonStatesForLevel`. That is the same
   source as `/learn`, the lesson routes, the download route and the vocabulary explorer (#54).

7. Grade the handwriting on the server, unchanged.
8. Run one transaction under the learner lock:
   - create the attempt, with `countsForProgress`, `occurredAt` and `clientOccurredAt`;
   - **then, only if it counts,** call `applyAttemptProgress`.

## Preview practice (F-01)

A preview still gets a lot:

- the full server evaluation (band, score, per-character feedback);
- a stored `ExerciseAttempt` (`countsForProgress = false`, `xpAwarded = 0`), so it's auditable
  and disputable;
- a response with `counted: false`;
- a runner notice, after the attempt and on the end screen: "Preview practice: this doesn't
  count toward your progress." (`components/lessons/save-status.ts`). The first wording,
  "This counts once you reach its lesson", implied later credit, which D-085 rules out. It
  was corrected in the M18 review.

It gets **none** of these:

- `AttemptCharacterResult` rows, so nothing is replayed into mastery or schedules, now or later;
- `CharacterMastery`, `ReviewSchedule`, `DailyActivity`, `XPTransaction`, the daily-goal bonus;
- streak changes, `UserAchievement`;
- lesson completion: `completeLessonSession` and sync re-attachment count only
  `countsForProgress` attempts;
- unlocks.

M15's overview counts exclude previews, consistent with the replay engine. The admin dashboard's
raw activity counts still include them: they are activity, not progression.

## Shared characters

- **Exercises and lessons are many-to-many.** Characters and mastery are global per learner.
- **Rule:** a character reached in any visible lesson, in any curriculum, makes attempts at it
  count, whichever curriculum's exercise free practice picks. A word counts only if every one of
  its characters is reached.
- **Tests:** curriculum Y's locked lesson for a character reached in X counts; a word with one
  unreached character is a preview.

## Migration `20261127200200_m18_progression_integrity`

The migration is additive: three columns, one backfill, nothing dropped. `db:check-migrations`
passes.

| Column                                                                           | Notes                                                                                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ExerciseAttempt.countsForProgress BOOLEAN NOT NULL DEFAULT true`                | Existing rows stay `true`. They counted, and history isn't rewritten.                                                                                                                            |
| `ExerciseAttempt.clientOccurredAt TIMESTAMP(3)`                                  | Null for pre-M18 rows, whose `occurredAt` was the client time.                                                                                                                                   |
| `DownloadedContentVersion.firstDownloadedAt TIMESTAMP(3) NOT NULL DEFAULT now()` | Backfilled from `downloadedAt`, which is at or after the true first download, so no legitimate queued attempt made after it is rejected at deploy. The download route's update never touches it. |

**Rollback:** the old code ignores the new columns, so the deploy is expand-safe. Dropping them
is a later, separate contract step and isn't planned.

## Behaviour changes for existing learners

| Before                                                                         | After                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A locked lesson's character practised freely earned XP, mastery and a schedule | A graded preview, with no progress                                                                       |
| An online attempt with a client time more than 5 minutes ahead was refused     | Accepted at server time                                                                                  |
| An online attempt could backdate up to 30 days                                 | Server time, always                                                                                      |
| An offline attempt could backdate up to 30 days                                | Only back to the session start or the first download (minus 5 minutes); otherwise server time or refused |
| An attempt could name any of the learner's sessions                            | Must fit it                                                                                              |

## Not changed

- XP values, caps and bonuses (D-021);
- mastery and SRS thresholds and the replay (D-020, D-022);
- completion requirements (D-019);
- unlocking (D-039);
- streak rules;
- placement;
- the handwriting engine.

The only streak and daily-goal effect is that they are now computed from the validated time.

## Legacy data (not rewritten)

Pre-M18 progress earned through locked-content practice or backdated times stays. Rewriting
learner history is irreversible and was out of scope. Schedules created that way keep those
characters reviewable.
