# Roadmap after M11 and local CI (proposed 2026-11-12, for owner review)

**Status: proposal. Nothing here is approved or started.** Priorities: product quality and
learning effectiveness first; infrastructure only where a beta needs it.

## Where things stand

| Area                  | Built                                                                                   | Missing                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Handwriting engine    | `hq-eval-1`; lab, consent, metrics, export, report; synthetic baseline                  | **0 real samples.** Accuracy for real learners is unknown. The validation procedure needs ≥ 15 participants before any tuning |
| False positives       | Wrong character = TRY_AGAIN; technique faults capped at Good                            | Measured only on synthetic ink. Learners have no "this was marked wrong" route                                                |
| Curriculum            | HSK 1 Starter: 6 units, 16 lessons, 102 characters, 81 words; provenance rules enforced | Everything PROVISIONAL; no teacher review, no examples, no audio; 3 validator warnings; no HSK 2/3; HSK 3.0 not modelled      |
| Review and mastery    | SM-2-style SRS, replayed from history; recall vs technique policy; placement            | No evidence that intervals fit real learners; no recall-rate measurement                                                      |
| Onboarding, retention | Onboarding and placement flows; "active in the last 7 days" count                       | No activation, return or review-completion metrics                                                                            |
| Beta launch           | Invite-only, legal drafts, staging design, local CI                                     | Legal review, age, retention periods, reset decision, staging, devices and Firefox, GitHub CI after 2026-12-01                |

**Important constraint:** five testers give about 180 samples (5 × 36). That's a pilot: enough to
find gross failures and broken prompts. It is **not** enough to change thresholds. The minimum
before tuning is 15 participants and 300 correct plus 300 incorrect samples
(HANDWRITING_VALIDATION.md). The roadmap keeps those as separate steps.

## Proposed order

```
M12 Handwriting pilot (5)  ─┬─> M13 Accuracy and false positives (needs 15+ for tuning)
M14 Curriculum provenance  ─┤      (teacher sourcing runs in parallel from day 1)
M15 Learning measurement   ─┴─> M16 Scheduling and mastery calibration (needs beta data)
M17 Beta launch blockers   ──── runs alongside; gates the first invites
```

Recommended next: **M12**, preceded by the one decision it needs: where the pilot runs.

---

## M12 — Handwriting pilot with 5 consenting testers

- **Objective.** Real handwriting evidence for the first time: find gross failures (devices,
  sizes, characters, prompts) before inviting learners. No accuracy claims, no threshold changes.
- **Scope.**
  - Decide where to run it:
    - (a) **local**: on the owner's laptop, with phones and tablets on the same Wi-Fi. This needs a
      reviewed, time-boxed "LAN pilot" mode: bound to the private network, invite-only, a fresh
      local pilot database, turned off after.
    - (b) **staging**, once M11 provisioning is approved.

    Recommendation: (b) if staging is approved within about two weeks, otherwise (a).

  - Pilot rehearsal with `TEST` codes on every device class. Check the recorder at small screen
    sizes, with a stylus and with a trackpad.
  - Data handling: samples stay on the chosen database. Export and back it up after each
    session. Write down how a tester can have their samples deleted, and test it.
  - Run P01–P05 (owner, about 25 minutes each). Write `docs/handwriting-pilot-YYYY-MM-DD.md` with
    the report, the per-device and per-size breakdown, tester comments, and a list of findings,
    each classified as an engine, prompt, UX or device issue.
- **Dependencies.**
  - The owner recruits 5 testers with the planned mix: at least 2 phones, 1 stylus, 1 laptop, at
    least 2 beginners.
  - The location decision (a or b).
  - The owner decides whether spoken consent is enough or a written form is needed
    (LEGAL_REVIEW item 4).
  - The consent text is an unreviewed draft. Get review first if the owner's jurisdiction requires
    it for research with people.
- **Risks.**
  - A LAN mode widens exposure; it must be explicit, off by default and never used in production.
  - Too few testers or devices to be meaningful.
  - Testers aren't anonymous to the operator; keep the code-to-person mapping outside the app.
  - Over-reading 180 samples.
- **Estimated effort.** Development 2–4 days (rehearsal, LAN mode if chosen, deletion check,
  report template). Owner: recruiting plus about 3 hours of sessions.
- **Acceptance criteria.**
  - 5 participants × 36 samples recorded with consent ticked, on at least 3 device classes.
  - Zero `TEST` samples in the results.
  - The report is saved and records FRR, structural false acceptance and wrong-character
    acceptance with sample counts, labelled "pilot, n = 5".
  - A sample deletion was exercised.
  - Thresholds and `ENGINE_VERSION` are unchanged.
  - Every finding has an owner decision: fix now, M13, or won't fix.

## M13 — Evaluation accuracy and false-positive handling

- **Objective.** Measure and, only with enough evidence, improve accuracy, with the emphasis on
  false acceptance: a wrong character accepted damages learning more than a correct one rejected.
- **Scope.**
  - **Offline replay harness:** score candidate thresholds against all stored samples, with a
    fixed participant-level held-out third. Report per device and size, and fail on any target
    regression.
  - **Confusable-pair suite:** pairs such as 他/她, 人/八/入, 日/目/白, 土/士, 己/已/巳, in synthetic and
    real ink. It must keep working as the candidate set grows: adding HSK 2/3 characters changes
    identity checking, so every content import re-runs it.
  - **Learner route for disputes:** "I think this was marked wrong" on a result. It stores the
    attempt as a disputed sample, but only with the learner's explicit consent. Disputes are
    reviewed in the lab and never change the learner's progress automatically.
  - **Technique-cap decision:** should a reversed stroke or wrong order still count as recall?
    The owner decides with a teacher; implemented as a scoring-policy change (D-entry), not a
    threshold change.
  - **Tuning,** only when the minimum sample size is reached: follow the six rules in
    HANDWRITING_VALIDATION.md and bump `ENGINE_VERSION`.
- **Dependencies.**
  - M12 findings.
  - At least 15 participants for any tuning; another 10 or more after the pilot. This may happen
    during the invite-only beta, with consent.
  - A teacher for the technique policy.
- **Risks.**
  - Overfitting to a few writers; the held-out split and device breakdown mitigate it.
  - The dispute route becomes a way to game progress. It must never grant progress.
  - Privacy of disputed ink; consent is per sample.
  - Candidate-set growth silently raises wrong-character acceptance.
- **Estimated effort.** 5–8 development days for the harness, confusable suite and dispute
  route; tuning 2–3 days once data exists.
- **Acceptance criteria.**
  - The harness reproduces the lab metrics exactly for `hq-eval-1`.
  - The confusable suite runs in CI and on every content import.
  - Disputes are stored only with consent, audited, and have no effect on progress.
  - Any engine change shows before and after on the held-out set and meets all targets:
    FRR ≤ 10 %, structural false acceptance ≤ 2 %, wrong-character acceptance ≤ 1 %, specific
    error named ≥ 80 %.
  - Otherwise thresholds stay unchanged and the reason is written down.

## M14 — Curriculum accuracy and HSK 2.0 / 3.0 provenance

- **Objective.** Content a teacher has checked and whose origin is recorded, plus a model that
  can express both HSK editions, before the curriculum grows.
- **Scope.**
  - **Teacher review of HSK 1 Starter:** characters, pinyin and tones, glosses, traditional
    forms and stroke data, using the existing review states. Fix the 3 validator warnings,
    including the 朋/友 gloss and the two 9-character lessons. Content moves PROVISIONAL →
    REVIEWED only through the admin workflow, with an audit entry.
  - **Edition model:** tag words and characters with their level per standard, HSK 2.0 level
    and HSK 3.0 (2021) band and level. Curricula declare which edition they follow, and the UI
    never mixes them or calls one "official". HSK 3.0 Level 1 is substantially larger than HSK
    2.0 Level 1 and has its own handwriting list; check the exact counts against the official
    standard when sourcing.
  - **Example sentences:** extend the content format, written by the team or the teacher, or
    taken from a licensed source, with provenance recorded per sentence.
  - **Source register:** a table of every external list or dictionary, with its licence and
    the date it was obtained. The importer refuses content that cites a source not in the
    register.
  - **The remaining 70 HSK 2.0 Level 1 words,** only once a licensed list is in hand.
- **Dependencies.**
  - The owner obtains the HSK lists from a source they may use and records the licence.
  - The owner engages a qualified teacher; this may need payment, which is the owner's decision.
  - Audio is out of scope until a licensed or recorded source exists.
- **Risks.**
  - **Licensing:** no list or dictionary data enters the repository without a recorded licence.
  - **Teacher availability** dominates the timeline.
  - **The edition choice** changes the learner path; decide HSK 2.0 vs 3.0 for new learners
    before writing HSK 2 content.
  - **Growth affects handwriting identity** (see M13).
- **Estimated effort.**
  - Development: 4–6 days for the edition model, example field, source register and admin
    review screens.
  - Content: teacher time, about 1–2 days for HSK 1 Starter.
- **Acceptance criteria.**
  - HSK 1 Starter is REVIEWED by a named reviewer (role only in the docs), with 0 validator
    warnings.
  - Every item records its source and licence.
  - The importer rejects unregistered sources and any VERIFIED label without a licence.
  - The edition is shown to learners, and nothing is labelled official unless VERIFIED.
  - `content:preview` shows no downgrade of reviewed data.

## M15 — Onboarding, retention and learning measurement (first-party, privacy-preserving)

- **Objective.** Know whether learners get started, come back and actually remember, so M16 can
  calibrate on evidence rather than guesses.
- **Scope.**
  - **Metrics from data already stored** (attempts, reviews, sessions); no third-party
    analytics, no new tracking scripts (CSP rules):
    - activation: first lesson completed within 24 h of signing up
    - D1, D7 and D30 return
    - due-review completion
    - **recall success on due reviews by interval bucket** (the core effectiveness measure)
    - lapse rate
    - time to FAMILIAR and to MASTERED
    - placement accuracy (tested-out characters later failed)
  - **Admin page** with aggregates only, a minimum cohort size (for example 5) before anything is
    shown, and no per-learner drill-down beyond what staff can already see.
  - **Onboarding review:** walk the first-run path on phone and desktop. Find where people stop
    (signing up → goal → placement → first lesson → first review). Fix friction: copy, the
    length of placement, an empty review state, a clear "come back tomorrow" message.
  - **Retention aids that need no new infrastructure:** the next-review time on the home page,
    a daily-goal streak with a gentle grace day, an optional offline-friendly reminder in the
    app. No email or push notifications until the owner approves a provider.
  - The privacy notice gets a sentence on these aggregate learning statistics. Bump
    `LEGAL_VERSION` only if this is material.
- **Dependencies.**
  - Nothing external to build it.
  - Meaningful numbers need beta learners (M17).
  - Legal wording reviewed with the M17 legal pass.
- **Risks.**
  - Small numbers mislead: show n everywhere, suppress small cohorts.
  - Scope creep into tracking.
  - Streak mechanics that pressure people, against the app's accessibility and calm-UX
    principles.
- **Estimated effort.** 5–7 development days.
- **Acceptance criteria.**
  - Every metric is computed in a `features/*` service from stored data, with unit tests on
    fixtures and integration tests on the local database.
  - Cohorts below the minimum are suppressed.
  - No new third-party requests (CSP unchanged).
  - The first-run path has been walked end to end on phone and desktop, with its findings fixed
    or logged.
  - Recall by interval bucket can be produced for a cohort.

## M16 — Review scheduling and mastery calibration

- **Objective.** Show, and if needed adjust, that the schedule keeps recall in a sensible band
  (for example 80–90 % on due reviews) without too many reviews, and that "MASTERED" means the
  learner reliably remembers.
- **Scope.**
  - **Simulation harness:** synthetic learners with configurable forgetting, run through the real
    `SRS` functions to show review load and predicted recall per rule set. It runs in tests.
  - **Calibration on beta data from M15:**
    - observed recall per interval bucket, compared with the target band
    - lapse patterns
    - the effect of the technique-fault rule (hard pass, 1.2× growth)
    - whether MASTERED characters are still recalled 30 days or more later
  - **Changes:** made only to the `SRS` constants or rules, with a D-entry. Mastery is replayed
    from history (`npm` replay), so a change applies consistently and can be reversed.
  - Placement retest policy: whether tested-out characters ever enter review.
- **Dependencies.**
  - M15 metrics.
  - At least several weeks of beta usage across enough learners; set a minimum before tuning,
    as with handwriting.
  - The M13 technique-policy decision.
- **Risks.**
  - Tuning on too little data.
  - Replaying changes learners' visible levels; tell learners when levels move.
  - Interaction with handwriting accuracy: false rejections look like forgetting. Calibrate
    only after M13 baselines exist.
- **Estimated effort.** Simulation 3–4 days; calibration 2–3 days per iteration once data exists.
- **Acceptance criteria.**
  - The simulation is in CI.
  - The calibration report states n, the observed recall per bucket and the decision.
  - Any rule change has a D-entry, is replay-tested, and keeps every existing mastery and SRS
    test green or deliberately updated with a reason.
  - MASTERED characters are recalled at least 85 % of the time at 30 days or more in the beta
    cohort, or the definition is tightened.

## M17 — Remaining beta launch blockers (mostly owner decisions; gates the first invites)

- **Objective.** Clear what stands between the current build and inviting the first 5–10
  learners.
- **Scope.**
  - **Legal and data (owner):**
    - review of the privacy notice, terms and consent
    - minimum age, and whether parental consent is needed (not built)
    - retention periods, then scheduling `ops:prune`
    - the data-export approach
    - processor agreements
  - **Password-reset procedure:** approve, change or keep off. `PASSWORD_RESET_LINKS` stays off
    until approved.
  - **Staging:** M11 provisioning steps 1–7 with owner approval: the GitHub `staging`
    environment and secrets, the backup key, hosting, the first `deploy-staging.yml`, and
    `test:staging` over https. Deploy workflows need GitHub Actions, so not before 2026-12-01.
  - **GitHub CI green on `main` after 2026-12-01:** the Docker job, `age`, PostgreSQL 17 and Linux.
  - **Devices and accessibility:** physical phones and tablets, a stylus, Firefox, and a manual
    screen-reader pass.
  - **Optional local tooling** to clear local CI's BLOCKED steps: `age`, the VC++ runtime for
    Firefox, a container engine. All free; the owner decides.
- **Dependencies.** Owner time and approvals; a lawyer or adviser; GitHub Actions returning on
  2026-12-01; free-tier hosting availability.
- **Risks.**
  - **The legal timeline is the longest pole.**
  - **Free tiers** may need a card; the documented fallbacks apply, and no spending happens
    without approval.
  - **The deploy workflow has never run.**
- **Estimated effort.** Development support 3–5 days, spread out; the owner's and the adviser's
  time dominate.
- **Acceptance criteria.**
  - The legal pages are reviewed, with placeholders filled and `LEGAL_VERSION` set.
  - The age decision is implemented or documented.
  - Retention is scheduled.
  - The reset decision is recorded.
  - Staging serves `main` with readiness `staging`, and `test:staging` passes 12/12 over https.
  - GitHub CI is green on `main`.
  - The device, Firefox and screen-reader passes are logged.
  - Invite-only registration is unchanged.

---

## Decisions the owner needs to make first

1. M12 location: local LAN pilot or staging.
2. Consent form: spoken (as drafted) or written, and whether ethics or legal review is required
   first.
3. HSK edition for new learners: HSK 2.0, HSK 3.0, or both labelled separately.
4. Teacher: who, and on what terms.
5. The order: recommended M12 → (M14 and M15 in parallel) → M13 → M16, with M17 alongside.
