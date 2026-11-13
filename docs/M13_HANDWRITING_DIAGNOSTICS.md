# M13 — Handwriting reliability diagnostics

**Status (2026-11-13, branch `feature/m13-handwriting-diagnostics`, not merged):** diagnostic
tooling only.

**Not changed:** how learners are graded, the scoring algorithm, `THRESHOLDS`,
`ENGINE_VERSION`, identity matching, candidate sets, XP, mastery and SRS.

**Not evidence of accuracy:** nothing here shows that handwriting recognition is accurate.
Every finding below comes from **synthetic ink** and describes the engine's geometry. Accuracy
with real learners is still unknown: no human samples exist (M12 pilot not run; validation needs
15 or more participants).

## What was built

| Area                       | Where                                                                                                                                     | What it does                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confusable-character suite | `src/features/handwriting/confusables.ts`                                                                                                 | Writes look-alike characters in place of the expected one, with seeded synthetic ink and the unchanged engine. It records the expected and submitted character, candidate-set membership, engine version, configuration id, band, score, identity outcome and classification. False acceptance (look-alikes) and false rejection (correct controls) are kept separate |
| Import diagnostics         | `src/features/curriculum/confusable-diagnostics.ts`; shown in Admin → Import preview and by `npm run content:validate / preview / import` | **Advisory only.** Runs the suite for the characters a file teaches, with that file's characters as the candidate set (what learners at that level are checked against). It explains each risk and never blocks or changes an import                                                                                                                                  |
| Replay harness             | `src/features/handwriting/replay.ts`, `npm run handwriting:replay`                                                                        | Re-scores stored learner attempts and lab samples with the current engine, **read-only**. It compares the result with the stored evaluation, checks determinism, reports duplicate submissions, and splits lab samples by participant into development and held-out sets                                                                                              |
| Synthetic ink              | `src/features/handwriting/synthetic-ink.ts`                                                                                               | The existing seeded generator, moved from `tests/support` so server-side diagnostics can use it. Re-exported unchanged for the tests                                                                                                                                                                                                                                  |

## Pair selection and provenance

There is **no universal confusable list**. Each group in `CONFUSABLE_GROUPS` records where it
came from:

| Provenance            | Groups                                                                                                                        | Source                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roadmap-m13`         | 他/她, 人/八/入, 日/目/白, 土/士, 己/已/巳                                                                                    | The pairs named in ROADMAP.md (M13 scope)                                                                                                                                                                |
| `m12-pilot-lookalike` | The 12 pairs of `LOOKALIKE` in `pilot.ts` (人/八, 上/下, 女/子, 中/十, 天/午, 他/她, 好/妈, 你/他, 我/没, 是/星, 谢/说)       | The look-alikes the M12 pilot asks participants to write, so the suite and the pilot agree                                                                                                               |
| `engineering-screen`  | 天/夫/大/太/犬, 午/牛/年, 子/了/孑, 王/玉/主/五, 我/找, 十/千/干, 未/末/本, 儿/几/九, 少/小, 今/令, 生/牛, 口/日/中, 上/下/卡 | An engineer's visual screen (2026-11-13) for characters that differ from an HSK 1 Starter character by one stroke, or by a stroke's length or position. **Not exhaustive and not reviewed by a teacher** |

Groups expand into ordered pairs (submitted → expected), but only where the expected character
is taught. Pairs are deduplicated across groups, and every provenance a pair came from is kept.

## Method

- **Ink:** `toInk` from the reference medians, with fixed options (jitter 0.008, wobble 0.01)
  and seeds 1–5. The same inputs give byte-identical results; tests check this.
- **Candidate set:** for a curriculum, the characters its words use that have stroke data. That
  matches `loadLevelReferences`, which learners are checked against.
- **Classification:**
  - for a look-alike: `false-acceptance` (graded Excellent or Good), `rejected-identity` (the
    engine says it's a different character) or `rejected-structure` (identity verified, but
    graded below Good)
  - for a control, the expected character written correctly: `accepted` or `false-rejection`
- **Configuration id:** the first 12 hex digits of SHA-256 over the engine version,
  `THRESHOLDS` and the scoring weights. It is currently `dcd0e02411c6`.

## Findings (synthetic ink, engine `hq-eval-1`, config `dcd0e02411c6`)

**HSK 1 Starter** (`npm run handwriting:replay -- --confusables`):

- 53 look-alike pairs: 35 of 265 trials accepted, **all with the submitted character outside
  the level's candidate set**
- 0 in-set acceptances
- 0 of 145 correct controls rejected

| #   | Expected (taught) | Written instead | In candidate set? | Accepted | Band and scores (seeds 1–5) |
| --- | ----------------- | --------------- | ----------------- | -------- | --------------------------- |
| F1  | 八                | 入              | no                | 5/5      | Good 93–94                  |
| F2  | 天                | 夫              | no                | 5/5      | Good 91–92                  |
| F3  | 天                | 犬              | no                | 5/5      | Good 84–85                  |
| F4  | 我                | 找              | no                | 5/5      | Good 87                     |
| F5  | 五                | 王              | no                | 5/5      | Good 88                     |
| F6  | 午                | 牛              | no                | 5/5      | Good 91–93                  |
| F7  | 子                | 孑              | no                | 5/5      | Good 90–91                  |

In every case the engine verifies identity as the expected character, because the written
character isn't a candidate. The structural differences lower the score, never to Excellent,
but not below the Good cut-off (72).

With the written character added to the candidate set, every one of the seven is rejected by
identity in 5 of 5 trials (tested).

**All documented groups, every character in the candidate set** (58 characters, 600 trials):

| #   | Expected | Written | In set? | Accepted                     |
| --- | -------- | ------- | ------- | ---------------------------- |
| F8  | 千       | 干      | **yes** | 1/5 (seed 1, Good, score 93) |

Neither character is in HSK 1 Starter, so no learner is affected today. It shows that identity
can fail even inside the set: the margin between 干 and 千 is small. 0 of 290 controls were
rejected.

**What these findings mean:**

- **What they show:** with the current rules, a learner at a level that teaches 八 but not 入
  could write 入 and be marked correct, in principle. The same applies to the other six.
- **What they don't show:** synthetic ink follows the reference strokes almost exactly. Real
  handwriting varies more, which can push a look-alike either way. How often this happens to
  real learners is unknown.

**Possible remedies, for the owner (none implemented; each changes how learners are graded):**

1. Add documented look-alikes to the identity candidate set, even when they aren't taught.
2. Tighten the identity distance.
3. Accept the risk for the beta and measure it in the validation study.

Each needs evidence from real samples and a decision entry. Changing thresholds or matching
also needs an `ENGINE_VERSION` bump (HANDWRITING_VALIDATION.md).

## Replay harness

```bash
npm run handwriting:replay                       # everything below
npm run handwriting:replay -- --attempts         # stored learner attempts, plus duplicates
npm run handwriting:replay -- --samples          # lab samples (add --include-tests for TEST codes)
npm run handwriting:replay -- --confusables      # confusable suite (add --content <file>)
npm run handwriting:replay -- --attempts --details   # per-attempt differences
npm run handwriting:replay -- --json             # machine-readable
```

**Historical vs current.** For each stored attempt with stroke data, the harness keeps the
original evaluation untouched. It replays with the current engine, the exercise's weights and
the level's **current** characters, and compares field by field:

- engine version, band, score
- per character: band, score, identity verified, best match, candidate count, feedback codes

| Status                   | Meaning                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `identical`              | The replay matches what was stored                                                                                                         |
| `engine-version-changed` | Stored with another `ENGINE_VERSION`; differences are expected                                                                             |
| `candidate-set-changed`  | The level's characters changed since the attempt (candidate count differs), which can change identity                                      |
| `unexplained-difference` | Same engine and candidate count, different result. **Investigate**: a weights change on the exercise, or a determinism bug                 |
| `invalid-input`          | Stroke data missing or malformed, the wrong number of drawings, a missing reference or evaluation, or the exercise no longer in any lesson |

**Determinism.**

- Each attempt is replayed twice and compared; nondeterministic replays are counted.
- The engine is pure: no clock, no randomness, and its only floating-point steps are
  deterministic in V8.
- No nondeterminism was found: 0 of 410 attempts on the local development database, and 0 in
  the tests.
- Different synthetic seeds give different ink and scores, and each seed is reproducible.

**Isolation.** Every database call goes through `readOnlyClient`. It allows only `find*`,
`count`, `aggregate` and `groupBy`, and throws on any create, update, delete, upsert, raw
statement or transaction. The integration test snapshots these before and after replay and
requires them to be identical:

- the learner's attempts (including stored evaluations and ink), character results, XP,
  mastery, review schedules and daily activity
- sync events, samples, consents, participants and the audit log

Nothing is persisted. Output goes to stdout, and contains no user ids, participant codes or
strokes.

**Duplicates.**

- `clientEventId` is unique, so a re-sent attempt returns the stored one (`duplicate: true`)
  and changes nothing. That's tested, including different ink under the same id.
- `duplicateReport` also counts same-moment groups: same learner, exercise and client time
  under different ids (possible double submissions).
- On the local development database: 631 attempts, 0 repeated ids, 0 same-moment groups.

**Configuration.** Stored attempts don't record the weights or the configuration id they were
scored with. Only the engine version and candidate counts are stored. So a later weights
change on an exercise shows up as `unexplained-difference`; the replay reports its own
`configId`. Recording the configuration id on new attempts would change the stored evaluation
format and is left for a decision.

## Held-out evaluation of lab samples

- **Split:** by participant code, `sha256(code)[0] % 3 === 0` means held out, about a third.
  It's deterministic, and **no writer can be in both sets**; `writerOverlap` is reported and
  tested to be 0.
- **Sources:**
  - human participants by default
  - `--include-tests` adds `TEST…` codes, which are rehearsal or automated samples and are
    labelled as such
  - synthetic ink is never mixed in
- **Reproducibility:** the metrics over all samples are checked to equal the lab's own
  (`reproducesLabMetrics`).
- **Privacy:** the per-participant breakdown is removed from the report because its keys are
  codes, so only counts appear.
- **Result today:** **0 human samples**, so no held-out evaluation is possible. The report says
  "NOT sufficient for validation", with reasons: fewer than 15 participants, fewer than 300
  correct and 300 incorrect samples, and an empty held-out set.

Even after the M12 pilot (5 people), the held-out third would be 1–2 writers. That's useful
for spotting gross failures, but it's not an independent validation. That needs the M13 study
with 15 or more participants.

## Limitations

- Synthetic ink isn't human handwriting. Every confusable result is about engine geometry.
- The pair groups are a documented selection, not every look-alike in Chinese. The
  engineering screen isn't teacher-reviewed.
- An import's candidate set is approximated by the file's characters. In the database, a level
  could also hold characters from earlier imports of the same curriculum.
- The lab scores samples against **every** character with stroke data, while learners are
  scored against their **level's** characters. Lab metrics and learner outcomes can therefore
  differ for look-alikes, which matters when real samples are analysed.
- The import-preview check runs synchronously, in about 3–4 s for HSK 1 Starter, in an
  admin-only server action. During that time it occupies the Node process. That's acceptable
  for occasional imports; a much larger file would need a worker.
- Replay uses the level's current characters, not those at the time of the attempt. That's why
  `candidate-set-changed` exists.

## Outstanding validation and decisions (owner)

1. Decide how to handle F1–F8: remedies 1–3 above. Each changes grading, so it needs a decision
   entry and, for thresholds or matching, `ENGINE_VERSION` and real-sample evidence.
2. Have a teacher review the engineering-screen groups and add level-appropriate look-alikes.
3. Run the M12 pilot (owner gate), then the M13 study (15 or more participants) for any
   accuracy estimate.
4. Whether new attempts should store the configuration id (a change to the evaluation format).
5. Whether the lab should also score samples against the level's candidate set, to mirror
   learners.
