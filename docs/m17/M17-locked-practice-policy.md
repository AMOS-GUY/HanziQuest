# M17 proposal: practising locked characters

**Status: awaiting owner decision. Nothing here is implemented.** The current behaviour is pinned
by characterization tests (`progression-integrity.test.ts`, group F-01), so any change is
deliberate and visible.

## Today

- **Previews are open.** `/learn/[id]` lists a locked lesson's words and characters. The word page
  and the stroke-order page open for any published content.
- **Practice is inconsistent.**

  | Practice                        | Locked lesson                                                                            |
  | ------------------------------- | ---------------------------------------------------------------------------------------- |
  | Lesson practice                 | Blocked (page, session start, download)                                                  |
  | Free character practice         | Graded and counts: 10 XP, plus mastery, a review schedule, achievements and a streak day |
  | `/api/attempts` and `/api/sync` | The same: counts                                                                         |

- **Never affected:** lesson completion and unlocks. The lesson stays `LOCKED`.

No decision entry covers this.

## Options

|                         | A · Strict gating                                                   | B · Preview practice (recommended)                                                                                        | C · Full free practice                                               |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| What happens            | Practice of a locked character is refused (404 or "unlocks after…") | Practice is graded with feedback. Nothing counts: no XP, mastery, schedule, streak day, achievement, completion or unlock | As today, documented                                                 |
| Learner experience      | Curiosity blocked. Clicking "Practise" on a preview dead-ends.      | Curiosity rewarded with feedback. A clear "Preview: doesn't count yet" label.                                             | Most freedom                                                         |
| Gamification            | Clean                                                               | Clean: rewards come from the path                                                                                         | XP and streaks without the path. Weakens the path's rewards.         |
| Curriculum integrity    | Strong                                                              | Strong                                                                                                                    | Weak: mastery and reviews for content not yet taught                 |
| Learning effectiveness  | Neutral                                                             | Good: exposure without "learning" credit. Real credit comes in context.                                                   | Unclear: SRS schedules for untaught characters fill the review queue |
| Exploitability          | None                                                                | None (no effects)                                                                                                         | Today's F-01                                                         |
| Technical complexity    | Low (one gate)                                                      | Low to medium (see below)                                                                                                 | None (docs only)                                                     |
| Fits the current design | Partly (previews are open)                                          | Yes: mirrors the admin "preview" mode that already exists in `PracticeRunner`                                             | Contradicts lesson-practice gating                                   |
| Future HSK levels       | Fine                                                                | Fine: eligibility uses the existing level rules (D-039)                                                                   | Learners could fill later levels' schedules early                    |
| Shared characters       | Needs "reached anywhere"                                            | Needs "reached anywhere"                                                                                                  | n/a                                                                  |

### Shared characters

Mastery is per learner and character, across curricula. A character such as 人 can appear in a
reached lesson of curriculum X and a locked lesson of curriculum Y. For A and B, the rule should
be:

> **An attempt counts if the character (or the exercise) is in at least one learner-visible
> lesson the learner has reached.**

That rule:

- uses the existing lesson states (`getLessonStatesForLevel`), with no new unlocking rule;
- doesn't penalise learners for a lesson elsewhere being locked;
- for word exercises, needs every character in the word to be reached. Otherwise, if one is
  reached, it would credit the others.

## Recommendation: B, implemented in one place

The **gate** goes in `submitAttempt`. Every pathway passes through it: online, sync and review.

The **eligibility check** is "is the exercise in a reached lesson?", with the shared-character
rule above.

**When the attempt is ineligible:**

- The `ExerciseAttempt` is still stored and graded. It feeds the result and disputes, and stays
  auditable.
- `applyAttemptProgress` is skipped: no `AttemptCharacterResult` rows, XP 0, no daily activity.
- The response says `{ counted: false, reason: "preview" }`. The UI shows "Preview: unlocks after
  {lesson}".
- **No retroactive credit.** Because no character results are written, reaching the lesson later
  doesn't replay preview attempts into mastery. That keeps D-022's replay exact.

**Data:** add `ExerciseAttempt.countsForProgress Boolean @default(true)`. This is an additive,
expand-only migration. M15 measurement and analytics can then exclude previews. Existing rows
stay `true`, which is honest: they counted.

**Existing preview-earned progress** (rows created before the change): leave it. Rewriting XP or
mastery history is irreversible, and the mission forbids it. Optionally, report a count.

**Tests:** flip the F-01 characterization tests, and add:

- the shared-character case;
- a word with one reached and one locked character;
- the review queue not gaining locked characters;
- sync of a preview attempt.

**Complexity:** around 5 queries per attempt for lesson states (cacheable within the request),
one migration, one UI label. **Risk:** the lesson-state computation now sits on the attempt hot
path. The existing progress concurrency tests cover the lock.

## Related decision (same approval)

F-06: should an attempt's session constrain it? The proposed rule: the exercise must be in the
session's lesson, or, for a review session, be due or a placement check. Do this together with B,
because both live in `submitAttempt`.

## Decision needed

Choose A, B or C. If B: confirm "reached anywhere" for shared characters, and no retroactive
credit.
