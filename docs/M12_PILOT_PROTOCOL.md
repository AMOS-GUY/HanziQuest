# M12 — Five-person exploratory handwriting pilot: protocol

**Status: draft for owner review (2026-11-12). Not approved. No participant has been recruited
and no real handwriting has been collected.** Nothing in this protocol changes the evaluation
engine or its thresholds.

**Implementation status (2026-11-12, branch `feature/m12-pilot-privacy`, not merged):** the
privacy items of section 10 (1 erasure, 2 versioned consent, 5 structured observations instead
of notes, 8 prompt check) are built and tested. Items 3, 4, 6 and 7 are not built. **The app
refuses consent and recording for real codes (P01–P05) until the owner approves the consent
form** (`ownerApproved` in `src/features/handwriting/consent.ts`); only `TEST…` rehearsal codes
work today. What erasure does and doesn't reach is in section 8.

This protocol is more detailed than `HANDWRITING_PILOT.md`, the short operator guide that
already exists, and replaces it for M12 once approved. The full validation study, which is the
only basis for changing thresholds, is a separate later step (M13, see "Pilot vs validation"
below and `HANDWRITING_VALIDATION.md`).

## 1. Purpose and limits

**The pilot answers:**

1. Does the collection procedure work end to end with real people, devices and prompts?
2. Are there gross failures: a device, input method, writing size or character where correct
   writing is regularly rejected, or wrong writing regularly accepted?
3. Is the feedback understandable and does it feel fair to the writer?
4. What has to change (prompts, UI, data handling) before the larger validation study?

**The pilot does not:**

- estimate accuracy for real learners
- change thresholds, scoring policy or `ENGINE_VERSION`
- support any public or marketing claim about recognition accuracy

Synthetic-ink results (`handwriting-baseline-synthetic.md`) are not evidence of real-world
accuracy either, and must not be quoted as such.

## 2. Pilot vs validation (why five people can't justify tuning)

|                              | M12 exploratory pilot                                          | M13 validation study (before any threshold change)                                                                                  |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Participants                 | 5 (P01–P05)                                                    | ≥ 15 (target 20–30), new participants not in the pilot for the held-out set                                                         |
| Samples                      | 180: 120 correct, 60 deliberate errors (10 of each error type) | ≥ 300 correct and ≥ 300 incorrect (current minimum); proposed additions below                                                       |
| Output                       | Findings list; descriptive counts with 95 % intervals          | FRR, structural false acceptance, wrong-character acceptance, specific-error rate, with intervals, per device and size              |
| May change thresholds?       | **No**                                                         | Only if a target is missed, via the six rules in HANDWRITING_VALIDATION.md, with held-out confirmation and an `ENGINE_VERSION` bump |
| May support accuracy claims? | **No**                                                         | Only for the population, devices and characters tested, with intervals                                                              |

**What 180 samples can show.** Samples from one writer are correlated, so the effective sample
size is smaller than the count. Even with zero errors observed, and treating samples as
independent (optimistic), the exact one-sided 95 % upper bound is:

| Measure (pilot pool)                                     | n   | Upper bound if 0 observed | Beta target |
| -------------------------------------------------------- | --- | ------------------------- | ----------- |
| False rejection (correct samples)                        | 120 | about 2.5 %               | ≤ 10 %      |
| Structural false acceptance (wrong char, missing, extra) | 30  | about 10 %                | ≤ 2 %       |
| Wrong-character acceptance                               | 10  | about 26 %                | ≤ 1 %       |

So the pilot can detect gross problems but **cannot show that the false-acceptance targets are
met**.

**Proposed amendment to the validation minimum (owner decision; not applied):** to show
wrong-character acceptance ≤ 1 % with 95 % confidence, the study needs about **300
wrong-character samples** with zero accepted, and more if any are accepted. For structural false
acceptance ≤ 2 % it needs about **150 structural-error samples** on the same basis. Both are on
top of 300 correct samples, and spread across at least 15 writers. Changing the minimum is a
documentation and lab change, not an engine change, and would be recorded in DECISIONS.md.

## 3. Participants and recruitment criteria

**Recruiting starts only after the owner approves this protocol and the consent form.**

- **Number:** 5. **Age:** 18 or over (no minors, so no parental consent is needed).
- **Mix (target, all five together):**
  - at least 2 complete beginners (no previous Chinese writing)
  - at least 1 learner with a year or more of study
  - if possible, 1 native or heritage writer
  - at least 1 left-handed writer if one can be found
- **Devices** (section 6): at least 2 phones (finger), 1 tablet with a stylus, 1 laptop
  (mouse or trackpad).
- **Exclusions:**
  - anyone who works on HanziQuest's code or engine (they know the thresholds)
  - anyone who can't give consent freely, for example someone in a reporting line where
    refusing feels risky
- **Recruitment channel:** the owner's own contacts, asked personally. No public posting, no
  payment, no gifts that could pressure anyone. If any thanks is offered, it doesn't depend on
  completing the session.
- **Screening questions,** asked before the session and **not stored in the app:** age 18 or over
  (yes/no), Chinese writing experience (none / under 1 year / 1 year or more / native or
  heritage), handedness, and the device they'll use. The collector writes the coarse
  answers against the participant code on the private paper key (section 8). Optional storage
  of these coarse bands in the app is an M12 implementation decision (section 10, item 4).

## 4. Written informed consent

The owner chose written consent. The form below is a **draft. It hasn't been reviewed by a
lawyer or an ethics board.** If the owner's organisation or jurisdiction requires ethics or
legal review for research with people, get it before the first session. The signed paper (or a
signed PDF) is kept outside HanziQuest with the private key (section 8), never uploaded to the
app.

> **HanziQuest handwriting pilot — participant information and consent (draft v0.1)**
>
> **What this is.** We are testing how well HanziQuest's handwriting checker works on real
> handwriting. You'll write about 36 Chinese characters on a screen, which takes about 25
> minutes. Some you'll write normally, and some you'll write wrong on purpose (we'll tell you
> how). You don't need to know any Chinese.
>
> **What we store.** For each character you write:
>
> - the pen strokes (positions and timing)
> - which character you were asked to write and how (normally, small or fast, or a deliberate
>   mistake)
> - the checker's verdict
> - the input type (finger, stylus, mouse or trackpad) and coarse device facts (screen size,
>   pixel ratio, pointer type, browser family and operating-system family)
> - a participant code such as "P03"
>
> We do **not** store your name, email, voice, image, exact location or full device identifier
> in HanziQuest.
>
> **Who knows it's you.** Only the person running the session keeps a paper note linking your
> name to your code, so that we can delete your data if you ask. That note is kept separately
> and destroyed when the study ends (section on retention below).
>
> **How it's used.** Only to test and improve HanziQuest's handwriting checker. Results are
> reported as totals, never by name. Your strokes may be kept to test future versions of the
> checker until [retention date, owner to fill], unless you withdraw.
>
> **Voluntary.** Taking part is voluntary. You can skip any character, stop at any time without
> giving a reason, and ask for your strokes to be deleted later by giving your code to
> [contact, owner to fill]. Deletion is complete within [N] days. Results already reported as
> totals can't be un-reported, but your strokes will no longer be used.
>
> **Risks.** None expected beyond about 25 minutes of your time. Handwriting is not usually
> enough to identify someone, but no method is perfect, which is why we keep your name out of
> the app.
>
> **Questions.** Ask the person running the session, or contact [contact, owner to fill].
>
> Please initial each box:
>
> - ☐ I am 18 or older.
> - ☐ I have read this information, and my questions have been answered.
> - ☐ I agree to my pen strokes and the facts above being stored and used as described.
> - ☐ I understand I can stop at any time and ask for my data to be deleted.
> - ☐ (Optional) I agree to my coarse writing-experience and handedness band being stored with
>   my code.
>
> Name: ____________ Signature: ____________ Date: ____________ Participant code: P__
>
> Session collector: ____________ Consent form version: v0.1

**Recording consent in the app (implemented).** After the form is signed, the collector
records it under **Participants and consent** in the lab: the code, the date signed and a
confirmation that the signed paper is in front of them. The app stores a `PilotConsent` row
(form version, signing time, which staff account recorded it) and audits it. It then:

- refuses to record any sample for a code without an unrevoked acceptance of the **current**
  form version. A new form version needs a new signature and a new acceptance
- links every sample to the consent it was recorded under (`consentId`)
- refuses an unknown or superseded version, a signing date in the future or over a year old,
  and a second acceptance of the same version
- refuses every non-`TEST` code while the current form isn't owner-approved

The per-sample consent tick remains as a reminder; it is no longer the record of consent.

## 5. Data collected per attempt

All of the following is already captured by the lab (`HandwritingSample`), except where marked
_planned_.

| Field                                                              | Content                                                                                                                                                                                                               | Personal-data note                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `participantCode`                                                  | `P01`–`P05` (the validator allows letters, digits and `-`, up to 16)                                                                                                                                                  | pseudonymous; the key is kept on paper only                                         |
| `characterId`, `category`, `shouldAccept`, `writtenHanzi`, `style` | the prompt: target character, correct or which deliberate error, the look-alike if any, normal or small-or-fast                                                                                                       | none                                                                                |
| `strokes`                                                          | normalised points `{x, y, t}` per stroke; `t` is ms since the start of the drawing                                                                                                                                    | biometric-adjacent; no pressure, tilt or absolute timestamps per point              |
| `inputDevice`, `canvasSizePx`                                      | finger, stylus, mouse or trackpad; the box size                                                                                                                                                                       | none                                                                                |
| `deviceInfo`                                                       | screen size, pixel ratio, coarse or fine pointer, browser family, OS family (no full user agent)                                                                                                                      | coarse by design, to limit fingerprinting                                           |
| `engineVersion`, `band`, `score`, `identityVerified`               | the verdict at collection time; metrics are recomputed with the current engine                                                                                                                                        | none                                                                                |
| `collectorId`, `createdAt`                                         | the staff account that recorded it; the time                                                                                                                                                                          | staff data                                                                          |
| `observations`                                                     | zero or more fixed choices (hesitated, restarted, used undo, unsure of the character, misunderstood the instruction, made a different error than asked, wrote outside the box, device lag or palm touch, interrupted) | none: free text is refused, so names can't be typed in. `style` is a fixed list too |
| `notes`                                                            | **no longer written** (M12). Requests carrying `notes` are rejected. The column stays for pre-M12 rows until a contract migration drops it                                                                            | erased with the participant                                                         |
| `consentConfirmed`                                                 | must be true                                                                                                                                                                                                          |                                                                                     |
| `participantId`, `consentId`                                       | links to the participant code and to the consent acceptance (form version and signing time) the sample was recorded under                                                                                             | pseudonymous                                                                        |
| _planned, optional:_ participant bands                             | experience band and handedness, only with the optional consent box                                                                                                                                                    | coarse; stored once per code, not per sample                                        |

No audio, video, photos, names, emails or IP addresses are stored with samples. Staff actions
are audited as usual.

## 6. Device and input-method coverage

| Participant | Primary device (target) | Input                       | Writing hand            |
| ----------- | ----------------------- | --------------------------- | ----------------------- |
| P01         | phone                   | finger                      | any                     |
| P02         | phone                   | finger                      | any                     |
| P03         | tablet                  | stylus                      | any                     |
| P04         | laptop                  | mouse or trackpad           | any                     |
| P05         | any not yet covered     | the input least represented | left-handed if possible |

- Each participant uses one device for the whole session, which keeps device effects
  separable.
- **Size coverage** comes from the prompts: every character is written once at a comfortable
  size and once small (about a third of the box) or fast.
- Browsers: record whatever each participant uses. Firefox on at least one device if possible,
  because automated Firefox tests are blocked on the development machine.
- **Rehearsal:** before P01, the collector runs the whole session on every device class using
  codes `TEST-…`. Those samples are excluded automatically (the `TEST` prefix rule).

## 7. Prompts (correct and incorrect)

The plan is generated by `pilotPlan()` (`src/features/handwriting/pilot.ts`). There are 12
characters, from simple to complex: 人 八 上 女 中 天 他 好 你 我 是 谢. Each participant writes:

- every character **correctly twice**: "the way you normally would", then "correctly, but small
  (about a third of the box) or quickly"
- **one deliberate error** per character, rotated per participant (below)

That's 36 prompts per participant: 24 correct and 12 errors.

Errors are said to the participant in plain words:

| Error type | What the collector says                                            |
| ---------- | ------------------------------------------------------------------ |
| wrong char | "Write [look-alike] instead." (the look-alike is shown)            |
| missing    | "Write it but leave out one stroke (any one)."                     |
| extra      | "Write it and add one extra stroke anywhere."                      |
| reversed   | "Write it but draw one long stroke backwards."                     |
| order      | "Write it but swap the order of two strokes."                      |
| shape      | "Write it with one stroke clearly too long or in the wrong place." |

**Deliberate-error rotation** (generated from `pilotPlan`; look-alike in brackets):

| Character | P01             | P02             | P03             | P04             | P05             |
| --------- | --------------- | --------------- | --------------- | --------------- | --------------- |
| 人        | missing         | extra           | reversed        | order           | shape           |
| 八        | extra           | reversed        | order           | shape           | wrong char (人) |
| 上        | reversed        | order           | shape           | wrong char (下) | missing         |
| 女        | order           | shape           | wrong char (子) | missing         | extra           |
| 中        | shape           | wrong char (十) | missing         | extra           | reversed        |
| 天        | wrong char (午) | missing         | extra           | reversed        | order           |
| 他        | missing         | extra           | reversed        | order           | shape           |
| 好        | extra           | reversed        | order           | shape           | wrong char (妈) |
| 你        | reversed        | order           | shape           | wrong char (他) | missing         |
| 我        | order           | shape           | wrong char (没) | missing         | extra           |
| 是        | shape           | wrong char (星) | missing         | extra           | reversed        |
| 谢        | wrong char (说) | missing         | extra           | reversed        | order           |

That's 10 samples of each error type across the pilot. All nine look-alikes (人 下 子 十 午 妈 他 没
星 说) are in the 102-character candidate set, so a wrong-character verdict is meaningful. Each
character gets five of the six error types.

**Session rules:**

- Show the target character if the participant doesn't know it, then hide it before they
  write.
- Don't coach stroke order on "normal" prompts.
- Don't show the verdict until the end, so it doesn't change how they write.
- If a participant is interrupted, or writes something other than the prompt, press Clear and
  redo it before recording.
- If something is recorded by mistake, note the time on the paper key so it can be removed.
- At the end, show them their verdicts and ask two questions:
  - "Did any feedback seem wrong or unfair?"
  - "Was anything confusing?"

  Record the answers under the code in Admin → Feedback (kind "Handwriting"), without names.

## 8. Privacy, retention and withdrawal

- **Pseudonyms:** codes P01–P05 only. The code-to-name key and the signed consent forms are kept
  on paper (or in an encrypted private file) outside HanziQuest and outside the repository.
- **Where the data lives:** only on the database the owner chooses for the pilot (section 9).
  Never in the repository, issue tracker, chat or any third-party service. Exports
  (`/api/admin/handwriting/samples?strokes=1`) are stored only on the owner's machine,
  encrypted if copied anywhere else.
- **Access:** staff accounts with `handwriting:validate` (Super Admin, Curriculum Editor) only.
- **Retention** (owner to fill, recommended):
  - raw strokes are kept until the end of the M13 validation study, or 12 months, whichever
    comes first, then deleted or kept only with renewed consent
  - the paper key is destroyed at the same time
  - aggregate reports are kept
- **Withdrawal (implemented):** a participant gives their code. A Super Admin uses **Withdraw
  or end retention (erase)** in the lab, types the code twice and picks the reason (withdrawal or
  end of retention). In one transaction the app:
  - deletes every sample for the code, including pre-M12 samples matched by code alone
  - redacts the sample audit entries (they keep the action and time, and lose the code and
    character)
  - revokes the consent and marks the code WITHDRAWN or RETENTION_ENDED, so it can never record
    or give consent again (a new code is needed)
  - writes one audit entry with the counts only

  Recording and erasure lock the same participant row, so a sample can't slip in during an
  erasure. **What erasure keeps:** the code itself, its status and its consent rows (version,
  signing time, revocation time) as the record that consent was given and withdrawn. They hold
  no handwriting. **What erasure can't reach**, so the collector must handle it by hand:
  - exported files (`?strokes=1`) on any machine
  - database backups: erased samples stay in backups until those expire, and **restoring an
    older backup brings them back** unless the erasure ledger is re-applied
    (`npm run handwriting:erasures`). The consent form's deletion window must be at least the
    backup retention, or backups must be purged
  - Admin → Feedback entries: they aren't linked to codes and are never deleted automatically.
    Erasure reports how many mention the code, for a person to review. Keep pilot feedback
    anonymous (no code in it), or keep it on paper with the key

  The full surface-by-surface review and the erasure checklist are in
  [M12_ERASURE_REVIEW.md](M12_ERASURE_REVIEW.md).
  - the paper key and signed form

- **Breach or mistake:** if a name or identifying detail is found in a sample note, delete that
  note or sample and record what happened in PROGRESS.md (no personal detail in the record).

## 9. Where the pilot runs (owner decision)

| Option                   | What it needs                                                                                                                                                                                                                                                                                                                  | Staging or spending?                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| **A. Local**             | The owner's laptop runs a production build on a fresh local pilot database. Phones and tablets connect over the same private Wi-Fi to an explicit, time-boxed "LAN pilot" mode: off by default, refused when `APP_ENV` is set, private-network addresses only, invite-only registration unchanged, stopped after each session. | none                                    |
| **B. Staging**           | M11 provisioning approved, a marked staging database, the pilot run over https                                                                                                                                                                                                                                                 | staging ($0 free tiers), needs approval |
| **A-lite** (laptop only) | No network exposure at all; mouse, trackpad and touchscreen-laptop input only                                                                                                                                                                                                                                                  | none, but no phone or stylus coverage   |

**Recommendation:** A, with a security review of the LAN mode before use. B depends on staging
approvals and on GitHub Actions returning (2026-12-01).

## 10. M12 implementation plan (for review; not started)

Each item is local-only and needs no staging or spending.

1. **Withdrawal: done.** Erasure by code (section 8), Super Admin only (`handwriting:erase`),
   typed confirmation, one transaction with an audit entry, integration-tested.
2. **Consent version: done,** as a `PilotConsent` table rather than a column on samples, so that
   a signing time, a revocation and a new version can be recorded. Expand-only migration
   `20261112125646_m12_pilot_consent_and_provenance`.
3. **Pilot report with intervals:** `npm run handwriting:report -- --pilot` adds Wilson 95 %
   intervals, per-participant and per-device breakdowns, and the line "exploratory pilot,
   n = 5, not an accuracy estimate". Unit-tested on fixtures.
4. **Optional participant bands:** experience band and handedness per code, stored only when the
   optional consent box was initialled. The owner decides whether to build this or keep it on
   paper.
5. **Notes guard: done, more strictly than planned.** Free-text notes and free-text styles are
   gone. The lab takes fixed observations and a fixed style list, and rejects any other field.
6. **LAN pilot mode** (only if option A): design and security review first, then implement it with
   tests showing it's refused under `APP_ENV`, for public addresses and in production builds.
7. **Rehearsal checklist and session script:** a one-page printable version of sections 6–8.
8. **Prompt check: done** (`tests/unit/provenance-and-pilot.test.ts`): each error type appears
   10 times across P01–P05, and every pilot character and look-alike has stroke data.

Estimated effort: 3–5 development days (plus 1–2 for item 6). Owner: approvals, recruiting, about
3 hours of sessions.

**Not changed:** thresholds, `ENGINE_VERSION`, technique caps and mastery rules.

## 11. Evaluation methodology and reporting

- **Data set:** participants P01–P05 only. `TEST` codes are excluded. Each sample is labelled by
  its prompt; samples the collector flagged as mis-recorded are excluded and counted.
- **Measures**, recomputed with the current engine (`hq-eval-1`): FRR, structural false
  acceptance, wrong-character acceptance, specific error named, and technique errors accepted
  (report only). Definitions are in `HANDWRITING_VALIDATION.md`.
- **Report** (`docs/handwriting-pilot-YYYY-MM-DD.md`):
  1. **Header:** "Exploratory pilot, 5 participants, 180 samples. Not an accuracy estimate.
     Thresholds unchanged."
  2. **Counts and Wilson 95 % intervals** for each measure, overall, per participant, per input
     device and per size (normal vs small or fast).
  3. **Every false acceptance,** listed individually: character, error type, device, band and
     score, with a replay image of the ink if practical.
  4. **False rejections,** grouped by character, device and size, to find patterns. A pattern means
     at least 2 participants or devices.
  5. **Feedback quality:** for deliberate errors, did the feedback name the actual problem?
     Plus the participants' "unfair or confusing" comments.
  6. **Procedure findings:** prompt clarity, recorder UX, timing, device problems.
  7. **Findings list:** each finding is classified as engine, prompt, UX or device, rated
     high, medium or low, and given an owner decision (fix before validation, M13, or won't
     fix).
- **Interpretation rules:**
  - No claim of accuracy for learners.
  - No threshold change.
  - A false acceptance of a wrong character is always a high-priority finding, even once.
  - A false-rejection pattern on one device class is a finding for M13, not a reason to tune.
- **Sign-off:** the owner reviews the report before anything from it is used to plan M13.

## 12. Acceptance criteria for M12

- The owner approved this protocol, the consent form and the pilot location, and recruited
  participants, before any session.
- Withdrawal, consent version and the pilot report are implemented and tested, and a rehearsal
  with `TEST` codes was completed on every device class.
- 5 participants × 36 samples, each with a signed form on file outside the app, on at least 3
  input types.
- The report is saved with intervals and the "not an accuracy estimate" header, and every
  finding has an owner decision.
- A deletion was exercised end to end (on a `TEST` code, or on a real withdrawal if one
  happens).
- Thresholds, `ENGINE_VERSION`, scoring policy and mastery rules are unchanged.
