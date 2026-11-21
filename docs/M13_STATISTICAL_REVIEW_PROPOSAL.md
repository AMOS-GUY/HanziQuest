# M13: the decision-interval disagreement, and a proposed independent review

**For the owner.** Status 2026-11-21: proposal only.

- No participant data exists, and none was used.
- The approved protocol (M13_VALIDATION_PROTOCOL.md, D-083) is **unchanged**.
- Every number below comes from synthetic simulation and describes the methods, not the engine.

## The decision in one paragraph

The protocol decides each accuracy target from an upper confidence bound. §3 says that bound is a
writer-level bootstrap, but the bootstrap turns out to be too optimistic with rare events, so a
study could "pass" a target that it can't really support. The analysis toolkit therefore uses a
more cautious rule by default. That rule is a stop-gap, not a validated method. **Recommendation:**
have an independent statistician review the interval and decision method before any confirmatory
analysis. Until then, treat toolkit results as exploratory only.

## What the two methods calculate

|                    | Writer-level percentile bootstrap (§3)                                                                                                                        | Exact bound on the effective n (§3, zero-event cells)                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **How**            | Resample writers with replacement 10,000 times. Recompute the pooled rate each time. The upper bound is the 95th percentile.                                  | Shrink the sample to n / DEFF, where DEFF = 1 + (m − 1)ρ. Scale the events to match. Take the exact one-sided Clopper–Pearson bound.                  |
| **Uses**           | The observed spread between writers only                                                                                                                      | A model: the binomial distribution, plus one correlation ρ (floored at 0.10)                                                                          |
| **Assumes**        | Writers are independent. There are enough writers, and enough distinct event patterns, for the resampling distribution to resemble the sampling distribution. | Writers are independent. One ρ describes the measure, and the design-effect approximation holds. Events are rounded to whole numbers, conservatively. |
| **Known weakness** | With rare events, most resamples contain few or no event-writers. The percentile interval is then too narrow, and it can't be computed at all at zero events. | It's an approximation, not an exact clustered method. If the true ρ is above the floor and estimated low, it under-covers.                            |

## Why the disagreement matters

- **Worked example** (synthetic): 3 accepted wrong characters among 40 writers × 20 samples.

  | Method                                          | Upper bound  | Against ≤ 1 % |
  | ----------------------------------------------- | ------------ | ------------- |
  | Bootstrap (§3 as written)                       | about 0.75 % | **pass**      |
  | Naive Wilson (the protocol calls it optimistic) | about 1.1 %  | —             |
  | Exact bound on the effective n                  | about 2.3 %  | inconclusive  |

- D-083's own planning says a study of 30–40 writers **can't** credibly show ≤ 1 %. Under §3's
  literal rule, it sometimes would.

**Simulation sketch** (`scripts/m13-coverage-sketch.ts`):

- **Design:** 1,000 synthetic studies per row; 20 samples per writer; beta-binomial writers; one
  look; α = 0.05.
- **"Coverage"** is how often the bound reaches the true rate. The nominal value is 95 %.
- **"False pass"** is the pass rate when the true rate equals the target. The design limit is 5 %.
- **Precision:** the Monte Carlo error is about ±1.4 points.

| Writers | True rate  | ρ    | Target | Coverage: §3 rule | Coverage: exact effective n | Coverage: worse of two | Pass: §3 rule         | Pass: worse of two |
| ------- | ---------- | ---- | ------ | ----------------- | --------------------------- | ---------------------- | --------------------- | ------------------ |
| 40      | 0.25 %     | 0.10 | 1 %    | 100 %             | 100 %                       | 100 %                  | 44 %                  | 0 %                |
| 40      | 0.50 %     | 0.10 | 1 %    | 84 %              | 100 %                       | 100 %                  | 46 %                  | 0 %                |
| 40      | **1.00 %** | 0.10 | 1 %    | **80 %**          | 100 %                       | 100 %                  | **24 % (false pass)** | 0 %                |
| 40      | 5.00 %     | 0.20 | 10 %   | 89 %              | 95 %                        | 95 %                   | 85 %                  | 70 %               |
| 120     | 0.25 %     | 0.10 | 1 %    | 86 %              | 100 %                       | 100 %                  | 92 %                  | 72 %               |
| 120     | **1.00 %** | 0.10 | 1 %    | **88 %**          | 99 %                        | 99 %                   | **15 % (false pass)** | 1 %                |

**Reading it:**

- **§3's rule:** it misses its nominal coverage whenever events vary, and its false-pass rate is
  3–5 times the design limit.
- **The exact effective-n bound:** it held its coverage in these scenarios, and 120 writers then
  give about 72 % power at a true rate of 0.25 %, close to §8's plan.

## Why "take the worse bound" isn't a validated procedure

- **No stated coverage:** the larger of two upper bounds is at least as high as each. That makes
  it no _less_ conservative than either, but the combination has no stated coverage of its own.
- **It can be needlessly wide:** that costs power, so a good engine is less likely to pass.
- **It inherits the effective-n method's assumptions.** In every scenario above, the exact bound
  was the larger one, so the "worse of two" rule _was_ the exact bound. Its good behaviour is
  that method's behaviour, under this model.
- **The sketch is narrow:** few scenarios, equal writer sizes, one look, and a single model of
  between-writer variation. Real data could break any of these assumptions:
  - very unequal writers;
  - clustering by character or device;
  - ρ above the floor but estimated low.

## Proposed independent review

**Who:** a statistician independent of this work, with clustered-binary and rare-event
experience.

**Questions:**

1. **The decision interval** for rare-event, writer-clustered proportions. Candidates:
   - the exact effective-n bound, as now;
   - a beta-binomial or GEE-based bound;
   - a bootstrap-t or BCa interval;
   - a writer-level exact method.
2. **The ρ floor** (0.10), and how to estimate ρ or pool it across measures.
3. **Group-sequential looks:** Bonferroni versus an alpha-spending function, given the planned
   three looks.
4. **Unequal writer sizes, and clustering** by character, device and recruitment source.
5. **The planning numbers in §8** under the chosen method: they may move.
6. **A simulation plan,** with acceptance criteria. For example: coverage of at least 93 % and a
   false-pass rate of at most 5 % across a pre-agreed grid of scenarios.

**Deliverables:**

- a written recommendation;
- a §3 and §9 amendment, as a decision entry, if one is needed;
- the extended simulation, committed with its results.

**Cost:** this may involve paying a consultant, which is the owner's decision. Nothing has been
arranged or spent.

## Until then: exploratory versus confirmatory use

| Use                                                                                                                   | Allowed now?                                                                                |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Planning: sample sizes, power, writer counts (exact arithmetic)                                                       | Yes                                                                                         |
| Synthetic dry runs of the analysis, labelled synthetic                                                                | Yes                                                                                         |
| Descriptive reporting of the M12 pilot: rates with writer-level intervals, every caveat shown, the word "exploratory" | Yes, once pilot data exists under consent                                                   |
| Finding failure modes; the §6 per-pair finding rule                                                                   | Yes (exploratory)                                                                           |
| A pass, fail or "meets target" statement about the engine                                                             | **No**, not until the review is done and §3 / §9 are amended or confirmed by decision entry |
| Any public or learner-facing accuracy claim                                                                           | **No**                                                                                      |
| Tuning thresholds from toolkit output                                                                                 | **No**: the six tuning rules and Mode B apply                                               |

**Exploratory output** must carry its method, rule, ρ, writer count and the word "exploratory".
**Confirmatory use** additionally needs:

- the review done;
- the decision rule pre-registered in DECISIONS.md;
- a frozen `ENGINE_VERSION`;
- the analysis code's commit SHA.

## What the toolkit does today

- **Default `rule: "conservative"`:** the worse of the two bounds.
- **`rule: "bootstrap-first"`:** §3 literally.
- **Reported side by side:** the exact bound, the bootstrap and the naive Wilson bound.
- **Not connected** to the lab, the report or any learner page.
