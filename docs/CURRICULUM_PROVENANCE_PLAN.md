# M14 — Curriculum accuracy and provenance plan (HSK 2.0 and HSK 3.0)

**Status: draft for owner review (2026-11-12). Not approved. No content has been added or
changed.** No HSK list, dictionary or example data enters the repository until its source and
licence are recorded and approved (sections 3 and 4).

## Implementation status (2026-11-12, branch `feature/m12-pilot-privacy`, not merged)

The infrastructure of section 4a is built. **No content was added and no HSK membership is
claimed.** Every register entry is PENDING owner approval.

| 4a item                    | Status                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Source register         | **Done.** `content/sources.json` (2 entries: team authoring and `hanzi-writer-data`), schema and checks in `src/features/curriculum/sources.ts`. The CLI and the admin import validate against it: unknown ids, fields a source may not supply, and REVIEWED/VERIFIED content on unapproved or unknown-licence sources are errors. Bundled at build time |
| 2. HSK 1 Starter honestly  | **Done.** The comment and `source` now say the selection was "informed by" HSK 2.0 Level 1 and that the list document wasn't recorded. The curriculum cites `hanziquest-authored`. No words, readings or lessons changed; the same 3 warnings remain                                                                                                     |
| 3. Edition model           | **Done (schema and rules).** Nullable `hsk20Level`, `hsk30Level`, `hsk30Handwriting` on characters and words (null = no claim). Tags in a content file need an approved `OFFICIAL_LIST` source, and an HSK 2.0 curriculum may not carry items tagged only for HSK 3.0, or the reverse. The learner-facing edition label isn't built                      |
| 4. Example format          | **Done.** `example` per word with its own `sourceRef` and verification, stored in the existing example columns plus `exampleSourceRef` and `exampleVerification`. Examples edited in the admin become team-authored and PROVISIONAL                                                                                                                      |
| 5. Review metadata         | **Partly.** Raising verification in the admin records `reviewerRole` (a role, never a name) and `reviewedAt`; returning to PROVISIONAL clears them; VERIFIED with an unknown licence is refused. `npm run content:provenance` reports unreviewed and unsourced items. **The admin review queue page isn't built**                                        |
| 6. Fix the 3 warnings      | **Not done**: it changes lessons, so it waits for the teacher review rather than being done blind                                                                                                                                                                                                                                                        |
| 7. Edition mapping dry run | **Done.** `npm run content:provenance -- --compare a.txt b.txt` (pure `compareLists`), tested on synthetic fixtures only                                                                                                                                                                                                                                 |

Existing database rows have empty `sourceRefs` until the next import of their curriculum; the
report counts them as "noSource". Nothing was imported into any shared database.

## 1. Current state (checked 2026-11-12)

- **One curriculum, `hsk-2-0-starter-v1`** (HSK 1 Starter):
  - framework `HSK_2_0`
  - 6 units, 16 lessons, 102 characters, 81 words, 366 published exercises
  - everything is **PROVISIONAL**, licence `ORIGINAL`
- **The content file's comment** says the word selection "follows the HSK 2.0 Level 1
  vocabulary list (a public list of 150 words)". **Finding:** "public" isn't a licence. The
  source of that list isn't recorded, beyond the claim that the selection follows it. The
  pinyin, glosses, grouping and exercises are the team's own work. Section 4 fixes this.
- **Stroke data:** `hanzi-writer-data` 2.0.1 (Make Me a Hanzi), under the Arphic Public
  License, with attribution shown. Recorded in CURRICULUM.md.
- **What the model already has:**
  - the `CurriculumFramework` enum: `HSK_2_0`, `HSK_3_0`, `CUSTOM`
  - `source`, `licenseStatus` and `verification` fields on curricula, characters and words
  - example fields on `Vocabulary`, which the content format doesn't fill yet
  - the import rule that blocks downgrades (`provenance.ts`)
  - the validator refuses VERIFIED with an unknown licence
- **What it lacks:**
  - a level per standard on characters and words (the level is only implicit, through
    curriculum → level → unit → lesson)
  - a structured source register (`source` is free text)
  - who reviewed an item and when (only the verification level, plus audit and revision
    history)
  - provenance per example sentence
- **Validator warnings:** 3 (two 9-character lessons; 朋 and 友 share the gloss "friend").

## 2. The two standards (facts to confirm against primary sources)

The statements below are background for planning. **Each must be checked against the official
document before any content work**, and the check recorded in the source register.

|              | HSK 2.0                                                                                             | HSK 3.0                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it is   | The exam syllabus and word lists in use since about 2010: 6 levels                                  | The _Chinese Proficiency Grading Standards for International Chinese Language Education_ (GF 0025-2021), issued in 2021: 3 stages and 9 levels, with levels 7–9 sharing one band |
| Units        | Vocabulary per level (commonly cited cumulative totals: 150, 300, 600, 1,200, 2,500, 5,000 words)   | Four quantified elements per level: syllables, characters, words, grammar points. It also has a separate **handwriting character list**, distinct from the recognition list      |
| Level 1 size | 150 words                                                                                           | Substantially larger than HSK 2.0 Level 1 (commonly cited: about 500 words and 300 characters). **Confirm**                                                                      |
| Exams        | The level 1–6 exams followed this syllabus                                                          | Check the current exam status with the official testing body; the exams and the standard may not move together                                                                   |
| Licence      | Published in official syllabi. The copyright status of the lists is **unknown; owner to determine** | Issued as a national language standard. Whether its tables may be reproduced, and on what terms, is a **legal question for the owner** (not settled here)                        |

**The handwriting list matters for HanziQuest.** The app is about writing characters, so HSK
3.0's separate handwriting list is the natural basis for which characters a learner is asked
to write from memory. Recognition-only characters could be read but not drilled. The level
sizes are confirmed during sourcing.

## 3. Principles

1. **Two editions, never mixed.** A curriculum declares one framework. A character or word may
   belong to both, with a level recorded separately for each. The UI always names the edition
   ("HSK 2.0 Level 1", "HSK 3.0 Level 1") and never calls content "official HSK material".
2. **The list is not the content.** An official list fixes only which items belong to a level.
   Readings, glosses, examples, grouping and exercises are separate content, each with its
   own source.
3. **Every external item has a registered source.** No source, no import. The licence status is
   one of `ORIGINAL`, `LICENSED`, `OPEN_LICENSE` (with the exact licence, for example
   CC BY-SA 4.0, and its obligations), or `PUBLIC_FACT`. `PUBLIC_FACT` is used only when the owner
   has decided, on advice, that the item is a fact not protected by copyright. Never `UNKNOWN`
   for anything published.
4. **Verification means a person checked it.** REVIEWED means a qualified teacher has checked
   it. VERIFIED additionally needs a licensed or authoritative source for every field. Labels
   are given only through the admin workflow, with an audit entry.
5. **Share-alike and attribution are tracked.** If an open dataset with share-alike terms is
   used (some dictionary datasets are), record which fields came from it. The owner then
   decides, with advice, whether the obligation is acceptable before it ships.
6. **Growth is gated by handwriting checks.** Each new character set re-runs the
   confusable-pair suite (M13) before it's published, because a larger candidate set changes
   identity checking.

## 4. Plan (for review; not started)

### 4a. Work that needs no external source, staging or spending

1. **Source register** (`content/sources.json`, plus a validator rule). Each entry records:
   - id, title, publisher, edition or version, URL or ISBN
   - the date obtained, the licence and its obligations
   - the fields it may supply (membership, reading, gloss, example, audio)
   - who approved it

   The importer refuses an item whose `source` isn't in the register, or whose fields come from a
   source not allowed to supply them.

2. **Record the existing HSK 1 Starter honestly.** Register the stroke data and the team's own
   authoring as sources. For the "follows the HSK 2.0 Level 1 list" claim, either register the
   exact list document the owner approves, or reword the comment to "selection informed by
   HSK 2.0 Level 1". Labels are unchanged: still PROVISIONAL.
3. **Edition model:**
   - an expand-only migration with per-standard level tags on characters and words: HSK 2.0
     level; HSK 3.0 level and band; HSK 3.0 handwriting yes or no
   - a curriculum framework rule: a framework's lessons may only use items tagged for it
   - the learner-facing edition label
   - the migration is created with `prisma migrate dev` against the local database only
4. **Example-sentence format:** add example fields to the content format, with provenance per
   sentence (source id, author or reviewer role, verification). Examples are written by the team
   or the teacher unless a licensed source is registered. Imports store them in the existing
   `Vocabulary` example columns, with provenance kept alongside.
5. **Review metadata and workflow:**
   - the reviewer role and date per item (no names in the repository)
   - an admin review queue: PROVISIONAL items, a diff of proposed fixes, and an approve action
     that sets REVIEWED with an audit entry
   - a report of what's still unreviewed
6. **Fix the 3 validator warnings** in the team's own content. Split the two 9-character lessons
   and add a distinguishing note for 朋 and 友. Re-import through the normal path (`content:preview`
   first). These are corrections to existing original content, not new HSK content.
7. **Edition mapping tool (dry run only):** given two registered lists, produce a report of
   overlaps and differences, for example items in HSK 2.0 Level 1 but not in HSK 3.0 Level 1.
   It's tested on synthetic fixtures until real lists are approved.

### 4b. Work that needs the owner (approval, sources, people)

8. **Choose the edition** for new learners: HSK 2.0, HSK 3.0, or both labelled separately.
   Recommendation: build new content on **HSK 3.0, with the handwriting list driving
   writing-from-memory**, and keep HSK 1 Starter labelled as HSK 2.0.
9. **Obtain the lists** from sources the owner may use, get advice on reproducing them, and
   register them.
10. **Engage a qualified teacher** (terms are the owner's decision; this may cost money). The
    first review is HSK 1 Starter: readings and tones, glosses, traditional forms, stroke-order
    spot checks, example sentences.
11. **Audio:** none until there is a licensed or self-recorded source with consent.

### 4c. Only after 4a and 4b

12. **The remaining 70 HSK 2.0 Level 1 words, or HSK 3.0 Level 1 content:** from registered
    sources only, imported as PROVISIONAL, reviewed by the teacher, gated by the confusable-pair
    suite (M13).

## 5. Risks

- **Licensing uncertainty** for official lists. Mitigation: membership-only use, legal advice,
  and the register.
- **Teacher availability and cost** set the timeline.
- **HSK 3.0's larger Level 1** changes lesson pacing and the size of the handwriting candidate
  set.
- **Edition confusion** for learners. Mitigation: the edition is always labelled, and a
  curriculum never mixes editions.
- **Share-alike obligations** spreading to app content if open data is mixed in carelessly.
  Mitigation: provenance per field.

## 6. Estimated effort

- **4a items 1–7:** about 6–9 development days, all local.
- **4b:** owner and teacher time; HSK 1 Starter review about 1–2 teacher days.
- **4c:** depends on the edition and the sources.

## 7. Acceptance criteria

- Every item in the content file and the database cites a registered source. The importer
  rejects unregistered sources and disallowed fields.
- The HSK 2.0 claim is either backed by a registered source or reworded.
- Per-standard level tags exist. The edition is shown to learners, and no curriculum mixes
  editions.
- Example sentences carry provenance per sentence.
- Zero validator warnings, and `content:preview` shows no downgrade of reviewed data.
- HSK 1 Starter reaches REVIEWED only through the admin workflow, after the teacher's review,
  with audit entries. Nothing is VERIFIED without a licensed source for every field.
- No new HSK items are added before 4b is complete.
