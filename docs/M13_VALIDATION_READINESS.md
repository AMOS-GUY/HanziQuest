# M13 validation study: readiness checklist

**Status (2026-11-21):** preparation only.

- No participant has been recruited.
- No human sample has been collected.
- No study has been run.
- Nothing in this file is a measurement.

This list says what must be true before the first real session of the study in
M13_VALIDATION_PROTOCOL.md. Items marked **owner** can be closed only by the owner.

Legend: ☐ not done · ◐ partly done · ☑ done (with where it's done).

## 1. Owner decisions (protocol §12)

- ☐ **owner:** which claim the first study aims for: (a) estimation with about 30–40 writers,
  (b) confirmatory with about 75–160 writers, or (c) first (a), then (b).
- ☐ **owner:** the look plan: one look, or three with Bonferroni (§9).
- ☐ **owner:** the ρ assumption used for planning (0.05 and 0.10 are proposed).
- ☐ **owner:** whether disputed ink may ever become validation samples. The default is no.
- ☐ **owner, with a teacher:** the technique-cap decision. It's outside this study.
- ☐ **owner:** the planned writer count W. The look schedule depends on it (§9).

## 2. Prerequisite: the M12 pilot

- ☐ The M12 exploratory pilot (P01–P05) has run under M12_PILOT_PROTOCOL.md.
- ☐ Its findings are written up: procedure problems, gross failures, and a first, rough ρ.
- ☐ The prompt list has been revised from the pilot and the confusable diagnostics (§6). It's
  then frozen, and its hash is recorded in DECISIONS.md.

## 3. Consent, legal and privacy

- ◐ **Consent gate:**
  - **Done:** `PilotConsent` is enforced by `features/handwriting/consent.ts`. Samples need an
    unrevoked consent for the current form version.
  - **Not done:** `ownerApproved` is **false**, so real codes are refused. **owner:** approve
    the form (D-057 to D-059).
- ☐ **owner:** the consent form covers this study's use. The study means more writers, longer
  retention, use by future engine versions, and per-source reporting. The M12 pilot form may
  not. Any change to the form is a new form version.
- ☐ **owner:** retention period and deletion route agreed. Erasure goes through
  `features/handwriting/participants.ts` (built).
- ☐ **owner:** decide whether the study needs ethics or legal review where it runs (school,
  employer, minors). No legal commitment has been made.
- ☑ **No identity in the lab:** codes only, no free text (D-057 to D-059). Pilot feedback stays
  on paper (D-063).
- ☑ **Erasure after restore:** restores are gated until the signed erasure ledger is applied.
  The key is owner-held (D-061, D-062).

## 4. Study design locked before data

- ☐ **Pre-registration:** a DECISIONS.md entry, written before the first session, recording:
  - mode (A or B);
  - W and the look schedule;
  - the targets;
  - the ρ floor (0.10);
  - the prompt-list hash;
  - `ENGINE_VERSION`;
  - the analysis code version (commit SHA).
- ☐ **Mode B only:** the salted hashes of the test writers' codes, recorded in DECISIONS.md
  before anyone looks at their samples (§5). The salt is owner-held.
- ☐ **Duplicate-enrolment check:** a paper procedure that keeps one person from enrolling under
  two codes (§5). This limitation can't be solved in software.
- ☐ **Recruitment source:** recorded per writer so results can be reported by source (§5).
  - **Gap:** the lab has no field for it. A fixed list (no free text) would be needed.
  - **owner:** decide whether to add one. A lab change, not an engine change.

## 5. The lab and the analysis tooling

- ☑ **Lab collection:** samples, consent, metrics, export and report. `MIN_SAMPLES` is the
  **floor** before tuning (300 / 300 / 15). The lab page and report now say it's necessary, not
  sufficient.
- ☑ **Replay harness:** read-only, deterministic (`npm run handwriting:replay`).
  - **Its split is diagnostic:** the `sha256(code)` third (D-069) is not the Mode B study split.
    Don't use it as a test set.
- ◐ **Analysis the protocol requires, but the lab doesn't do yet.**
  - The lab reports pooled rates only, with no intervals.
  - Pure, tested functions for the items below are in
    `src/features/handwriting/validation-stats.ts` and `src/lib/statistics/binomial.ts`. None
    of them is wired into the lab or the report.

  | Requirement (protocol section)                   | Status                                         |
  | ------------------------------------------------ | ---------------------------------------------- |
  | Cap of 2 per (writer, character, condition) (§4) | `capPerWriter`                                 |
  | First attempt per prompt; retries apart (§4)     | Not built: needs a prompt identifier           |
  | Leave-one-writer-out stability (§4)              | `leaveOneWriterOut`                            |
  | Writer-level cluster bootstrap (§3)              | `clusterBootstrapInterval` (≥ 10 writers)      |
  | ρ estimate and effective n (§3, §8)              | `intraWriterCorrelation`, `decisionBound`      |
  | Exact one-sided bounds per look (§8, §9)         | `exactUpperBound`, `lookAlpha`, `lookSchedule` |
  | Pass / expand / fail decision per measure (§9)   | `decide` (at-most and at-least targets)        |
  | Naive Wilson, labelled "assumes independence"    | In `decisionBound` (reference only)            |
  | Per-pair counts and the §6 finding rule          | `pairSummaries`                                |
  | Report by device, size and recruitment source    | Device and size exist; source doesn't          |

- ☐ **owner (with a statistician if possible): amend §3's decision interval.** §3 makes the
  writer-level percentile bootstrap the decision interval whenever events vary, and the exact
  bound on the effective n only for zero-event cells. With sparse events the bootstrap is
  optimistic, and that **contradicts §8 and D-083**:
  - **Example** (synthetic): 3 accepted wrong characters among 40 writers × 20 samples.
    - Bootstrap upper bound: about 0.75 %. Under §3 as written, this **passes** ≤ 1 %.
    - Naive Wilson bound: about 1.1 %. The protocol already calls this optimistic.
    - Exact bound on the effective n: about 2.3 %.
  - D-083 says 30–40 writers can't credibly show ≤ 1 %.
  - **What the toolkit does:** its default (`rule: "conservative"`) takes the worse bound of the
    two in each direction. §3's literal rule stays available as `rule: "bootstrap-first"`.
  - **Proposed amendment:** §3 adopts the conservative rule. It needs a decision entry before
    the first look (pre-registration).

- ☐ **Wiring:** a writer-level section in `npm run handwriting:report`. It needs the decisions
  above, and it must not change grading.
- ☐ **Dry run:** the full analysis run end to end on **synthetic** data, labelled synthetic,
  before any real session. Its numbers are never evidence.

## 6. Session logistics (M12 rules)

- ☐ **owner:** location, devices (phone with finger, tablet with stylus, laptop with mouse),
  and a session runner trained on the procedure.
- ☐ The session script and paper forms printed. No feedback goes into the app.
- ☐ A deviation log on paper. More than 10 % deviating sessions makes the study invalid (§9).
- ☐ A stop rule for consent, privacy or safety problems, known to the runner (§9).

## 7. Things that must not happen

- No sample is collected before every item in sections 1, 3 and 4 is closed.
- No threshold or scoring change follows a look at test data (§5).
- No accuracy statement without its interval and population (§2).
- Synthetic results, pilot results and disputes are never presented as validation.
