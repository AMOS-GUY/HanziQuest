# M13 owner review and handover (2026-11-13)

**For:** the owner's decision on PR `feature/m13-handwriting-diagnostics` and the next phase.

**Builds on:** the overnight report
([2026-11-13-m13-overnight-engineering-report.md](2026-11-13-m13-overnight-engineering-report.md)).

**Status:** this review changes no grading, candidate sets, XP, mastery or SRS, and starts no new
milestone. Nothing was deployed, merged, collected or spent.

## 0. Branch verification

| Check                 | Result                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                  | `main` = `d712a82b05dbf32be1620cff1ccbbc68ecba3bf5` (unchanged since the branch was cut); it's an ancestor of the branch, so the branch merges without a rebase                                                                                     |
| Commits on the branch | **9**, not 7 (see the correction below). All are authored and committed as `AMOS-GUY <129455823+AMOS-GUY@users.noreply.github.com>`                                                                                                                 |
| Diff vs `main`        | 24 files, 2,625 insertions, 87 deletions at `460fcca`, plus this review's commits. No migration and no workflow change                                                                                                                              |
| PR                    | **Not opened:** this machine has no `gh` and no GitHub sign-in. Use the compare link: https://github.com/AMOS-GUY/HanziQuest/compare/main...feature/m13-handwriting-diagnostics. The PR text is ready in `.local/PR-m13-handwriting-diagnostics.md` |

**Correction:** the handover said "seven commits". There were **eight** at `460fcca`:

1. `9dffc91`: confusable suite and synthetic ink
2. `eb2a6df`: import diagnostics
3. `297d59e`: replay harness and tests
4. `7850083`: M13 docs
5. `5e7dfb9`: engine robustness fix
6. `12acede`: character-page fix
7. `4ba3ea7`: overnight report
8. `460fcca`: CI numbers in the report

This review adds `4bf68d2` (replay review fixes) and a documentation commit.

### Regression review

| Area                         | What I checked                                                               | Result                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Synthetic ink                | The generator moved from `tests/support` into `src`                          | **Byte-identical body** (diffed against `d712a82`); the tests re-export it unchanged                                           |
| Confusable suite             | Seeds, determinism, config id, provenance, missing references                | As documented; the pinned tests pass                                                                                           |
| Import preview               | Advisory only; the validation result is unchanged; e2e import still succeeds | Confirmed by unit and e2e tests                                                                                                |
| Replay harness               | Isolation, truncation, privacy                                               | **Four issues found and fixed**: R1 (MEDIUM), R2 and R3 (LOW) in `4bf68d2`; R4 (MEDIUM) in the follow-up commit. See section E |
| Engine fix `5e7dfb9`         | Independent review (below)                                                   | Correct, no grading change                                                                                                     |
| Character-page fix `12acede` | Dedupe keeps order; only that page's query affected                          | Correct; verified in the browser (谢谢 listed once)                                                                            |

**Replay isolation:**

- **At run time:** every database call goes through `readOnlyClient`. After R1 and R4 the wrap
  is recursive. Every object reachable from the client, at any depth and under string or symbol
  keys, is wrapped. Only read methods (`find*`, `count`, `aggregate`, `groupBy`) can be called,
  plus `$connect` and `$disconnect` at the top level. Setting, defining or deleting properties
  throws too.
- **Probed against the real Prisma client:** every write method, raw statement, transaction,
  `$extends`, `_originalClient`, and the internal client under an unnamed symbol are refused.
  The attempt count before and after is unchanged (631 to 631). That probe is now a permanent
  integration test.
- **In the integration test:** it snapshots these before and after replay, and requires them to
  be byte-identical:
  - the learner's attempts (including stored evaluations and ink), character results, XP,
    mastery, review schedules and daily activity
  - sync events, handwriting samples, consents, participants and the audit log
- **On the local development database:** 410 of 410 stored attempts replay identically.

**Engine robustness fix (`5e7dfb9`), reviewed independently:**

- **Cause:** with a NaN or infinite coordinate, every Hungarian cost became non-finite, no column
  was ever chosen, and the `do…while` never ended.
- **Change:**
  - `assign` maps non-finite costs, and missing cells of a ragged matrix, to the existing padding
    cost
  - `evaluateCharacter` drops non-finite points
- **Identity on valid input:** for finite input, both changes return exactly what they did
  before (the filter keeps every point; `a(i, j)` returns the same cost). So no valid input can
  change result.
- **Empirical evidence:**
  - 410/410 replays identical
  - the synthetic baseline report has identical numbers
  - the probe that never returned now returns TRY_AGAIN in 2–5 ms
- **Exposure:** latent. Every server entry point validates coordinates as finite. The browser
  path (pointer events) produces only finite numbers.
- **Version:** `ENGINE_VERSION` correctly stays `hq-eval-1`, because no valid verdict changes.

**Test attribution:**

| Commit             | Local CI run                                                                                                                  | Covers                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `d712a82` (`main`) | `20261112T173638-ac59`: exit 0, 25 PASS, 0 FAIL, 4 BLOCKED, 2 NOT RUN                                                         | baseline                                                                |
| `7850083`          | `20261112T180316-0493`: same result; 231 unit, 126 integration, 36 e2e                                                        | commits 1–4 cumulatively (not run one by one)                           |
| `4ba3ea7`          | `20261112T183909-28ec`: same result; 235 unit, 126 integration, 36 e2e, backup drill passed                                   | adds commits 5–7                                                        |
| `460fcca`          | not run separately                                                                                                            | docs only: 1 file, the report's CI numbers. Code identical to `4ba3ea7` |
| `e1936e4`          | `20261113T053529-5c59`: exit 0, 25 PASS, 0 FAIL, 4 BLOCKED, 2 NOT RUN; 235 unit, 126 integration, 36 e2e, backup drill passed | adds `4bf68d2` (R1–R3) and the first version of this document           |
| `07f77fe` (final)  | see section G                                                                                                                 | adds `4bf68d2` and this document                                        |

Both branch runs started from a clean tree. **GitHub Actions: not run** (billing restriction).

**Secrets and participant data:**

- **History scan:** a full scan of every git object (1,607) found only the two known synthetic
  test fixtures.
- **Real values:** no real value from `.env` or `.env.staging.local` appears in any commit.
- **Diff:** the branch diff adds no participant codes, personal email addresses, `.env`,
  backup, ledger or `.local` files.
- **Reports:** the public reports contain no private configuration details.

---

## A. Decision register (D1–D12)

### D1 — Look-alikes outside the learner's candidate set are accepted (F1–F7)

- **Context.** On synthetic ink, seven characters are accepted (Good, scores 84–94) when written
  instead of an HSK 1 Starter character, because they aren't in the level's character set:
  - 入 for 八
  - 夫 and 犬 for 天
  - 找 for 我
  - 王 for 五
  - 牛 for 午
  - 孑 for 子
- **Why it matters.** A learner who confuses these is told they're right. Identity only
  compares against the level's characters, so a look-alike outside it can only be caught by
  geometry, and geometry alone is too lenient here.
- **Choices.**
  - (a) Add documented look-alikes to the identity candidate set even when they aren't taught.
  - (b) Tighten `maxIdentityDistance`.
  - (c) Accept the risk for the beta and measure it.
  - (d) Combine (a) and (c): measure first, then (a).
- **Recommendation.** **(d).**
  1. Investigate in shadow mode (section B) and with human samples.
  2. Then implement (a) behind a new `ENGINE_VERSION`, with a before-and-after replay.

  Avoid (b): it moves the distance threshold for every character, the riskiest change for false
  rejections.

- **Risks and consequences.**
  - (a) can reject correct writing that happens to resemble the added look-alike; that
    false-rejection risk must be measured.
  - (c) leaves a known learning-integrity issue in front of beta users.
- **Blocks engineering?** It blocks only the policy implementation. Shadow-mode measurement and
  the performance work can proceed.

### D2 — In-set look-alike 干 written for 千 (F8)

- **Context.** Accepted on 1 of 5 synthetic seeds, even though both are candidates.
- **Why it matters.** It shows identity can fail _inside_ the set when two references are within
  the 0.01 identity margin. More characters bring more near-pairs.
- **Choices.**
  - (a) Investigate the margin distribution now.
  - (b) Defer until HSK 2 content exists. Neither character is in HSK 1 Starter.
- **Recommendation.** (a), as read-only diagnostics only: measure, for every pair in the pool,
  how close the nearest other candidate comes. No grading change.
- **Risks and consequences.** None from measuring. Ignoring it risks silent acceptance as the
  curriculum grows.
- **Blocks engineering?** No.

### D3 — Teacher review of the confusable groups

- **Context.** 13 of 30 groups come from an engineering screen with no teacher review.
- **Why it matters.** The suite is only as good as its pairs, and it could miss the confusions
  real learners make.
- **Choices.**
  - (a) A teacher reviews and extends the groups per level.
  - (b) Keep the current list.
- **Recommendation.** (a), combined with the HSK 1 Starter content review already needed for M14.
- **Risks and consequences.** Teacher time, which may cost money.
- **Blocks engineering?** No.

### D4 — Record the configuration id on new attempts

- **Context.** Stored attempts record the engine version but not the weights or configuration,
  so replay can't tell a weights change from a bug (`unexplained-difference`).
- **Why it matters.** Any future scoring change needs clean before-and-after attribution.
- **Choices.**
  - (a) Add `configId` to the stored evaluation JSON (additive).
  - (b) Leave it as is.
- **Recommendation.** (a), before any scoring change.
- **Risks and consequences.** It changes the stored evaluation format (additive). Old attempts
  stay without it.
- **Blocks engineering?** It blocks the scoring-scale milestone's policy part (M13-b), not the
  performance part.

### D5 — The lab's candidate set

- **Context.** The lab scores samples against every character with stroke data; learners are
  scored against their level's characters.
- **Why it matters.**
  - Lab metrics for look-alikes are more favourable than what learners experience: F1–F7 would
    look fine in the lab.
  - The lab is also slower (F-6).
- **Choices.**
  - (a) The lab mirrors the learner's level.
  - (b) Report both views.
  - (c) Leave it.
- **Recommendation.** (b). Both views answer different questions: engine capability vs learner
  experience.
- **Risks and consequences.** It changes lab metrics, not grading. Report wording must keep the
  two apart.
- **Blocks engineering?** It should be settled before real samples are analysed.

### D6 — Approve the M12 consent form and run the pilot

- **Context.** The form is a draft. The app refuses real participant codes until
  `ownerApproved` is flipped.
- **Why it matters.** Without human samples, nothing about accuracy can be established, and F1–F8
  can't be confirmed or dismissed.
- **Choices.**
  - (a) Approve as is.
  - (b) Amend first.
  - (c) Get legal or ethics review first.
- **Recommendation.** (c), then (a) or (b).
- **Risks and consequences.** Delay. Running without review risks consent defects.
- **Blocks engineering?** It blocks all accuracy work and the validation study, not engineering
  generally.

### D7 — Backup retention and the erasure window

- **Context.** Backups keep erased samples until they expire (M12 erasure review).
- **Why it matters.** Honest erasure promises to participants depend on it.
- **Choices.** Set a retention period, and a deletion window at least as long.
- **Recommendation.** Set both before the pilot. For example, 35 days of retention and a
  45-day window; your call.
- **Risks and consequences.** None technical.
- **Blocks engineering?** It blocks the pilot's consent text.

### D8 — GitHub Actions billing restriction

- **Context.** Jobs are refused because of an account billing issue, although the repository is
  public.
- **Why it matters.** The Ubuntu, PostgreSQL 17 and Docker checks, and a real `backup.yml` run,
  have never been verified.
- **Choices.**
  - (a) Resolve the billing issue (owner).
  - (b) Keep relying on local CI.
- **Recommendation.** (a). No spending was made or attempted here.
- **Risks and consequences.** Untested differences between Windows/PostgreSQL 18 and
  Ubuntu/PostgreSQL 17.
- **Blocks engineering?** No, but every merge so far rests on local evidence only.

### D9 — Repository security settings

- **Context.** Recommended in docs/PUBLIC_REPOSITORY.md:
  - environment protection rules
  - approval for outside contributors' workflow runs
  - secret scanning and push protection
- **Why it matters.** It's defence in depth for a public repository.
- **Choices.** Apply them, or not.
- **Recommendation.** Apply them (free).
- **Risks and consequences.** None.
- **Blocks engineering?** No.

### D10 — Traditional characters

- **Context.** 0 of 102 characters and 0 of 81 words have a traditional form.
- **Why it matters.** Learners in Taiwan, Hong Kong or heritage contexts are not served.
- **Choices.** Support them, defer, or declare the app simplified-only.
- **Recommendation.** Decide the audience first. Until then, say "simplified only" clearly.
- **Risks and consequences.** Supporting them means content and stroke-data work.
- **Blocks engineering?** No.

### D11 — Mobile header link size

- **Context.** The mobile header's text links are 20 px tall. They pass WCAG 2.5.8 through its
  spacing exception, but are small for touch.
- **Why it matters.** Mis-taps on phones.
- **Choices.** Enlarge them to 44 px, or keep them.
- **Recommendation.** Enlarge them in the next UI pass.
- **Risks and consequences.** The header grows slightly.
- **Blocks engineering?** No.

### D12 — Next milestone order

- **Context.** Section F.
- **Why it matters.** It sets the next phase.
- **Choices.** Approve, reorder or change the sequence in section F.
- **Recommendation.** As in section F.
- **Risks and consequences.** As noted there.
- **Blocks engineering?** Yes: no new feature milestone starts without it.

---

## B. Handwriting identity investigation

### How identity works (`evaluate.ts`, unchanged)

The written character is compared, stroke by stroke, with the expected character and with every
other candidate (the level's characters). Two rules decide identity:

1. **Margin rule.** Another candidate becomes the "best match" only if its distance is lower than
   the expected character's by more than `identityMargin` (0.01).
2. **Distance limit.** Identity is "verified" only if the best match is the expected character
   **and** its distance is at most `maxIdentityDistance` (0.2).

### Why the seven out-of-set cases are accepted

- **What happens:** for 入 written in place of 八, the engine never sees 入: it isn't a candidate,
  because HSK 1 Starter doesn't teach it. So rule 1 can't pick it.
- **Why rule 2 doesn't catch it:** rule 2 only asks whether the writing is close enough to 八.
  入 and 八 have the same stroke count and similar stroke paths, so the distance stays under 0.2
  and the scores land at Good (84–94).
- **Why never Excellent:** the shape dimension does notice the difference, which is why no case
  reached Excellent. But it isn't enough to fall below the Good cut-off (72).
- **The control test:** adding the look-alike to the candidate set makes rule 1 reject it in
  5 of 5 trials, for all seven.

So the weakness isn't in the geometry. It's that **identity can only reject characters it knows
about**.

### Why the in-set case (干 for 千) is accepted on one seed

- **What happens:** both are candidates, but their references are so close that, for seed 1,
  干's distance beat 千's by less than the 0.01 margin.
- **Result:** 千 stays the best match, within the distance limit, so the attempt is accepted
  (Good 93).
- **Note:** this is a margin effect, not a missing candidate.

### How to investigate without changing grading

1. **Shadow candidate replay (read-only).** Extend the replay harness to evaluate stored
   attempts twice: with the real candidate set, and with the set extended by documented
   look-alikes. Report how often the verdict would change:
   - wrongly accepted look-alikes that become rejected (the benefit)
   - correct attempts that become rejected (the cost)

   Outputs go to stdout or JSON only. Nothing is stored or graded.

2. **Margin census (read-only).** For every taught character, measure the distance to its
   nearest other reference in the full stroke-data pool, and list pairs under twice the margin.
   That predicts F8-type cases before content is added.
3. **Human evidence.** The M12 pilot prompts already include some look-alikes (人→八, 天→午,
   他→她…).
   - **Protocol amendment for the M13 study:** add F1–F8 so each pair is written by several
     people. That's an owner decision (D6).
   - **Sample size:** a per-pair acceptance rate needs roughly 20 or more writers × 3 samples per
     pair to give a usable interval (at 60 samples, a 95 % interval is about ±13 points near 50 % and narrower near 0 or 100 %).
4. **Teacher review** of which look-alikes matter for each level (D3).
5. **Then decide (D1),** and implement any change behind a new `ENGINE_VERSION`, with:
   - the confusable suite before and after
   - a full replay before and after
   - the false-rejection controls

---

## C. Performance investigation

### What was measured

All runs are local, on synthetic ink, with 10 trials each.

| Candidates          | Time per evaluation | Correct 你 verified |
| ------------------- | ------------------- | ------------------- |
| 102 (HSK 1 Starter) | 10 ms               | 10/10               |
| 300                 | 31 ms               | 10/10               |
| 1,000               | 98 ms               | 10/10               |
| 3,000               | about 400 ms        | 3/3                 |

That's linear: about 0.13 ms per candidate.

### The bottleneck

For **every** candidate, `evaluateCharacter` runs a full `align()`:

1. **Stroke-pair cost matrix:** for _u_ user strokes and _r_ reference strokes, _u × r_ pair
   costs. Each compares 16 resampled points forwards and backwards, so 32 point distances.
2. **Hungarian assignment** on the matrix: O(n³) with n = max(_u_, _r_). For a 7–12 stroke
   character, that's a few hundred to a few thousand steps.
3. **Unmatched-stroke penalties** and the per-stroke average.

Reference preparation (normalisation and resampling) is already cached per character, so
alignment is the whole cost. There is **no pruning**: an obviously different character, with 3
strokes against 12, costs as much as a close one.

### Where it hurts

- **Learner path:** level sets are small for HSK 1 (10 ms). An HSK 4–6 level with 1,000 or more
  characters would cost about 100 ms or more per character, synchronous on the server, and
  slower on a phone.
- **Lab:** every page view re-scores every sample against every character (F-6). That's an
  estimated 6 s per view at 600 samples today, growing with the curriculum.

### Optimisation options

None of these changes a verdict, and each must be proven identical with the replay harness and
the confusable suite before adoption.

| #   | Option                                                                                                                                                                                                                                                                                                        | Exact?                                                 | Expected effect                                                                                                                                    | Effort                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **Stroke-count lower-bound pruning.** A candidate with stroke difference Δ has distance ≥ Δ × 0.35 / max(_u_, _r_) (each surplus stroke is unmatched). Skip it when that bound is at least the current best minus the margin. It keeps the same iteration order, so the margin rule behaves exactly as before | **Yes**                                                | Estimated (not measured) **65 %** of alignments skipped for HSK 1 Starter, **77 %** against all 9,574 characters, assuming a best distance of 0.10 | Small                   |
| 2   | **Bucket candidates by stroke count** so pruning skips whole buckets                                                                                                                                                                                                                                          | Yes                                                    | Removes the remaining per-candidate overhead                                                                                                       | Small                   |
| 3   | **Early exit in the cost matrix** when a partial row sum already exceeds the bound                                                                                                                                                                                                                            | Yes, if done carefully                                 | Further constant-factor gain                                                                                                                       | Medium                  |
| 4   | **Cache lab metrics** per engine config id and sample set, instead of re-scoring on every page view                                                                                                                                                                                                           | Yes (cache invalidated by config id or sample changes) | The lab page becomes instant after the first computation                                                                                           | Small                   |
| 5   | **Move server-side scoring to a worker thread**                                                                                                                                                                                                                                                               | Yes                                                    | Keeps one slow evaluation from blocking other requests; doesn't reduce total CPU                                                                   | Medium                  |
| 6   | Approximate pre-filter (coarse shape features, or a nearest-neighbour index)                                                                                                                                                                                                                                  | **No**, approximate                                    | Large gain at scale                                                                                                                                | Large; needs validation |

**Recommendation:**

- Options 1, 2 and 4 in the scoring-scale milestone (M13-b, section F).
- Option 5 if server latency shows up.
- Not option 6 until there's real-sample evidence.

---

## D. Validation plan: evidence needed before any accuracy claim

### Targets (HANDWRITING_VALIDATION.md)

| Metric                      | Target |
| --------------------------- | ------ |
| False rejection             | ≤ 10 % |
| Structural false acceptance | ≤ 2 %  |
| Wrong-character acceptance  | ≤ 1 %  |
| Specific error named        | ≥ 80 % |

### What showing a target takes

With zero errors observed, the one-sided 95 % upper bound is about 3/_n_:

- **Wrong-character acceptance ≤ 1 %:** about **300** wrong-character samples with **zero**
  acceptances (the upper bound is then about 1.0 %). One acceptance in 300 gives an upper bound
  of about 1.6 %, which misses the target; with one acceptance, about **475** samples are
  needed. (Exact one-sided 95 % Clopper-Pearson bounds. Corrected during the review: an earlier
  draft said "at most 0–1 acceptances" for 300.) The current minimum is "300 incorrect samples" across all error types, which
  doesn't achieve this for wrong characters alone. That's why the validation amendment (about
  300 wrong-character samples) is recommended.
- **Structural false acceptance ≤ 2 %:** about **150** structural-error samples.
- **False rejection ≤ 10 %:** about 300 correct samples gives roughly ±3.5 points.

### Who and how

- **Writers:** at least 15 participants, with a **held-out third chosen by participant**, so no
  writer is in both sets. The split tooling is ready.
- **Writer variation dominates:** the effective sample size is closer to the number of writers
  than the number of samples. Report per-writer spread.
- **Coverage:** finger, stylus and mouse; small and large writing; beginners and experienced
  writers.
- **Two views of results:** both candidate-set views (D5). Learner-level results are the ones
  that apply to learners.
- **Look-alikes:** F1–F8 in the prompts, with about 20 or more writers per pair (section B).

### Limits of the 5-person pilot

- **Too few error samples:** 5 writers and 180 samples, but only **10 wrong-character samples**.
  Even with 0 accepted, the 95 % upper bound is about 26 %, against a 1 % target.
- **No independent held-out set:** the held-out third would be 1–2 writers.
- **What it can show:** that the procedure works, gross failures by device or size, whether the
  feedback feels fair, and first human data on a few look-alikes.
- **What it can't show:** any accuracy figure. Its report must be headed "not an accuracy
  estimate".

### What must never count as evidence

- Synthetic ink, including everything in M13.
- `TEST` rehearsal samples.
- Results from the lab's all-characters candidate view presented as learner accuracy.

---

## E. Technical debt and audit findings

### Overnight audit findings (F-1 to F-18)

| #    | Finding                                                                                     | Severity                                      | Evidence                                         | Status                                       | Recommended action                                  |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ | -------------------------------------------- | --------------------------------------------------- |
| F-1  | The engine never returned on NaN or infinite coordinates                                    | MEDIUM                                        | Probe timed out at 60 s; Hungarian loop analysis | **Fixed** `5e7dfb9`; independently reviewed  | —                                                   |
| F-2  | A word listed twice on a character page (谢谢 on 谢)                                        | LOW                                           | Browser, React key error, database lookup        | **Fixed** `12acede`; browser-verified        | —                                                   |
| F-3  | Seven out-of-set look-alikes accepted (F1–F7)                                               | HIGH (learning integrity; synthetic evidence) | Confusable suite; pinned tests                   | Documented                                   | D1; section B                                       |
| F-4  | In-set 干→千 accepted on 1 of 5 seeds (F8)                                                  | MEDIUM                                        | Suite over all groups                            | Documented, pinned                           | D2; margin census                                   |
| F-5  | Lab and learner candidate sets differ                                                       | MEDIUM                                        | `loadAllReferences` vs `loadLevelReferences`     | Documented                                   | D5                                                  |
| F-6  | Linear evaluation cost; the lab re-scores everything per view                               | MEDIUM                                        | 10 ms to 400 ms table; lab code                  | Investigated                                 | Section C, options 1, 2 and 4                       |
| F-7  | The import-preview check is synchronous, about 3–4 s                                        | LOW                                           | `content:validate` timing                        | Accepted (admin-only)                        | Worker if files grow                                |
| F-8  | A non-square box costs about 5 points and one band at a 0.6 squeeze                         | INFO                                          | Probe                                            | Accepted (the canvas is CSS `aspect-square`) | —                                                   |
| F-9  | Invariant to size, speed and coordinates beyond the box; degenerate input rejected cleanly  | INFO                                          | Probe                                            | Verified                                     | —                                                   |
| F-10 | A retried lesson-complete sync can create one extra empty session; XP isn't doubled         | LOW                                           | `sync-service.ts` review; keyed XP award         | Investigated                                 | Make session creation idempotent per event (future) |
| F-11 | Every route handler and server action authorizes on the server; object-level checks present | INFO                                          | Code review                                      | Verified (static)                            | —                                                   |
| F-12 | Mobile header links are 20 px tall                                                          | LOW                                           | Browser measurement                              | Investigated                                 | D11                                                 |
| F-13 | No horizontal overflow at 375 px on sampled pages; framing refused                          | INFO                                          | Browser                                          | Verified                                     | —                                                   |
| F-14 | Curriculum gaps: no traditional forms, examples or audio; 3 known warnings                  | LOW                                           | Content probe; `content:report`                  | Investigated                                 | D10; M14-b teacher review                           |
| F-15 | Doc inconsistencies: "10 testers" vs 15; in-set qualifier; stale roadmap table              | LOW                                           | Docs vs `MIN_SAMPLES`                            | **Corrected** (dated notes)                  | —                                                   |
| F-16 | New code: participant codes in the held-out report                                          | MEDIUM (had it shipped)                       | Test failure before commit                       | **Fixed before commit**; test-guarded        | —                                                   |
| F-17 | The local development database holds left-over e2e curricula                                | INFO                                          | `content:report`                                 | Accepted (local)                             | Optional local clean-up script                      |
| F-18 | Client JS 1.58 MB raw, 478 KB gzipped across routes; largest chunk 234 KB                   | INFO                                          | Build output                                     | Measured locally                             | Per-route analysis later                            |

### Review findings in my own replay code (fixed in `4bf68d2`)

| #   | Finding                                                                                                                                                                                                          | Severity | Evidence                                                                                                                                  | Status                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| R1  | `readOnlyClient` let `$extends` (and `$on`) through. `$extends` returns an unwrapped client that could write                                                                                                     | MEDIUM   | Code review; unit test (fails before the fix with a `TypeError` instead of `ReadOnlyViolation`)                                           | **Fixed**; only `$connect` and `$disconnect` pass                                            |
| R2  | Attempt replay silently stopped at the oldest 5,000                                                                                                                                                              | LOW      | Code review                                                                                                                               | **Fixed**: `eligible` and `truncated` reported; integration test                             |
| R3  | The held-out split inherited the lab's 20,000-sample cap silently                                                                                                                                                | LOW      | Code review                                                                                                                               | **Fixed**: `stored` reported, plus an insufficiency reason; integration test                 |
| R4  | The read-only wrap was one level deep and passed symbol-keyed values through. Prisma's internal client (under an unnamed symbol, and `_originalClient`) gave unwrapped model delegates whose `create` would work | MEDIUM   | A probe against the real client; unit test (fails on the old wrapper, passes on the new); integration test against the real Prisma client | **Fixed**: recursive wrap at every depth and for symbol keys; set, define and delete refused |

### Technical debt, prioritised

1. Identity depends on the candidate set (F-3, F-4).
2. Lab vs learner candidate sets (F-5).
3. Linear evaluation cost (F-6).
4. No configuration id on attempts (D4).
5. The synchronous import check (F-7).
6. Contract migrations pending: unused `ErasureLedgerGate` columns, and legacy
   `HandwritingSample.notes`.
7. Content gaps (F-14).
8. The extra sync session (F-10).
9. Header target size (F-12).

---

## F. Roadmap reconciliation

### What was approved (ROADMAP.md, 2026-11-12)

1. M12 pilot
2. M14 alongside M12
3. M15
4. M13
5. M16
6. M17

### What actually happened

| Milestone    | State                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M12**      | Pilot privacy tooling merged (PRs #22, #23). **The pilot itself hasn't run**; it needs D6 and D7                                                                                                                                                                                                                                                                |
| **M14**      | **M14-a (infrastructure) is merged** with M12 (PR #22): source register, edition tags, example provenance, review metadata. **M14-b is still open:** the admin review queue page, the learner-facing edition label, fixing the 3 content warnings with a teacher, the teacher review of HSK 1 Starter, and sourcing the HSK lists. M14 isn't renamed or skipped |
| **M15**      | Not started                                                                                                                                                                                                                                                                                                                                                     |
| **M13**      | Brought forward by owner instruction. This branch delivers its **diagnostic** part. Still open: the dispute route, the technique-cap decision and any tuning (they need real samples and a teacher), plus the scoring-scale and policy work below                                                                                                               |
| **M16, M17** | Not started                                                                                                                                                                                                                                                                                                                                                     |

**The overnight report's "Proposal 2" is renamed here, explicitly, to "M13-b"** rather than
given a new number. It's within M13's stated scope ("accuracy and false-positive handling"), so
a new milestone number would have fragmented the roadmap.

### Proposed sequence (for approval)

| Step | Milestone                                                                                                             | Depends on                                                                                                          | Why now                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 0    | **Merge M13 diagnostics** (this PR), after review                                                                     | owner review                                                                                                        | Closes the diagnostic part of M13                                                           |
| 1    | **M14-b**: curriculum review workflow (admin review queue, edition label; the 3 warnings once a teacher is available) | D3 and the teacher for the content parts; the UI parts are local                                                    | Already approved; the content-growth safety net (M13 suite on every import) is now in place |
| 2    | **M15**: learning measurement and onboarding                                                                          | none local                                                                                                          | Next in the approved order                                                                  |
| 3    | **M13-b**: scoring scale and candidate policy                                                                         | none for the performance options; D1, D4 and D5 for the policy part; human evidence (step 4) for any grading change | Needed before HSK 2+ content                                                                |
| 4    | **M12 pilot execution, then the M13 validation study**                                                                | D6 and D7, recruiting (owner)                                                                                       | The only route to accuracy evidence. It runs whenever approved, in parallel with steps 1–3  |
| 5    | **M16**: SRS calibration                                                                                              | weeks of beta data                                                                                                  | Unchanged                                                                                   |
| —    | **M17**: beta blockers                                                                                                | owner actions (D8, D9, legal, staging)                                                                              | Unchanged; runs in parallel and gates the first invites                                     |

**Alternative:** if HSK 2 content is wanted soon, move M13-b's **performance** options
(section C, 1, 2 and 4) ahead of M15. They change no verdicts and are small.

**Out of scope until decided:** any grading change, payment systems, classrooms and social
features.

---

## G. Final verification of this review

Filled in after the full local CI run on this review's final commit:

| Item                      | Result                                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final code commit         | `07f77fe9441feba1042a38a95f1055a9a75801dc` (the commit after it only records this table)                                                             |
| Local CI                  | run `20261113T055038-1b5c`: **exit 0. PASS 25, FAIL 0, BLOCKED 4, NOT RUN 2**                                                                        |
| Test counts               | 236 unit, 127 integration, 36 e2e passed; backup drill passed all checks                                                                             |
| BLOCKED                   | `age` and Docker ×3 (not installed). NOT RUN: Firefox (advisory) and the report upload                                                               |
| GitHub Actions            | **Not run:** account billing restriction                                                                                                             |
| Replay safeguards         | R1–R4 each covered by regression tests (unit and integration). The R4 unit test fails on the previous wrapper                                        |
| Replay coverage           | 410 of 410 attempts replayed, identical, 0 nondeterministic; `--limit 50` reports "50 of 410 (TRUNCATED…)"                                           |
| Writable client escape    | None: every write path on the real Prisma client, including internal and symbol-keyed ones, is refused (integration test); the database is unchanged |
| Engine fix on valid input | Identical: 410/410 replays and the synthetic baseline report                                                                                         |
