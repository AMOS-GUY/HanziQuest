# M13 handwriting validation: protocol (draft for owner review)

**Status:** protocol only.

- No participant has been recruited, no human sample collected and no study run.
- No result in this document is a measurement.
- Grading thresholds, scoring policy, XP and mastery are unchanged.

It builds on:

- HANDWRITING_VALIDATION.md: the targets and the six tuning rules.
- M12_PILOT_PROTOCOL.md: the exploratory pilot, consent and data handling.
- M13_HANDWRITING_DIAGNOSTICS.md: the synthetic diagnostics, which are not evidence.

## 1. Questions the study answers

On human handwriting from consenting participants, with the current engine (`hq-eval-1`, or the
version under test):

| Measure                     | Definition (per sample)                                                      | Target |
| --------------------------- | ---------------------------------------------------------------------------- | ------ |
| False rejection (FRR)       | A correctly written character graded below Good                              | ≤ 10 % |
| Wrong-character acceptance  | A different character, written when another was asked, graded Good or better | ≤ 1 %  |
| Structural false acceptance | A wrong character, or a missing or extra stroke, graded Good or better       | ≤ 2 %  |
| Specific error named        | Among deliberate errors, the feedback names the actual problem               | ≥ 80 % |

- **Asymmetry:** false acceptance matters more than false rejection, because a wrong character
  accepted teaches the wrong thing.
- **One-sided bounds:** every acceptance target is judged on its **upper** bound, never on the
  point estimate.

## 2. Exploratory findings vs accuracy claims

|                    | Exploratory (M12 pilot, disputes, synthetic diagnostics) | Validation (this protocol)                                       |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Purpose            | Find failure modes, check the procedure                  | Estimate the four measures with intervals                        |
| Output             | A findings list and descriptive counts                   | Rates with writer-level 95 % intervals, per device and size      |
| May justify tuning | No                                                       | Only on the training writers; confirmed on locked test writers   |
| May support claims | No                                                       | Only "for these writers, devices and characters", with intervals |

- **Sentences we must never write:**
  - "the engine is X % accurate" from the pilot, from disputes or from synthetic ink;
  - any accuracy statement without its interval and the population it describes.

## 3. What counts as an independent sample

- **The writer is the independent unit.** Samples from one person share their hand, device,
  habits and misunderstandings, so they're positively correlated. So are a character's repeats,
  and characters written in one sitting.
- **Effective sample size:** with m samples per writer and intra-writer correlation ρ, the
  design effect is DEFF = 1 + (m − 1)ρ, and the information is that of about n / DEFF
  independent samples. Computed:

  | Samples per writer (m) | ρ    | DEFF | 300 samples are worth about |
  | ---------------------- | ---- | ---- | --------------------------- |
  | 10                     | 0.10 | 1.9  | 158                         |
  | 20                     | 0.05 | 1.95 | 154                         |
  | 20                     | 0.10 | 2.9  | 103                         |
  | 20                     | 0.20 | 4.8  | 62                          |

  ρ is unknown until real data exists. The M12 pilot will give a first, rough estimate.

- **Consequences:**
  - Every interval used for a decision is computed at writer level, by **cluster bootstrap**
    (writers resampled with replacement, 10,000 replicates, percentile interval).
  - A **zero-event** cell can't be bootstrapped meaningfully: all replicates are zero. There we
    use the exact Clopper–Pearson bound on the **effective** n (n / DEFF, with ρ estimated from
    the other cells, and no lower than 0.1).
  - Naive per-sample Wilson intervals are reported alongside, labelled "assumes independence
    (optimistic)".

## 4. Repeated attempts

- **Cap per writer:** at most **2 samples per writer for each (character, condition)**. A
  condition is: correct, a specific substitution, missing stroke, extra stroke, wrong order or
  wrong direction. Anything beyond is recorded but excluded from the estimates. Without the cap,
  a keen participant could dominate a cell.
- **Retries:** the analysis uses the **first** attempt at each prompt. Retries are reported
  separately, because they measure learning and adaptation to the engine, not accuracy.
- **Leave-one-writer-out:** every rate is recomputed without each writer in turn. If removing
  one writer moves a measure across its target, the result is reported as unstable, and no
  decision is based on it.

## 5. Two study modes, and the writer-based split

The split depends on whether the engine is changed.

- **Mode A: validate the engine as it is** (`hq-eval-1`, no tuning).
  - Nothing is fitted, so there's nothing to hold out: **every eligible writer is an
    evaluation writer**. No train or validation split is needed.
  - This is the first study to run.
- **Mode B: after tuning** (only if Mode A misses a target, under the six rules in
  HANDWRITING_VALIDATION.md).
  - Writers, not samples, are assigned before any sample is analysed. They're stratified by
    experience (beginner, some, fluent) and main input (finger, stylus, mouse):
    - **Training:** 50 % of writers, used for tuning candidates.
    - **Validation:** 25 %, used to choose between candidates.
    - **Test:** the remaining writers, used only to confirm.
  - **Claims after tuning rest on the test writers alone,** so the test group by itself must
    meet the sample-size requirement in section 8. In practice, Mode B needs a **newly
    recruited test cohort** of that size. A 25 % slice of a Mode A-sized study can't support a
    claim.
- **Locking the test writers** (Mode B):
  - Their participant codes are hashed (SHA-256 with a salt the owner keeps), and the hashes are
    recorded in DECISIONS.md before anyone looks at their samples.
  - Test data may be read **only** at the pre-planned looks in section 9, and only for the
    pass, expand or fail decision. No tuning may follow any look at test data. If a look leads
    to tuning, those test writers are **burned**: they move to training, and a new test cohort
    is needed.
- **Independence of the test population:**
  - Test writers must be different people from training and validation writers. Pilot
    participants (P01–P05) are never test writers.
  - The lab collects no identity, so one person enrolling twice under two codes can't be
    detected from the data. The session procedure must check this in person, on paper (M12
    rules). This is an unresolved limitation.
  - Writers recruited from one class or group are themselves correlated: record the
    recruitment source, and report results by source.
- **Engine version:** each evaluation uses a single, frozen `ENGINE_VERSION`, recorded with the
  result.

## 6. Look-alike (confusable) pairs

- **Which pairs:** those in the confusable suite (`features/handwriting/confusables.ts`).
  - **In-set pairs** (both characters taught at the level), for example 他/她, 日/目/白, 土/士,
    己/已, 人/八, 午/牛 when both are in the set. Identity checking can reject these.
  - **Out-of-set look-alikes** (入 for 八, 夫 or 犬 for 天, 找 for 我, 王 for 五, 牛 for 午,
    孑 for 子). Only stroke geometry can reject these. The synthetic diagnostics already show
    5/5 acceptance for these: a **hypothesis to test on human ink, not a finding**.
- **Protocol:** for each pair (A, B), a writer gets the prompt for A and is asked to write B on
  purpose. They write a clear B, not a deliberately bad A. Each pair also has correct A and
  correct B samples.
- **Reporting:**
  - Per pair, descriptively: counts accepted / written, with a writer-level interval. Per-pair
    n is small, so per-pair rates are never compared with the 1 % target on their own.
  - The **pooled** wrong-character acceptance over all pairs and substitutions is the measure
    judged against ≤ 1 %. In-set and out-of-set pairs are reported separately as well as
    pooled.
  - A single pair accepted in ≥ 2 of its samples from ≥ 2 different writers is a **finding**,
    whatever the pooled rate.

## 7. Correct writing, structural errors, error identification

- **Correct-writing rejection:**
  - The correct samples cover simple (人, 大, 口), medium and complex characters, at three sizes
    and on each input type.
  - FRR is reported overall and per size and input. A per-group FRR above 10 % with its lower
    bound above 10 % is a failure for that group, even if overall FRR passes.
- **Structural errors:** missing stroke, extra stroke and wrong character. "Accepted" means
  graded Good or better. They're judged against ≤ 2 % pooled, and reported per error type.
- **Wrong order and wrong direction:**
  - These are technique errors, not structural ones. They're measured by "specific error
    named": does the feedback code match the induced error?
  - Whether they should count against recall is the owner's and teacher's technique-cap
    decision, not this study's.
- **Error identification:** for each deliberate error, the expected feedback code is fixed in
  advance, from the engine's codes. Success means that code is among the feedback.

  | Induced error   | Expected code      |
  | --------------- | ------------------ |
  | Missing stroke  | `MISSING_STROKES`  |
  | Extra stroke    | `EXTRA_STROKES`    |
  | Wrong order     | `STROKE_ORDER`     |
  | Wrong direction | `STROKE_DIRECTION` |
  | Wrong character | `WRONG_CHARACTER`  |

## 8. Sample size

**Exact one-sided Clopper–Pearson bounds** (computed for this protocol, and re-checked in the
statistical review). These are **effective** samples, after dividing by the design effect.
"3 looks" uses α = 0.05 / 3 (section 9).

| Target                            | Allowed acceptances | 1 look | 3 looks |
| --------------------------------- | ------------------- | ------ | ------- |
| Wrong-character acceptance ≤ 1 %  | 0                   | 299    | 408     |
| Wrong-character acceptance ≤ 1 %  | 1                   | 473    | 603     |
| Structural false acceptance ≤ 2 % | 0                   | 149    | 203     |
| Structural false acceptance ≤ 2 % | 1                   | 236    | 300     |

**These minimums are not enough to plan with.**

- **The problem:** they're the sample sizes at which a **perfect** result just passes. A good
  but imperfect engine usually observes a few acceptances, and then fails to show the target.
- **Power:** the chance of passing if the engine really is good. A design must have enough of
  it (80 % here). Computed for wrong-character acceptance ≤ 1 %:

  | Effective n | Pass probability if the true rate is 0.10 % (1 look / 3 looks) | 0.25 %      | 0.50 %      |
  | ----------- | -------------------------------------------------------------- | ----------- | ----------- |
  | 300         | 74 % / 0 %                                                     | 47 % / 0 %  | 22 % / 0 %  |
  | 600         | 88 % / 55 %                                                    | 56 % / 22 % | 20 % / 5 %  |
  | 800         | 99 % / 95 %                                                    | 86 % / 68 % | 43 % / 24 % |
  | 1,000       | 100 % / 98 %                                                   | 89 % / 76 % | 44 % / 26 % |

**Effective n needed for 80 % power, and the writers it takes.** The writer counts assume 20
samples per writer. Every count is rounded up.

| Target (true rate assumed)     | Effective n, 1 look / 3 looks | Writers if ρ = 0.05 | Writers if ρ = 0.10 |
| ------------------------------ | ----------------------------- | ------------------- | ------------------- |
| Wrong-character ≤ 1 % (0.25 %) | 775 / 1,100                   | 76 / 108            | 113 / 160           |
| Wrong-character ≤ 2 % (0.50 %) | 400 / 550                     | 40 / 54             | 59 / 80             |
| Wrong-character ≤ 3 % (0.75 %) | 275 / 375                     | 27 / 37             | 40 / 55             |
| Structural ≤ 2 % (0.50 %)      | 400 / 550                     | 40 / 54             | 59 / 80             |

- **Writers are the binding constraint.** With correlation ρ, no number of samples per writer
  gives more than writers ÷ ρ effective samples. At ρ = 0.10, even 600 samples from 30 writers
  (20 each) are worth about 207, below the 299 a perfect result needs.
- **The earlier proposal doesn't hold:** "≥ 30 writers, ≥ 600 wrong-character samples" (draft of
  2026-11-19) is **withdrawn**. It can't demonstrate ≤ 1 % under this protocol's own ρ floor
  of 0.10.
- **What a study of about 30–40 writers can do:**
  - estimate each rate with an honest, writer-level interval;
  - detect a clearly failing engine (lower bound above target);
  - demonstrate the **≤ 3 %** wrong-character level, if the engine is good.

  It **can't** credibly demonstrate the ≤ 1 % wrong-character target. That needs roughly **75 to
  160 writers**, depending on ρ and the number of looks. Which path to take is an owner decision
  (section 12).

- **Correct samples (FRR ≤ 10 %):** about 300 correct samples (effective) give a useful
  interval. With 300 correct samples at an observed 5 %, the naive Wilson upper bound is about
  8 %, and the writer-level bound is wider.
- **What remains assumed:** ρ for these outcomes is unknown. Planning uses ρ = 0.05 and 0.10;
  the M12 pilot gives a first, rough estimate. If ρ is larger, every writer count above grows
  proportionally.

## 9. Stopping, expanding or rejecting

**Planned looks** are set by the study's planned writer count W (section 12): at about 50 %,
75 % and 100 % of W evaluation writers. In Mode B, the looks count test writers only. Each look
uses α = 0.05 / 3, a one-sided 98.3 % bound (Bonferroni). That's conservative: it keeps the
overall chance of a false "pass" at or below 5 %. Looks are only for the decisions in the
table; nothing is tuned between them.

| At a look                                                              | Decision                                                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every target's upper bound (writer-level, Bonferroni) meets its target | **Stop: pass** for the targets met. Report the results with intervals and their population.                                                                    |
| A point estimate meets a target but its upper bound doesn't            | **Expand** to the next look. After the last look: **inconclusive**. Report the bound actually shown (for example, "≤ 2.6 %"), and make no claim of the target. |
| A measure's **lower** bound is worse than its target                   | **Stop: fail** for that measure. Mode B may follow (tuning on training writers, choice on validation writers, a new test cohort).                              |
| > 10 % of sessions deviate from the protocol                           | **Stop: invalid.** Fix the procedure; the samples are kept as exploratory only.                                                                                |
| A consent, privacy or safety problem                                   | **Stop immediately** (M12 rules).                                                                                                                              |

Any tuning follows the six rules in HANDWRITING_VALIDATION.md and bumps `ENGINE_VERSION`.

## 10. Exclusions

- **Synthetic ink** (`features/handwriting/synthetic-ink.ts`, results marked
  `source: "synthetic"`) is never a validation sample. Its findings only shape the prompt list.
- **Test participants and accounts** are always excluded:
  - participant codes starting with `TEST` (enforced by the lab);
  - accounts on `@hanziquest.test`.
- **Learner disputes** (D-081) are **not** samples.
  - **Why:** they're self-selected (people dispute what surprised them), so they can't estimate
    rates. A dispute finding of "the result was wrong" is a pointer to a failure mode, used to
    write prompts.
  - **Changing this:** using disputed ink as a validation sample would need the M12 consent
    process for that person. That's an owner decision, and isn't built.
- **Ordinary learning attempts** aren't samples: there's no ground truth beyond the prompt, and
  no consent for validation.
- **Samples recorded outside the protocol** are excluded: wrong prompt, interrupted, or another
  device than recorded.

## 11. Limitations

- **Sample:** the people who volunteer for a beta aren't representative of all learners.
  Results describe the participants, devices and characters tested.
- **Characters:** they cover HSK 1 Starter. Adding HSK 2 or 3 characters changes the candidate
  set, so **every content change re-runs the confusable suite**, and may need a new study.
- **Deliberate errors** differ from natural ones: false acceptance of natural mistakes may be
  higher or lower.
- **ρ is unknown** until real data exists. If it's larger than assumed, the effective sample is
  smaller and more writers are needed.
- **The five-person M12 pilot** can find gross problems but can't show any target is met. Its
  zero-error upper bound for wrong-character acceptance (10 samples) is about 26 %.

## 12. Owner decisions

1. **Which claim the first study aims for** (section 8). Each option is honest, and they differ
   in cost:
   - **(a) An estimation study of about 30–40 writers.** It reports every rate with
     writer-level intervals, can show the ≤ 3 % wrong-character level and a clear failure, but
     **doesn't** claim ≤ 1 %.
   - **(b) A confirmatory study of about 75–160 writers,** sized to demonstrate ≤ 1 %
     wrong-character acceptance with 80 % power.
   - **(c) First (a), then (b),** only if (a) suggests the engine is near target.

   The recommendation is (c).

2. **The look plan:** one look, or three with Bonferroni (section 9).
3. **The ρ assumption** used for planning: 0.05 and 0.10 are proposed, revisited after the M12
   pilot.
4. **Whether disputed ink may ever become validation samples** (needs per-person consent).
5. **The technique-cap decision,** with a teacher. It isn't part of this study.
6. **Recruiting, the location and consent,** as in M12. Nothing is started.

## 13. Statistical review (2026-11-20)

An independent re-check of the 2026-11-19 draft.

- **Correct, and kept:**
  - The single bounds: 299 / 473 for ≤ 1 %, 149 / 236 for ≤ 2 %, and 408 / 603 / 203 / 300 for
    three looks.
  - The design-effect reasoning.
  - Writer-level intervals.
  - The cap on repeats.
  - The exclusions.
  - The distinction between exploratory work and claims.
- **Fixed:**
  1. **The minimum wasn't defensible.** It ignored power, and failed the protocol's own ρ
     floor: 600 samples over 30 writers are worth about 207 effective samples at ρ = 0.10. It's
     now replaced by power-based requirements and an explicit choice of claim.
  2. **Mode A vs Mode B.** Validating the unchanged engine needs no split. After tuning, claims
     rest on the test writers alone, who must meet the requirement themselves. The draft
     applied the minimums to everyone while making claims on a 25 % slice.
  3. **"Analysed once" contradicted the three looks** on test writers. Test data is now read
     only at planned looks, only for pass, expand or fail, and any tuning burns the test
     writers.
  4. **The look schedule** now follows the planned writer count, not fixed numbers (15
     writers would have meant about 4 test writers).
- **Unresolved, stated rather than hidden:**
  - ρ for these binary outcomes is unknown, and hard to estimate when acceptances are rare. The
    zero-event rule uses a ρ floor of 0.10, which is an assumption.
  - The pooled wrong-character rate depends on which pairs are included and how they're
    weighted. Claims are limited to the pair set tested, with per-pair findings reported
    regardless.
  - Duplicate enrolment can't be detected from the data (section 5).
  - Volunteers aren't a random sample of learners.
