# M7 curriculum and learning intelligence (2026-11-11)

Branch: `feature/m7-curriculum` (built on M6). The goal was to make the curriculum and the
learning engine harder to get wrong, without inventing content. **No new HSK words, glosses
or readings were written in M7.** All content changes would need a licensed source and a
qualified reviewer.

## What was reviewed

| Area                          | Finding                                                                                                                                                                                                                    | Action                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared characters and words   | **M7-01 (high):** the importer overwrote a shared character's or word's reading and gloss on every import. A PROVISIONAL file could rewrite a teacher-VERIFIED gloss, and the record kept its VERIFIED label.              | Protected reviewed records (D-038). Every import change now gets a content revision. The import preview shows what would change and which other curricula share the record. |
| Import audit                  | **M7-02:** the admin import wrote its audit entry outside the import transaction.                                                                                                                                          | `onImported` runs the audit inside the transaction; a failed audit rolls the import back (tested).                                                                          |
| Level progression             | **M7-03:** each level unlocked independently, so level 2's first lesson was open from the start.                                                                                                                           | Levels are sequential, like lessons (D-039).                                                                                                                                |
| Placement                     | **M7-04:** two 4-option questions per unit gave a 1/16 chance of guessing a unit, and the check could be retaken without limit.                                                                                            | 3 questions per unit (1/64) and a 24-hour retake cooldown (D-040). Testing out still never creates mastery or reviews.                                                      |
| Content validation            | Reading/tone consistency, licence and verification consistency, duplicate glosses, lesson size and traditional forms were not checked.                                                                                     | New validator rules (below).                                                                                                                                                |
| Recall vs technique vs guided | The engine already separates these (D-020, D-033). Learners saw only a "Check strokes" flag.                                                                                                                               | Per-character and total recall rate, technique rate and guided count (`skillTotals`). M8 shows them.                                                                        |
| Review and mastery rules      | Already pure, centralised (`SRS` in `progress/mastery.ts`, `XP` in `progress/xp-rules.ts`) and covered by unit tests. Mastery and SRS are replayed from history, so a rule change applies with `npm run progress:rebuild`. | No change. The constants are the configuration: a change is a code review plus a rebuild, never a runtime toggle.                                                           |

## Content validation (`npm run content:validate`)

New rules in `validate-content.ts` and `readings.ts`:

| Rule                                                                                                  | Severity |
| ----------------------------------------------------------------------------------------------------- | -------- |
| A word's syllable isn't any defined reading of its character (likely a typo or a missing polyphone)   | warning  |
| A syllable's tone differs from every reading. Neutral tone and 一/不 sandhi are allowed.              | warning  |
| A character reading isn't exactly one syllable                                                        | error    |
| Content marked REVIEWED or VERIFIED while its licence or source is unknown                            | error    |
| Licence UNKNOWN                                                                                       | warning  |
| A traditional form whose length differs from the simplified form                                      | error    |
| Two characters with the same gloss                                                                    | warning  |
| An alternative reading that repeats the main reading                                                  | warning  |
| More than 8 new characters or 12 words in a lesson, or a gloss over 120 characters (`CONTENT_LIMITS`) | warning  |

## New tools

| Command / page                                                           | What it does                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run content:preview -- <file>`, and **Validate** on `/admin/import` | Read-only diff against the database: new and changed characters and words (field by field, protected or not, shared with which curricula), new lessons, lessons whose word list changes, and lessons kept because they aren't in the file.                                                               |
| `npm run content:coverage -- <file> --list <words.txt>`                  | Compares a content file with an authoritative word list **that you supply**: words not in the list (which must not be presented as list words), list words not taught yet, and pinyin differences.                                                                                                       |
| `npm run content:report -- [file] [--out file.md]`                       | The curriculum quality report: static checks plus database checks.                                                                                                                                                                                                                                       |
| `/admin/content-quality`                                                 | The same database checks for staff:<br>- published lessons with no exercises<br>- lessons with no free writing<br>- missing or inconsistent stroke data<br>- exercises that can't be graded<br>- word readings that disagree with their characters<br>- licence problems<br>- verification status counts |
| Curriculum page: **Publish / Unpublish / Archive**                       | From M6. A curriculum is now the unit of release.                                                                                                                                                                                                                                                        |

## Curriculum quality report (HSK 1 starter)

The generated report is `docs/CURRICULUM_QUALITY_REPORT.md`. It was produced on a clean
database holding only the starter content. Summary:

- 6 units, 16 lessons, 81 words, 102 characters, all with stroke data; 366 exercises.
- **PROVISIONAL**, licence ORIGINAL. The word selection follows the HSK 2.0 Level 1 list.
  Pinyin, glosses and grouping are HanziQuest's own. **Not reviewed by a teacher.**
- 0 errors. 0 reading or tone inconsistencies under the new checks. 3 warnings:
  - `units.1.lessons.2` and `units.5.lessons.0` each introduce 9 new characters (suggested
    at most 8).
  - 朋 and 友 share the gloss "friend". That is correct as far as it goes, but learners can't
    tell them apart.
- No word has an example sentence or audio. Listening exercises stay disabled.
- Coverage: 80 of the 150 HSK 2.0 Level 1 words (per CURRICULUM.md). The other 70 aren't
  taught yet.

## Pathway to HSK 2 and HSK 3

The infrastructure is ready. The content is not, and **it must not be generated**.

1. **Source.** The owner obtains the official word list for the target level and edition
   (HSK 2.0 levels 2 and 3, or the 2021 HSK 3.0 standard) from a source they are licensed
   to use, and records the licence. HanziQuest doesn't bundle any list.
2. **Coverage.** Save the list as one word per line (optionally `word<TAB>pinyin`). Then
   `npm run content:coverage -- content/<file>.json --list <list.txt>` shows what is missing
   and anything outside the list.
3. **Author.** Write a content file per level: the same `curriculum.slug` with
   `level.level: 2`, or a new curriculum. Pinyin and glosses are written by a qualified
   person, or taken from a licensed dictionary. Validate until it has no errors and no
   reading warnings.
4. **Preview.** Run `npm run content:preview` (or Validate in the admin) and check any
   protected or shared changes.
5. **Import as draft.** Use the admin import, which always imports drafts. Preview each
   lesson as a learner.
6. **Review.** A teacher checks every reading and gloss. Only then set `verification` to
   REVIEWED or VERIFIED, with the licence recorded. The validator refuses VERIFIED with an
   unknown licence.
7. **Publish** the lessons, then the curriculum (if it is new). Level 2 stays locked for each
   learner until they finish level 1 (D-039).

## Still missing (content work, not engineering)

- 70 HSK 1 words, all of HSK 2 and 3, example sentences and licensed audio.
- A teacher review of all existing pinyin and glosses. Everything is PROVISIONAL.
- A distinguishing note for 朋 and 友, and possibly splitting the two 9-character lessons.
  This is an editorial choice for the owner.
- ~~Tested-out characters are not scheduled for writing review~~ (testing out is
  recognition-only). **Resolved in the integration audit (D-044):** they now appear in Review as
  one-time writing checks, and learners can still open tested-out lessons.

## Tests

- **Unit** (`tests/unit/curriculum-quality.test.ts`, 18 tests):
  - syllable splitting and tones (ü, apostrophes, neutral tone)
  - reading and tone checks, including the sandhi exceptions
  - every new validator rule
  - provenance rules and labels
  - word-list parsing and coverage
  - level progression
  - skill totals
- **Unit** (`progression.test.ts`): placement now asks 3 questions per unit.
- **Integration** (`tests/integration/curriculum-quality.test.ts`, 6 tests):
  - a verified gloss survives a provisional import and is reported
  - an equally verified import updates it and leaves a revision with the old values
  - the preview is read-only and reports new, changed and kept lessons
  - a failed import audit rolls the import back
  - level 2 stays locked until the last level 1 lesson is done
  - the placement retake cooldown
