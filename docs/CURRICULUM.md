# Curriculum

## Starter content: `content/hsk1-starter.json`

|                     |                                                        |
| ------------------- | ------------------------------------------------------ |
| Units / lessons     | 6 units, 16 lessons                                    |
| Vocabulary          | 81 items (80 from the HSK 2.0 Level 1 list, plus 你好) |
| Characters          | 102, all with stroke data                              |
| Generated exercises | 366                                                    |
| Verification        | **PROVISIONAL**                                        |

### Sources and licensing

- **Word selection:** the HSK 2.0 Level 1 vocabulary list (150 words, publicly available). Only
  the selection of words comes from it. 你好 is included as a common greeting and labelled as not
  being a separate list entry.
- **Pinyin, English glosses, unit/lesson grouping and exercises:** written by HanziQuest. This is
  **not official HSK course material** and must not be presented as such.
- **Stroke data:** `hanzi-writer-data` 2.0.1, derived from the Make Me a Hanzi project, under the
  Arphic Public License (`node_modules/hanzi-writer-data/ARPHICPL.TXT`). Attribution is shown on
  the Learn page.
- **Audio:** none yet. Listening exercises stay disabled until there is verified, licensed audio.

**Required before calling the content verified:** a qualified Chinese teacher must review every
pinyin reading, tone mark and gloss. Then set `verification` to `REVIEWED`/`VERIFIED` and
re-import.

## Content file format

The schema is in `src/features/curriculum/content-schema.ts`:

- `curriculum`: slug, name, framework (`HSK_2_0` | `HSK_3_0` | `CUSTOM`), version, source,
  licenseStatus, verification.
- `level`: level number and name.
- `characters`: a map from each character to `{ pinyin, meaning, alternatives? }`. Every
  character used by any word must be defined here.
- `units[].lessons[].words[]`: `{ simplified, pinyin, meaning, partOfSpeech?, source? }`.

## Review workflow (M14-b)

Only Content reviewers and Super Admins (`curriculum:review`) change verification, in
Admin → Review. Editors can't: the edit forms have no verification field, and the server refuses
changes.

- **What an approval covers:** one exact version, by fingerprint. Editing the content or its
  sources afterwards returns it to Provisional, with an audit entry.
- **Self-review:** nobody can approve a version they changed or imported.
- **Sources:** approval needs owner-approved sources, the same rule as imports, so nothing can
  be approved until the owner approves the source register entries.
- **Curricula:** a curriculum can be approved once every character and word it teaches is.
- **History:** every decision is kept.
- **Progress:** shown on the review page and on Content quality, and by
  `npm run content:provenance -- --reviews`.
- **Repeats:** a second approval of an already-approved version is refused. Raising Reviewed
  to Verified is allowed.
- **Withdrawing a source approval** (owner, in `content/sources.json`): once that change is
  deployed, the queue shows affected approvals as changed. Run
  `npm run content:provenance -- --reconcile` to preview, then add `--apply` to return them to
  Provisional (audited).

## Sources and editions (M14)

Every content file must cite at least one id from the source register,
`content/sources.json`, in `curriculum.sourceRefs`; files without it no longer validate or
import (CLI or admin). Characters and words may add their own `sourceRefs`, optional
`editions` tags (HSK 2.0 level, HSK 3.0 level, HSK 3.0 handwriting) and, for words, one
`example` with its own `sourceRef` and verification. Edition tags need an approved
`OFFICIAL_LIST` source, and none is registered. `npm run content:provenance` reports what is
unreviewed or unsourced. See docs/CURRICULUM_PROVENANCE_PLAN.md and D-060.

## Validation (`npm run content:validate [file]`)

Errors (import is refused):

- schema violations
- pinyin with tone numbers instead of tone marks
- non-Chinese text in Hanzi fields
- duplicate unit or lesson slugs
- duplicate words
- words using undefined characters
- pinyin syllable count not matching the character count

Warnings: characters defined but unused; characters without stroke data (their writing
exercises are skipped).

More checks were added in M7: readings and tones per syllable, licence and verification
consistency, duplicate glosses, lesson size, and traditional forms. See
`docs/M7_CURRICULUM_AND_LEARNING.md`.

## Preview, coverage and quality report (M7)

- `npm run content:preview -- [file]` shows what an import would change (read-only). The admin
  **Validate** button shows the same.
- `npm run content:coverage -- [file] --list words.txt` compares the content with an
  authoritative word list you supply (one word per line, optional `<TAB>pinyin`).
- `npm run content:report -- [file] --out report.md` writes the quality report. The admin
  equivalent is `/admin/content-quality`.

## Import (`npm run content:import [file] [--draft]`)

`src/features/curriculum/import-content.ts` runs as a single transaction and is idempotent:

- Upserts on stable keys: curriculum slug, level number, unit/lesson slugs, `hanzi`,
  `simplified` + `pinyin`, exercise `key`.
- Is **non-destructive**: it never deletes characters, words or exercises. A word removed from a
  lesson is only detached from that lesson.
- Increments `Lesson.contentVersion` when a lesson's word list changes.
- Publishes new lessons unless `--draft` is passed. Existing lessons keep their status.
- **Protects reviewed content (D-038):** a less verified file never overwrites a REVIEWED or
  VERIFIED character or word. Every change to an existing shared record gets a
  ContentRevision.
- Learners see a curriculum's lessons only while the **curriculum** is published (D-037).

Generated exercises per lesson, in order:

1. `GUIDED_STROKE` for each character the lesson introduces.
2. `MEANING_TO_HANZI` and `PINYIN_TO_HANZI` for each word, e.g. prompt `nǐ hǎo` → answer 你好.
3. `FREEHAND_WRITING` for each newly introduced character.

Each exercise stores its evaluation config: experimental weights (recognition 0.35, stroke
order 0.25, direction 0.15, shape 0.25) and an identity gate, so a wrong character can never
pass on other scores alone.

## Adding HSK 2–6 or HSK 3.0

Follow the pathway in `docs/M7_CURRICULUM_AND_LEARNING.md`. You need a licensed word list,
`content:coverage`, a content file per level, then validate, preview, import as a draft,
review and publish. Never generate readings or glosses and label them official. Levels of the
same curriculum unlock in order (D-039).

## Editing in the admin (M4)

Staff with `curriculum:write` can create and edit curricula, levels, units, lessons,
characters, words and exercises under **Admin**. Every save stores a revision snapshot and an
audit entry.

- **Lesson words:** one per line as `你好 | nǐ hǎo`. Saving regenerates the lesson's
  characters and exercises with the same rules as the importer. Characters are "new" only if
  no earlier lesson in the level teaches them. Hand-written exercises are kept.
- **Characters:** stroke data is attached automatically from `hanzi-writer-data` when it
  exists. A character without stroke data can't be written in exercises.
- **Words:** the written form and pinyin identify a word and can't be edited. Meaning edits
  update the generated prompts.
- **Exercises:** the prompt wording, hint, difficulty and status can be edited. Draft or
  Archived exercises are hidden from learners and not required for completion.
- **Import:** _Admin → Import_ validates and imports JSON in this format. New lessons arrive
  as drafts.
- **Publishing:** preview a lesson as a learner, then publish. Don't mark content Verified
  unless a qualified reviewer has checked it.
