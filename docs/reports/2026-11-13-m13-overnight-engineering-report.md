# Overnight engineering report — M13 diagnostics and platform audit (2026-11-13)

Branch `feature/m13-handwriting-diagnostics`, from `main` at `d712a82`. Not merged. This is the
handover for the owner's review. Status labels used throughout:

- **IMPLEMENTED AND VERIFIED:** built, tested, and the tests ran here.
- **IMPLEMENTED, NOT FULLY VERIFIED:** built, but some checks couldn't run here.
- **INVESTIGATED, NOT IMPLEMENTED:** found and analysed, with no code change.
- **BLOCKED BY ENVIRONMENT:** couldn't be run on this machine.
- **OWNER APPROVAL REQUIRED:** see the decision register, section N.
- **FUTURE RECOMMENDATION:** proposed work, not started.

No synthetic result in this report is evidence of accuracy with real learners. Every local
measurement says so; none is a production measurement.

---

## A. Executive summary

- **M13 diagnostic tooling: IMPLEMENTED AND VERIFIED.** Three parts, all diagnostic only: no
  change to grading.
  - A seeded confusable-character suite.
  - Advisory confusable diagnostics in the admin import preview and the content CLI.
  - A read-only replay harness for stored attempts and lab samples, with a participant-level
    held-out split.
- **Main finding (synthetic ink):** in HSK 1 Starter, seven look-alikes are accepted, graded
  Good 84–94, when the written character is not in the level's character set:
  - 入 for 八
  - 夫 and 犬 for 天
  - 找 for 我
  - 王 for 五
  - 牛 for 午
  - 孑 for 子

  Each is rejected once the look-alike is a candidate. One in-set weakness was also found:
  干 for 千 is accepted on 1 of 5 seeds. Fixing any of these changes grading, so they are
  **OWNER APPROVAL REQUIRED**.

- **Replay:** 410 of 410 stored attempts on the local development database replay identically.
  No nondeterminism, no duplicate client event ids. Historical evaluations are never written.
- **Held-out evaluation: not possible.** There are 0 human lab samples, and the tooling says so
  rather than producing a number.
- **Audit:** two defects found and fixed, with tests.
  - **The engine never returned on NaN or infinite coordinates.** It was latent, because every
    server entry point rejects such input. Fixed with no grading change (all 410 stored attempts
    and the synthetic baseline are unchanged).
  - **Doubled words were listed twice** on a character page (谢谢 on 谢), with React key errors.
- **Privacy:** one issue in new code was caught before commit (participant codes in the split
  report). No authorization gap, consent or erasure bypass, or secret was found.
- **Local CI:** green on every tested commit; numbers in section J. GitHub Actions remains
  **BLOCKED** by the account billing restriction.

## B. Starting state

| Item              | Value                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main` at start   | `d712a82b05dbf32be1620cff1ccbbc68ecba3bf5` (Merge PR #23, M12 erasure review), equal to `origin/main`; M12 (PR #22) and its follow-up (PR #23) included |
| Working tree      | clean                                                                                                                                                   |
| Git identity      | `AMOS-GUY <129455823+AMOS-GUY@users.noreply.github.com>` (repository-local)                                                                             |
| Baseline local CI | run `20261112T173638-ac59` on `d712a82`: **exit 0. PASS 25, FAIL 0, BLOCKED 4, NOT RUN 2**                                                              |
| Branch created    | `feature/m13-handwriting-diagnostics` from `d712a82`                                                                                                    |

**BLOCKED:** `age`, plus the three Docker steps. **NOT RUN:** Firefox (advisory) and the
report upload.

## C. M13 implementation

| Commit            | What                                             | Files                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9dffc91`         | Confusable suite; synthetic ink moved into `src` | `src/features/handwriting/confusables.ts` (new), `synthetic-ink.ts` (moved from `tests/support`, re-exported), `tests/support/handwriting-fixtures.ts`                                                                                    |
| `eb2a6df`         | Advisory import diagnostics                      | `src/features/curriculum/confusable-diagnostics.ts` (new), `src/features/administration/curriculum-actions.ts` (preview section), `scripts/content.ts` (validate, preview and import print it), `tests/e2e/admin-curriculum.spec.ts`      |
| `297d59e`         | Read-only replay harness, CLI, tests             | `src/features/handwriting/replay.ts` (new), `scripts/handwriting-replay.ts` (new, `npm run handwriting:replay`), `package.json`, `tests/unit/handwriting-diagnostics.test.ts` (new), `tests/integration/handwriting-replay.test.ts` (new) |
| `7850083`         | M13 documentation, decisions D-066 to D-069      | `docs/M13_HANDWRITING_DIAGNOSTICS.md` (new), `docs/HANDWRITING.md`, `docs/ROADMAP.md`, `docs/DECISIONS.md`, `docs/PROGRESS.md`, `CLAUDE.md`                                                                                               |
| `5e7dfb9`         | Audit fix: engine robustness on non-finite input | `src/features/handwriting/geometry.ts`, `evaluate.ts`, `tests/unit/handwriting-engine.test.ts`                                                                                                                                            |
| `12acede`         | Audit fix: word listed once on a character page  | `src/features/learning/lesson-data.ts`, `tests/unit/lesson-data.test.ts` (new)                                                                                                                                                            |
| final docs commit | This report; doc corrections; PROGRESS           | `docs/reports/…`, `docs/HANDWRITING.md`, `docs/ROADMAP.md`, `docs/PROGRESS.md`                                                                                                                                                            |

**Technical decisions:**

- **Configuration fingerprint:** SHA-256 over the engine version, `THRESHOLDS` and the weights,
  so results name exactly what produced them.
- **Pair groups carry provenance;** no universal list is invented (D-067).
- **The import check is advisory** and never blocks or changes an import (D-068).
- **Replay is read-only,** through a client that throws on any write, raw statement or
  transaction (D-066).
- **Held-out split by participant** (`sha256(code)`), reports with counts only (D-069).
- **Synthetic ink moved into `src`.** Server-side diagnostics need it; tests import it
  unchanged.
- **The import preview runs synchronously** (about 3–4 s for HSK 1 Starter). That's accepted
  for an occasional admin action, and documented.

## D. Handwriting diagnostics

Full methodology: `docs/M13_HANDWRITING_DIAGNOSTICS.md`.

- **Pairs:** 30 groups, 58 distinct characters, from three documented sources: 5 roadmap, 12 M12
  pilot look-alikes, 13 engineering screen. The engineering screen is not teacher-reviewed.
- **Trials:** seeds 1–5 with fixed ink options. Results are byte-identical across runs, and each
  case records engine version and config id `dcd0e02411c6`.

**HSK 1 Starter** (53 pairs, 265 look-alike trials, 145 controls):

- **False acceptance:** 35 of 265 trials, **all out-of-set:** F1–F7, 5/5 each, all graded Good
  84–94, never Excellent.
- **In-set false acceptance:** 0.
- **False rejection of correct controls:** 0 of 145.

**All 58 documented characters in the candidate set** (600 trials, 290 controls):

- **One in-set false acceptance (F8):** 干 written for 千, seed 1, Good 93.
- **False rejections:** 0.

**Candidate-set growth** (synthetic, local, 10 trials each):

| Candidates | Time per evaluation | Correct 你 verified |
| ---------- | ------------------- | ------------------- |
| 102        | 10 ms               | 10/10               |
| 300        | 31 ms               | 10/10               |
| 1,000      | 98 ms               | 10/10               |
| 3,000      | about 400 ms        | 3/3                 |

- **Cost:** about 0.13 ms per candidate per evaluation, roughly linear.
- **Growth reduces one risk:** a larger set rejects more look-alikes, because F1–F7 disappear
  once the look-alike is in the set.
- **It raises another:** cost grows linearly, and more near-neighbours may land inside the
  identity margin, as F8 shows.
- **Not measured:** how the in-set margin behaves at 3,000 characters. That's a
  recommendation (K-3).

**Regression tests (`tests/unit/handwriting-diagnostics.test.ts`):**

- the exact seven out-of-set findings
- in-set rejection for each of the seven
- the exact in-set F8 case
- determinism and seed sensitivity
- complete case records
- separation of false acceptance from false rejection
- deduplication
- missing references
- config id changes when the weights change

## E. Replay results

| Check                      | Result                                                                                                                                                                                                                                                                                                                                                                      | Where                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Historical vs current      | Field-by-field comparison: engine version, band, score, per-character band, score, identity, best match, candidate count, feedback codes. Statuses: identical, engine-version-changed, candidate-set-changed, unexplained-difference, invalid-input                                                                                                                         | `replay.ts`                                |
| Local development database | **410 of 410 identical**, 0 nondeterministic, 0 invalid. These attempts come from local e2e runs, so they're synthetic ink                                                                                                                                                                                                                                                  | `npm run handwriting:replay -- --attempts` |
| Determinism                | Each replay runs twice and is compared; tests replay the same input repeatedly. Different seeds give different ink, and each seed is reproducible. **No nondeterminism found**                                                                                                                                                                                              | unit and integration tests                 |
| Engine and config changes  | Simulated: an old engine version is flagged `engine-version-changed`, a grown candidate set `candidate-set-changed`, and changed weights give a different config id plus score differences                                                                                                                                                                                  | unit tests                                 |
| Malformed input            | Missing or malformed ink, the wrong number of drawings, a missing evaluation or reference: all reported as `invalid-input`, never a crash                                                                                                                                                                                                                                   | unit and integration tests                 |
| Never overwrites history   | The integration test snapshots, before and after replay: the learner's attempts (with stored evaluations and ink), character results, XP, mastery, schedules and daily activity; plus sync events, samples, consents, participants and audit entries. **They're identical**                                                                                                 | `handwriting-replay.test.ts`               |
| Duplicate synchronization  | A re-sent attempt (same `clientEventId`, even with different ink) returns the stored attempt and changes nothing. The sync service rejects event ids owned by another user, and lesson-completion XP is keyed per learner and lesson, so retries can't double it                                                                                                            | tests; code review                         |
| Held-out split             | By participant, so **no writer is in both sets** (`writerOverlap` 0, tested). `TEST` codes are excluded unless asked for and are labelled. Reports metrics equal to the lab's own. **Today: 0 human samples, "NOT sufficient for validation".** After the 5-person pilot, the held-out third would be 1–2 writers: gross-failure checks only, not an independent validation | `handwriting:replay -- --samples`          |

**Limitations:**

- **Configuration history:** stored attempts don't record the weights or config id they were
  scored with, so a weights change shows up as `unexplained-difference`.
- **Current candidate sets:** replay uses the level's characters as they are now, not as they
  were when the attempt was made.

## F. Platform-wide audit

**How I worked:** I mapped the code by reading it, then probed the risky areas.

- **Probes:** the engine, sync, authorization, content and responsiveness, using scratch
  scripts, the replay harness, the browser and the existing tests.
- **Skipped:** areas the existing e2e suite already covers well were not re-tested by hand,
  and are marked as such.

### Architecture map (as implemented)

1. **Curriculum:** `content/*.json` → validator (plus the source register) → importer → tables:
   Curriculum → HSKLevel → Unit → Lesson; Character, Vocabulary and their link tables; exercises
   generated per lesson. Learners see a lesson only if both it and its curriculum are published
   (`LEARNER_VISIBLE_LESSON`).
2. **Candidate sets:** `loadLevelReferences(levelId)` gives the characters with stroke data
   linked to any lesson in that level, cached in memory for a short time. The lab uses **all**
   characters with stroke data instead (`loadAllReferences`).
3. **Capture:** `HandwritingCanvas`, an `aspect-square` canvas. Pointer events give coordinates
   normalised by width and height, clamped to −0.2 to 1.2. A pen suppresses palm touches.
   Coordinates are validated `finite`, within −0.25 to 1.25.
4. **Evaluation:** the pure `evaluateCharacter`:
   - normalises by bounding box with one uniform scale
   - resamples to 16 points per stroke
   - aligns strokes (Hungarian assignment)
   - identity: the nearest candidate within the margin, and the distance limit
   - order, direction and shape dimensions, then bands, with technique faults capped at Good

   It runs on the server for scoring, and in the browser for instant feedback
   (`practice-runner.tsx`).

5. **Progress:** `submitAttempt` runs in one transaction under a per-learner advisory lock.
   XP keys make awards idempotent. Mastery and the SM-2-style SRS are replayed from
   `AttemptCharacterResult`.
6. **Offline:** Dexie (IndexedDB, schema v1) holds the outbox, lesson packages and metadata.
   `/api/sync` processes batches idempotently (`SyncEvent` by event id, and `clientEventId` on
   attempts). Data is kept per account; that's covered by e2e.
7. **Admin:** server actions with `assertPermission`, rate-limited, audited.
   `AdminForm` keeps the user's input when the server returns errors.
8. **Lab and M12:** consent, erasure, ledger and restore gate, as documented in
   M12_ERASURE_REVIEW.md.
9. **Diagnostics:** M13, this report.

### Findings

| #    | Area           | Finding                                                                                                                                                                                                                                                                                                                     | Severity                                      | Action                                                                         | Status                                                                                                               |
| ---- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| F-1  | Engine         | `evaluateCharacter` **never returned** with a NaN or infinite coordinate. The Hungarian loop couldn't pick a column. Every server entry point rejects such input, so it was latent                                                                                                                                          | MEDIUM                                        | FIX NOW                                                                        | **IMPLEMENTED AND VERIFIED** (`5e7dfb9`): no grading change, 410/410 replays identical, synthetic baseline identical |
| F-2  | Learner UI     | A character page listed a word once per position (谢谢 twice on 谢), causing duplicate React keys                                                                                                                                                                                                                           | LOW                                           | FIX NOW                                                                        | **IMPLEMENTED AND VERIFIED** (`12acede`), checked in the browser                                                     |
| F-3  | Engine         | Seven out-of-set look-alikes accepted in HSK 1 Starter (F1–F7)                                                                                                                                                                                                                                                              | HIGH (learning integrity, synthetic evidence) | OWNER DECISION REQUIRED (D1)                                                   | Documented, regression-pinned                                                                                        |
| F-4  | Engine         | In-set look-alike 干→千 accepted on 1 of 5 seeds (F8)                                                                                                                                                                                                                                                                       | MEDIUM                                        | OWNER DECISION REQUIRED and EXTERNAL VALIDATION                                | Documented, pinned                                                                                                   |
| F-5  | Engine and lab | The lab scores samples against **all** characters with stroke data, learners against their **level's** set. For look-alikes, lab metrics may overstate what learners experience                                                                                                                                             | MEDIUM                                        | OWNER DECISION REQUIRED (D5)                                                   | Documented                                                                                                           |
| F-6  | Performance    | Evaluation cost is linear in candidates: about 10 ms at 102 characters, about 400 ms at 3,000 (local). The lab page re-scores **every** sample against **every** character on each load. A 600-sample study at today's set would take an estimated 6 s per page view, rising with the curriculum (projection, not measured) | MEDIUM                                        | FIX IN FUTURE MILESTONE (P2)                                                   | Investigated                                                                                                         |
| F-7  | Performance    | The import-preview confusable check is about 3–4 s of synchronous CPU in a server action                                                                                                                                                                                                                                    | LOW                                           | ACCEPTED LIMITATION (admin-only); worker if files grow                         | Documented                                                                                                           |
| F-8  | Engine         | Aspect distortion: a non-square box (x squeezed to 0.6) costs about 5 points and one band. The canvas is CSS `aspect-square`, so this only applies if that CSS fails                                                                                                                                                        | INFORMATIONAL                                 | ACCEPTED LIMITATION                                                            | Investigated                                                                                                         |
| F-9  | Engine         | Invariant to writing size, speed and coordinates beyond the box (probed). Degenerate input (single points, a scribble of 40 tiny strokes) is rejected cleanly                                                                                                                                                               | INFORMATIONAL                                 | —                                                                              | Verified (probe)                                                                                                     |
| F-10 | Sync           | If a "lesson complete" event fails after completion but before it's marked processed, the retry creates one extra empty learning session. XP isn't duplicated (keyed award)                                                                                                                                                 | LOW                                           | FIX IN FUTURE MILESTONE                                                        | Investigated                                                                                                         |
| F-11 | Authorization  | Every route handler and server action checks permission or the signed-in user on the server. Object-level checks exist on sessions, lesson downloads and attempts (event id ownership). `/api/characters/[hanzi]` is public by design (openly licensed stroke data), rate-limited                                           | INFORMATIONAL                                 | —                                                                              | Code review                                                                                                          |
| F-12 | Accessibility  | Mobile header text links ("Feedback", "Admin", "Join the beta") are 20 px tall. They meet WCAG 2.5.8 through the spacing exception (16 px gap) but are small for touch                                                                                                                                                      | LOW                                           | FIX IN FUTURE MILESTONE                                                        | Investigated                                                                                                         |
| F-13 | Responsive     | No horizontal overflow at 375 px on /home, /learn, /progress, /review, /admin/handwriting, /admin/import (browser check). The app refuses framing (`frame-ancestors 'none'`), which is correct                                                                                                                              | INFORMATIONAL                                 | —                                                                              | Verified (browser)                                                                                                   |
| F-14 | Curriculum     | 0 errors, 3 known warnings. Every lesson has all four exercise types; no duplicate exercise keys; no listening exercises (no audio, by design); 0 traditional forms on 102 characters and 81 words; only 3 characters list alternative readings                                                                             | LOW (product gap)                             | OWNER DECISION and teacher review                                              | Investigated                                                                                                         |
| F-15 | Docs           | HANDWRITING.md said "at least 10 testers … retune", against the validation rules (15 participants, `MIN_SAMPLES`); its "similar pairs: all distinguished" needed the in-set qualifier; ROADMAP's status table predates M12 and M14                                                                                          | LOW                                           | FIX NOW                                                                        | **Corrected with dated notes**                                                                                       |
| F-16 | Privacy        | New code: the held-out report would have included participant codes (in the per-participant breakdown). Caught by a test before commit                                                                                                                                                                                      | MEDIUM (if shipped)                           | FIX NOW                                                                        | **Fixed before commit; guarded by a test**                                                                           |
| F-17 | Data           | The local development database holds many left-over e2e curricula (drafts and archived). That's only noise in local reports and replay statistics                                                                                                                                                                           | INFORMATIONAL                                 | ACCEPTED (local only)                                                          | —                                                                                                                    |
| F-18 | Performance    | Client JS across all routes: 1.58 MB raw, 478 KB gzipped (local build). The largest chunk is 234 KB; hanzi-writer is in its own 57 KB chunk. Next 16 no longer prints per-route first-load sizes                                                                                                                            | INFORMATIONAL                                 | FUTURE (measure per route with a bundle analyzer, without adding a dependency) | Measured locally                                                                                                     |

**Audit areas and how far each went:**

- **4.1 Learning experience:**
  - **Covered by existing e2e** (passing in local CI): registration, onboarding, learning a full
    lesson by writing, locked lessons, stroke-order player, offline practice and sync, account
    isolation, password reset, session security, the keyboard flow on results, small and
    narrow phones.
  - **Checked here:** responsive spot checks and console errors, which found F-2.
  - **Not done:** a full manual UX walkthrough of every screen; a screen-reader pass; real
    devices. Those are BLOCKED BY ENVIRONMENT or not performed.
- **4.2 Engine:** probes F-1, F-8, F-9 and the scaling table (section D).
- **4.3 Offline and sync:**
  - Reviewed: `sync-service.ts` (idempotency, other users' event ids, unexpected errors left
    for retry), the duplicate-attempt path (tested), and the account isolation e2e.
  - Not done: a multi-tab race test beyond the existing `skipDuplicates` handling;
    service-worker cache invalidation on a real device.
- **4.4 Authentication and authorization:** F-11. Suspension, password change and API
  anonymous or cross-site refusal are covered by e2e.
- **4.5 Database:**
  - No migrations in M13.
  - Every write to samples, consent, participants and the gate lives only in `participants.ts`
    and `samples.ts` (grep).
  - Potential N+1: replay's per-character fallback lookup is cached per run, so it's fine.
    Lab recording reloads every reference on each sample (F-6).
- **4.6 Curriculum:** F-14. No HSK membership claims; provenance unchanged.
- **4.7 Accessibility:**
  - Automated axe checks on learner and admin pages, light and dark, pass in the existing e2e.
  - Here: F-12, plus the new UI text is plain and in reading order.
  - Not done: screen readers, contrast beyond axe, real touch devices.
- **4.8 Performance:** F-6, F-7, F-18. All local measurements on one Windows machine; not
  production numbers.
- **4.9 Security and privacy:** section G.

## G. Security and privacy

- **Confirmed problems fixed:**
  - F-16 (new code, before commit)
  - F-1 (a latent denial-of-service if a future caller skipped validation)
- **Confirmed problems open:** none found.
- **Checked, no issue:**
  - every write path for samples, consent, participants and the gate goes through the consent
    check and the erasure path
  - replay can't write (enforced at run time and tested)
  - diagnostic output has no user ids, participant codes or ink
  - the new CLI writes no files
  - the import diagnostics use no database and sit behind `content:import`
  - erased samples drop out of replay and analysis (they're deleted)
- **Accepted limitations, documented elsewhere:**
  - backups hold erased samples until they expire
  - feedback is not erased (paper-only for the pilot)
  - the admin export (`?strokes=1`) contains participant codes and ink by design, for
    `handwriting:validate` holders only, with `no-store`
- **Public repository:** this report contains no secrets, participant data or private
  configuration details. The full secret scan of all history, re-run tonight, found only the
  two known synthetic test fixtures.

## H. Performance

- **Environment:** Windows 11, Node 24.18, local PostgreSQL 18.6 on port 5433, `tsx`.
- **Numbers:** the scaling table (section D); the import check takes about 3–4 s for HSK 1
  Starter (measured as the whole `content:validate` run); bundle sizes are in F-18.
- **Caveats:** single machine, no warm-up control, dev and test builds, synthetic workloads.
  **No production performance claim is made.**

## I. Accessibility

- **Automated:** the existing axe-core e2e (`accessibility.spec.ts`, learner and admin pages,
  light and dark) passes in local CI on every tested commit.
- **Manual:** responsive checks at 375 px (F-13), target sizes (F-12).
- **Not performed:** screen-reader testing (NVDA, VoiceOver), reduced-motion review beyond the
  existing CSS, real touch devices, Firefox. Firefox is BLOCKED locally: it's not installed and
  is advisory in CI.

## J. Test evidence

Local CI (`npm run ci:local`, Windows with PostgreSQL 18.6, **not GitHub CI**):

| Commit                            | Run                    | Exit | PASS | FAIL | BLOCKED | NOT RUN | Tests                                                                    |
| --------------------------------- | ---------------------- | ---- | ---- | ---- | ------- | ------- | ------------------------------------------------------------------------ |
| `d712a82` (baseline, `main`)      | `20261112T173638-ac59` | 0    | 25   | 0    | 4       | 2       | —                                                                        |
| `7850083` (M13 code and docs)     | `20261112T180316-0493` | 0    | 25   | 0    | 4       | 2       | integration 126; e2e 36 passed                                           |
| `4ba3ea7` (final code and report) | `20261112T183909-28ec` | 0    | 25   | 0    | 4       | 2       | unit 235; integration 126; e2e 36 passed; backup drill all checks passed |

- **BLOCKED every run:**
  - `age` is not installed, so the backup encryption round trip can't run
  - Docker is not installed, so the image build, container start and container refusal steps
    can't run; their no-Docker equivalents (23L, 24L) pass
- **NOT RUN every run:**
  - Firefox e2e (advisory, needs `--with-firefox` and an installed browser)
  - Playwright report upload (no artifact store locally)
- **GitHub Actions: BLOCKED** by the account billing restriction. No GitHub job ran on these
  commits.

**Targeted runs during the work** (all passing at the time):

- `tests/unit/handwriting-diagnostics.test.ts`: 32
- `tests/unit/handwriting-engine.test.ts`, `handwriting-validation.test.ts` and diagnostics
  together: 60
- `tests/unit/lesson-data.test.ts`: 2
- `tests/integration/handwriting-replay.test.ts`: 4
- `tests/e2e/admin-curriculum.spec.ts` (desktop): 2
- `npm run handwriting:replay`: 410/410 identical
- synthetic baseline report: identical numbers to `docs/handwriting-baseline-synthetic.md`
  after F-1

**Test architecture notes:**

- **Strong areas:** authorization, progress idempotency, M12 erasure, backup and restore
  drills, offline account isolation.
- **Weak areas:**
  - no automated multi-tab sync race test
  - no real-device input tests
  - no load or performance regression tests
  - the confusable suite pins current behaviour, so a deliberate engine change must update the
    pinned findings, with a decision entry (by design)
- **Flakiness:** the full `--fresh` local run once hit a Windows console error
  (`0xC0000142`, LOCAL_CI.md); no flaky test was seen tonight.

## K. Technical debt (prioritised)

1. **Identity depends on the candidate set (F-3, F-4).** It's the engine's most important
   weakness: it can only reject characters it knows.
2. **Lab vs learner candidate sets differ (F-5).** This must be settled before real samples are
   analysed.
3. **Linear evaluation cost (F-6).** Precomputing prepared references per level and caching the
   lab metrics would fix it without changing scores. Needed before HSK 2+ growth.
4. **Stored attempts lack the config id**, so replay can't tell a weights change from a bug.
5. **The import preview check is synchronous (F-7).**
6. **Leftover columns:** `ErasureLedgerGate.clearedWithoutLedger` and `clearanceReason` are
   unused and await a contract migration (D-062), as does the legacy `HandwritingSample.notes`.
7. **Content gaps:** no traditional forms, no example sentences, no audio (F-14).
8. **An extra empty session on retried lesson-complete sync (F-10).**
9. **Small mobile header links (F-12).**

## L. Product recommendations (assumptions marked)

- **Before more users:** decide F1–F8. A learner's trust drops sharply if a clearly wrong
  character is praised. (Assumption: real writers produce these look-alikes often enough to
  matter; the M12 pilot and the M13 study will tell.)
- **Engagement:** use the replay and confusable tooling to show learners a "commonly confused
  with …" hint after a near-miss. That's a product change, so a proposal only.
- **Curriculum:**
  - a teacher review of HSK 1 Starter (readings, glosses, the 3 warnings)
  - example sentences (the format exists)
  - a decision on traditional characters
- **Premature until human validation:**
  - any accuracy claim
  - threshold tuning
  - paid subscriptions that sell handwriting feedback quality
  - classroom or teacher dashboards that rank learners by handwriting scores
- **Before paid subscriptions:** handwriting validation, legal review, billing provider
  choice, refund and data policies. None of this exists yet; not implemented.
- **Before classrooms or social features:** a data-sharing and consent model for minors, role
  scoping (teacher vs admin), and moderation. Not started.

## M. Proposed next three milestones (for owner review)

The approved order puts M15 next, and M16 needs beta data. The proposal keeps that order and
adds a prerequisite for curriculum growth, based on tonight's findings.

### Proposal 1 — M15: learning measurement and onboarding (approved next)

- **Objective:** measure activation, return, review completion and recall rate from first-party
  data.
- **User problem:** we can't tell whether learners learn or come back.
- **Functionality:**
  - metric services and an admin page (cohorts, review completion, recall at the due date)
  - an onboarding walkthrough pass
- **Technical:** read-only queries over attempts, sessions, schedules and daily activity;
  aggregated tables only if needed (expand-only).
- **Dependencies:** none local. Meaningful numbers need beta learners.
- **Database:** possibly aggregate tables (additive).
- **Security and privacy:** aggregates only, minimum-cohort sizes, no learner-level exports.
- **Testing:** fixtures with known answers; privacy tests (no small cohorts).
- **Complexity:** medium (5–7 days).
- **Risks:** misleading metrics on tiny cohorts.
- **Out of scope:** third-party analytics, email or push, A/B testing.

### Proposal 2 — Scoring scale and candidate policy (prerequisite for HSK 2+ content; new)

- **Objective:** make identity checking robust as the curriculum grows, **without changing
  grades until the owner decides D1 and D5**.
- **User problem:** wrong characters accepted (F1–F8); evaluation cost growing with the
  curriculum (F-6).
- **Functionality:**
  - precomputed per-level references and a lab metrics cache (no score change)
  - store the config id on new attempts
  - after D1: an implementation of the chosen look-alike policy behind a new `ENGINE_VERSION`,
    with before and after replay
- **Dependencies:** D1 and D5; for any threshold change, real samples (the M13 study).
- **Database:** one additive field on attempt evaluations (JSON) or a column; no destructive
  change.
- **Security and privacy:** none new.
- **Testing:**
  - replay must show 100 % identical for the performance work
  - the confusable suite before and after for the policy change
  - the engine sweep
- **Complexity:** medium (4–6 days, excluding the study).
- **Risks:** a policy change that rejects correct writing (false rejection), mitigated by the
  controls and the replay.
- **Out of scope:** threshold tuning without samples; model-based recognition.

### Proposal 3 — M17: beta readiness and operations (owner-driven)

- **Objective:** remove the blockers to the first invites.
- **User problem:** the app can't be opened to testers safely yet.
- **Functionality:**
  - GitHub Actions restored (billing)
  - staging provisioned under the M11 design
  - environment protections set
  - legal review of the privacy notice and terms
  - backup retention and the erasure window set
  - the password-reset decision
  - a real-device and Firefox pass
- **Dependencies:** owner actions, possibly spending; nothing for the engineer to start alone.
- **Database:** none.
- **Security and privacy:** the main risk is operational. M11 and M12 prepared the controls.
- **Testing:** the staging acceptance suite; the first real `backup.yml` run.
- **Complexity:** low engineering, high coordination.
- **Risks:** blocked on billing, legal and time.
- **Out of scope:** paid plans, classrooms, social features.

After these: M16 (SRS calibration), which needs weeks of beta data, and M14-b (review queue,
edition labels, the teacher review).

## N. Owner decision register

| #   | Decision                                       | Context                                                                                | Options                                                                                                                       | Recommendation                                                                       | Consequences                                         | Urgency                                  | Blocks                 |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------- | ---------------------- |
| D1  | Look-alikes outside the candidate set (F1–F7)  | Synthetic evidence: 7 accepted in HSK 1 Starter                                        | (a) add documented look-alikes as identity candidates; (b) tighten the identity distance; (c) accept and measure in the study | (a), behind a new `ENGINE_VERSION`, after the pilot confirms the pattern on real ink | Changes grading; needs a decision entry and a replay | High before broader beta                 | Proposal 2 policy work |
| D2  | In-set look-alike 干→千 (F8)                   | 1/5 seeds; not in HSK 1                                                                | Investigate the margin in the study; or no action until HSK 2 content                                                         | Investigate in the M13 study                                                         | None now                                             | Low                                      | —                      |
| D3  | Teacher review of the confusable groups        | The engineering screen isn't reviewed                                                  | Teacher reviews, adds level-appropriate pairs                                                                                 | Yes, with the HSK 1 Starter review                                                   | Better coverage                                      | Medium                                   | —                      |
| D4  | Store the config id on new attempts            | Replay can't attribute weights changes                                                 | Add it (evaluation format change) or not                                                                                      | Add it in Proposal 2                                                                 | Additive                                             | Low                                      | Proposal 2             |
| D5  | Lab candidate set                              | Lab uses all characters; learners use their level                                      | Lab mirrors the level, or reports both                                                                                        | Report both (lab and level view)                                                     | Changes lab metrics, not grading                     | Medium, before real samples are analysed | Pilot analysis         |
| D6  | Approve the M12 consent form and run the pilot | Still a draft; the app refuses real codes                                              | Approve, change, or postpone                                                                                                  | Approve after legal or ethics check                                                  | Enables real evidence                                | High for M13 validation                  | All accuracy work      |
| D7  | Backup retention and the erasure window        | Needed for honest erasure promises                                                     | Set the period                                                                                                                | Set it before the pilot                                                              | Erasure completeness                                 | High before the pilot                    | Pilot consent text     |
| D8  | GitHub Actions billing                         | Account restriction                                                                    | Resolve billing, or keep local CI                                                                                             | Resolve it (no spending was made here)                                               | Real Ubuntu, PG 17 and Docker checks                 | Medium                                   | CI of record           |
| D9  | Repository settings                            | Environment protection, fork-run approval, secret scanning (docs/PUBLIC_REPOSITORY.md) | Apply or not                                                                                                                  | Apply                                                                                | Safer public repo                                    | Medium                                   | —                      |
| D10 | Traditional characters                         | 0 traditional forms                                                                    | Support, defer, or simplified only                                                                                            | Decide the audience first                                                            | Content work                                         | Low                                      | —                      |
| D11 | Mobile header target size (F-12)               | Passes 2.5.8 via spacing                                                               | Enlarge to 44 px, or keep                                                                                                     | Enlarge in the next UI pass                                                          | Slight header height change                          | Low                                      | —                      |
| D12 | Next milestone order                           | Section M                                                                              | Approve, reorder, change                                                                                                      | Approve M15, then Proposal 2                                                         | Plan                                                 | Medium                                   | Next branch            |

## O. Outstanding work

- **Not done, out of scope or not authorised:**
  - the dispute route, the technique-cap decision and tuning (M13 scope needing real samples
    and a teacher)
  - any scoring change (D1, D2, D5)
- **Not done, environment:**
  - Docker and `age` steps
  - Firefox
  - GitHub Actions (billing)
  - screen readers and real devices
- **Not done, time or priority:**
  - a full manual UX walkthrough of every screen
  - a multi-tab sync race test
  - a per-route bundle analysis
- **Not done, no access:** a PR can't be opened from this machine (no `gh`, no GitHub sign-in
  in the browser). The branch is pushed, and the PR text is prepared.

## P. Reproduction guide

```bash
git fetch origin && git checkout feature/m13-handwriting-diagnostics
npm install
npm run db:local                              # keep running (local PostgreSQL on :5433)
npm run content:validate                      # includes the advisory confusable check
npm run handwriting:replay -- --confusables   # F1–F7 table (synthetic)
npm run handwriting:replay                    # attempts, duplicates, held-out split (read-only)
npm run handwriting:replay -- --attempts --details --json
npx vitest run tests/unit/handwriting-diagnostics.test.ts tests/unit/handwriting-engine.test.ts
npx vitest run --config vitest.integration.config.mts tests/integration/handwriting-replay.test.ts
npm run handwriting:report -- --synthetic     # compare with docs/handwriting-baseline-synthetic.md
npm run ci:local                              # full local CI (not GitHub CI)
```

**Final state:** final code commit `4ba3ea770bd75b0845516404481a3fea21d9d053`; local CI run
`20261112T183909-28ec` (exit 0). The commit after it only records these numbers in this report. Compare:
https://github.com/AMOS-GUY/HanziQuest/compare/main...feature/m13-handwriting-diagnostics
