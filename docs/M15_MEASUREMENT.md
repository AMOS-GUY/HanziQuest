# M15 learning measurement: definitions, interpretation and safeguards

Code: `src/features/measurement/`. Decisions: D-079 (measurement and analytics), D-080 (first-run
and home). Nothing here collects new data: every metric is computed from records the app already
keeps for learning. The analytics page is **off** (`LEARNING_ANALYTICS`) until the owner approves
the privacy wording and the legal-version decision (see `M15_PRIVACY_PROPOSAL.md`).

## Who is measured

- **Counted:** every account in a signup week that isn't DELETED, holds no staff role and isn't
  a test account (`@hanziquest.test`).
- **Suspended accounts are counted**, so suspending someone can't be used to single them out
  (see "Safeguards").
- **Deleted accounts:** account deletion deletes the learning data with it, so those learners
  disappear from every figure, retroactively.

## Cohorts

- **Definition:** a cohort is everyone who signed up in one ISO week (Monday 00:00 UTC to the
  next Monday), for example `2026-W47`.
- **No other groupings:** there are no other date ranges, the current week isn't shown (its
  membership still changes), and there are no totals across weeks.
- **"As of":** results are computed as of a moment; events after it are ignored.

## Metrics

Each metric has an eligibility rule, so learners who haven't had the chance yet don't count as
failures. "Rate" is successes / n, with a 95% Wilson score interval.

| Metric                       | Unit      | Success / measured                                                                                                                            | Eligible when                             | Read it as                                                                                                                   |
| ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Onboarding funnel (5 stages) | learner   | finished onboarding · started a placement check · started a lesson (tested-out lessons don't count) · completed a lesson · wrote a due review | always ("so far")                         | Where people stop. Stages aren't nested: a learner can test out without starting a lesson.                                   |
| Activation                   | learner   | completed a first lesson ≤ 24 h after signing up                                                                                              | 24 h have passed                          | How quickly people get going                                                                                                 |
| Return D1, D7, D30           | learner   | practised (≥ 1 exercise) on the learner's local day signup + n                                                                                | that local day is over                    | Practice retention on an exact day, not "came back at some point"                                                            |
| Due-review completion        | review    | written from the early tolerance up to 24 h after falling due                                                                                 | due + 24 h has passed                     | Only reviews scheduled ≥ 1 day ahead. Each scheduled due time counts once.                                                   |
| Recall when due, by interval | review    | an independent recall made when due succeeded                                                                                                 | always                                    | The core effectiveness measure. Buckets are the interval in force: < 1 day (relearning), 1, 2–3, 4–7, 8–14, 15–30, 31+ days. |
| Lapse rate                   | recall    | a failed recall of a character already learned (repetitions > 0)                                                                              | always                                    | Includes early recalls, which can lapse but can't advance the schedule                                                       |
| Days to FAMILIAR / MASTERED  | character | days from first counted practice to first reaching the level                                                                                  | always; others count as "not yet"         | Median and middle half of those that got there. "Not yet" (censored) items are reported, not hidden.                         |
| Placement accuracy           | character | the first independent recall after the placement, for characters in tested-out lessons, succeeded                                             | the character was written after placement | Whether "tested out" meant the learner could write it                                                                        |

### Interpretation cautions

- **Clustering:** event-level intervals (reviews, recalls, characters) assume independent
  events. One learner's events are correlated, so those intervals are too narrow when a few
  learners dominate. Every value also states how many learners it comes from, and values
  dominated by one learner are withheld.
- **Rules in force:** due times and intervals are rebuilt with today's scheduling rules (D-020,
  D-033). If M16 changes them, past reviews are reinterpreted under the new rules.
- **Device clocks:** attempt times come from the device (offline-first). Signup and lesson
  times come from the server.
- **Small numbers:** a beta cohort of 6 can show 50% with an interval of roughly 19–81%. Read
  the interval, not the point.

## Replay observer

- **What it does:** the metrics reuse the scheduler's own replay (`replayCharacter`). An optional
  observer receives a snapshot after each counted event: its kind (learning, due, early, guided),
  the interval in force, the due time, whether it was a lapse, and the level afterwards.
- **It changes nothing:**
  - Results are identical with and without the observer, across 5,000 seeded random histories.
  - Rows written by the real `recomputeCharacter` equal a replay with the observer.
  - An observer that tampers with its snapshot changes nothing.

## Safeguards (aggregate-only contract)

- **Read-only:** every query goes through `readOnlyClient`, which throws on any write, raw
  statement or transaction. Tests snapshot every learning table before and after measuring.
- **Aggregates only:** `features/measurement/analytics.ts` is the only shape that leaves the
  server. Tests check that it never contains identifiers, per-learner values, successes counts
  or internal counts.
- **Small groups:** a value is shown only with at least k = 5 learners. This is a disclosure
  safeguard, not a claim that groups of five are anonymous. A suppressed value carries a reason
  and no numbers. A cohort under k shows nothing but that.
- **Dominance:** an event-level value is withheld when one learner contributes more than half
  of it.
- **Complementary suppression:** in the interval buckets, one suppressed cell forces the smallest
  shown cell to be suppressed too.
- **Differencing:**
  - Fixed weeks only, with no totals across weeks.
  - Suspension doesn't change membership (tested).
  - **Residual risk:** granting or revoking a staff role does change membership. Role changes
    are Super-Admin-only and audited. Deletion by the learner also changes it.
- **Permission:** `analytics:read`, checked by the page and by the service.
- **Off by default:** `/admin/learning` shows the not-found page unless `LEARNING_ANALYTICS=on`,
  and production start-up warns when it's on. There's no navigation entry.
- **Overview figures:** a suppressed version of the admin overview's 7-day learner figures is
  prepared (`overview.ts`), not yet wired in.

## Performance (synthetic, local)

The test data is 1,000 synthetic learners with 100,000 attempts in one cohort
(`tests/integration/measurement-performance.test.ts`):

- `measureCohort` took about 1.2–1.5 s, with a heap delta of roughly 25–75 MB (without forced GC).
- The test's budget is 60 s.

The hardware is listed in M14B_REVIEW_AUDIT.md.
