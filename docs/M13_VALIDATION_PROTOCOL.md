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

## 5. Writer-based train, validation and test split

- **Assignment by writer:** writers, not samples, are assigned before any sample is analysed,
  stratified by experience (beginner, some, fluent) and main input (finger, stylus, mouse):
  - **Training:** 50 % of writers. Used for any tuning candidates.
  - **Validation:** 25 %. Used to choose between candidates.
  - **Test:** 25 %. Analysed **once**, for the final decision.
- **Locking the test set:**
  - The test writers' participant codes are hashed (SHA-256 with a salt the owner keeps), and
    the hashes are recorded in DECISIONS.md before anyone looks at their samples.
  - Looking at test data before the final evaluation **burns** it: those writers move to
    training, and new test writers must be recruited.
- **Pilot participants** (P01–P05) are never in the test set; they may be training writers.
- **Engine version:** the test set is evaluated on a single, frozen `ENGINE_VERSION`, recorded
  with the result.

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

Exact one-sided 95 % Clopper–Pearson bounds, computed for this protocol. These are the
**effective** samples needed, after dividing by the design effect:

| Target                                 | 0 observed | 1 observed | 2 observed | 3 observed |
| -------------------------------------- | ---------- | ---------- | ---------- | ---------- |
| Wrong-character acceptance ≤ 1 %       | 299        | 473        | 628        | 773        |
| Structural false acceptance ≤ 2 %      | 149        | 236        | 313        | 386        |
| FRR ≤ 10 % (judged on the upper bound) | 29         | 46         | 61         | 76         |

- **Few errors are allowed.** Even with zero acceptances, ≤ 1 % needs about 300 effective
  wrong-character samples. With a design effect around 2 that's roughly **600 written samples
  from ≥ 30 writers**.
- **A proposed minimum, to be decided by the owner:**
  - **≥ 30 writers**, of whom ≥ 8 are locked test writers;
  - **≥ 600** wrong-character samples (substitutions) and **≥ 300** structural-error samples;
  - **≥ 300** correct samples;
  - the per-writer cap in section 4.

  This is above the earlier "300 / 300 / 15 writers". That earlier minimum treats samples as
  independent, which they aren't.

- **FRR precision:** with 300 correct samples and an observed FRR of 5 %, the naive Wilson upper
  bound is about 8 %. At 8 % observed, it's about 11.6 %, which is inconclusive.

## 9. Stopping, expanding or rejecting

The study is analysed at up to **three pre-planned looks**: at 15, 25 and 40 writers. Looking
repeatedly raises the chance of a false "pass", so each look uses α = 0.05 / 3, a one-sided
98.3 % bound (Bonferroni). Under that rule, zero wrong-character acceptances need 408 effective
samples, and zero structural acceptances need 203.

| At a look                                                                                      | Decision                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every target's upper bound (writer-level, Bonferroni) meets the target on the **test** writers | **Stop: pass.** Report the results with intervals and their population. No tuning.                                                                              |
| A point estimate meets the target but its upper bound doesn't                                  | **Expand** to the next look, if any. After the last look: **inconclusive**. Report it, and make no claim.                                                       |
| A measure's **lower** bound is already worse than its target                                   | **Stop: fail** for that measure. Tune on training writers only, choose on validation writers, then confirm on **new** test writers. The old test set is burned. |
| > 10 % of sessions deviate from the protocol (wrong prompts, device faults, interruptions)     | **Stop: invalid.** Fix the procedure; the samples are kept as exploratory only.                                                                                 |
| A consent, privacy or safety problem                                                           | **Stop immediately** (M12 rules).                                                                                                                               |

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

1. Adopt the proposed minimum in section 8 (≥ 30 writers; ≥ 600 substitutions, ≥ 300
   structural, ≥ 300 correct), or keep the earlier minimum and accept weaker conclusions.
2. The three-look plan and the Bonferroni rule (section 9).
3. Whether disputed ink may ever become validation samples (needs per-person consent).
4. The technique-cap decision, with a teacher. It isn't part of this study.
5. Recruiting, the location and consent, as in M12. Nothing is started.
