# M16.1: Vocabulary Explorer

Status: **implemented on `feature/m16-vocabulary-explorer`, not merged.** Needs owner review.
Written 2026-11-27.

## What it is

`/vocabulary` ("Your words") lists every word from the lessons a learner has reached, grouped by
lesson in curriculum order. Learners can search it and filter it by lesson. Each card shows the
Hanzi, the pinyin and the meaning, and links to the existing word page (`/vocabulary/[id]`),
which has the characters and stroke order. A card shows an HSK badge only when `hsk20Level` is
set, which happens only from an approved source (D-060). Today no word has one.

It has no new exercises, no progression, XP, mastery or schedule effects, and makes no database
writes.

## Access model

| Rule                          | Where                                                                      |
| ----------------------------- | -------------------------------------------------------------------------- |
| Signed-in learner only        | `(learner)` layout plus `requireUser()` on the page                        |
| Published content only        | `LEARNER_VISIBLE_LESSON` on both queries (lesson and curriculum PUBLISHED) |
| Reached lessons only          | `getLessonStatesForLevel`: any state but `LOCKED`                          |
| Filtering happens server-side | `filterExplorerWords` runs over the already-entitled list                  |

- **No new progression rule.** "Reached" is the state the learning path already shows
  (`AVAILABLE`, `IN_PROGRESS`, `COMPLETED` or `TESTED_OUT`). The explorer reads it; it doesn't
  recompute it.
- **Locked words are never sent.** The page is server-rendered from the entitled list. No API
  route is added. Search, the lesson filter and hand-written query strings
  (`?lesson=<locked id>`, `?q=谢谢`) can only narrow that list.
- **The query is echoed back.** A search that matches nothing prints the learner's own query
  ("Nothing in your lessons matches “谢谢”"). That is the input, not data: no pinyin, meaning or
  id of a locked word appears in the page. React escapes it.
- **Offline.** The service worker never caches signed-in pages or RSC requests (`public/sw.js`),
  so no offline cache holds explorer pages.

### Pre-existing exposure (not changed, owner decision)

Found on 2026-11-27 by reading the code. The practice finding was confirmed with a temporary
probe against the integration database (not committed). None of it was changed.

| Route                                         | Shows a locked lesson's content?                                 | Lock-gated?                            |
| --------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| `/learn/[id]` (lesson overview)               | Yes: its words and characters, with "Finish the previous lesson" | Practice button only                   |
| `/vocabulary/[id]` (word page)                | Yes, by id                                                       | No: published content only             |
| `/characters/[hanzi]` (stroke order)          | Yes                                                              | No: published content only             |
| `/practice/character/[hanzi]` (free practice) | Yes, and it **grades**                                           | **No**                                 |
| `/practice/lesson/[id]` (lesson practice)     | —                                                                | **Yes** (`startLessonSession` refuses) |
| `/vocabulary` (this explorer)                 | No                                                               | Yes (reached lessons only)             |

The probe ran on a brand-new learner. It submitted a freehand attempt on an exercise from a
lesson in state `LOCKED`, with no session, which is what free character practice does. The
attempt was accepted, and it returned `EXCELLENT` and **10 XP**. It also created a
`CharacterMastery` row (`LEARNING`) and a `ReviewSchedule` row. A learner can reach this from the
UI: locked lesson overview → character → Practise. `submitAttempt` checks that the exercise is
published and in a learner-visible lesson, but not the lesson's state. No decision entry records
whether this is intended.

#### Recommendation: previews are open, practice that counts follows the path

1. **Keep previews open.** Showing a locked lesson's words, characters and stroke order is
   useful. It shows learners what's coming, it supports placement and "tested out" learners, and
   none of it is unpublished. The data isn't secret, and hiding it would make
   `/vocabulary/[id]` and `/characters/[hanzi]` 404 for links learners already have. Label
   previews as previews: show a "Preview: unlocks after <lesson>" note on the word and character
   pages when every lesson teaching them is locked.
2. **Decide explicitly whether practice on locked characters counts.** Today free practice on
   a locked character earns XP and starts mastery and a review schedule, while lesson practice is
   blocked. There are two coherent options:
   - **(a) Free practice is open but doesn't count until reached.** Grade it, show feedback,
     and record the attempt. Award no XP, and create no mastery or schedule rows until a lesson
     teaching the character is reached. This makes the path the one place progress comes from.
   - **(b) Free practice of anything published counts, as today.** Write a decision entry, so
     it's deliberate rather than accidental.

   We recommend **(a)**. Both options touch XP, mastery and scheduling, which are protected
   policy, so this needs an owner decision and its own PR with tests and a decision entry. It
   doesn't belong in M16.1.

3. **The explorer stays strict either way.** It's a "your words" list, not a catalogue. A
   future "all words" catalogue could list previews with the same label.

## Search

`src/features/learning/vocabulary-search.ts` holds pure functions with unit tests.

- **Hanzi:** substring (`好` matches 好 and 你好).
- **Pinyin:** tones, spaces, apostrophes, tone digits and case are ignored, and `ü`, `u:` and `v`
  are folded together. So "ni hao", "nihao", "ni3hao3" and "nǐ hǎo" all match 你好, and "nv"
  matches 女.
- **Meaning:** case-insensitive substring.
- **Bounds:** the query is trimmed and capped at 50 characters, and the lesson id at 64.
  Repeated parameters (`?q=a&q=b`) are ignored.
- **Form:** a plain GET form (`role="search"`). It works without JavaScript, and the URLs can be
  bookmarked (only the same learner sees the same result).

## Entry points

- The lesson overview: an "All your words" link beside "Words", shown only when the lesson isn't
  locked.
- Progress: "Browse the words they appear in".
- **No nav tab yet.** `learner-nav.tsx` is changed by open PR #51. Add the tab after #51 merges,
  to avoid a conflict.

## Files

| File                                            | Purpose                                |
| ----------------------------------------------- | -------------------------------------- |
| `src/features/learning/vocabulary-explorer.ts`  | Entitled word list (service)           |
| `src/features/learning/vocabulary-search.ts`    | Search, filter and parsing (pure)      |
| `src/app/(learner)/vocabulary/page.tsx`         | Page (server component)                |
| `src/components/vocabulary/word-audio.tsx`      | Provider-independent audio player      |
| `src/app/(learner)/learn/[lessonId]/page.tsx`   | Entry link                             |
| `src/app/(learner)/progress/page.tsx`           | Entry link                             |
| `tests/unit/vocabulary-search.test.ts`          | Search unit tests                      |
| `tests/unit/word-audio.test.tsx`                | Audio component tests                  |
| `tests/integration/vocabulary-explorer.test.ts` | Access rules against a real database   |
| `tests/e2e/vocabulary-explorer.spec.ts`         | Browser journey, axe in light and dark |

Files that the open PRs (#34, #46 to #53) change were deliberately left alone.

## Queries

There is one `hSKLevel.findMany`. Then comes `getLessonStatesForLevel` once per published level,
which is one HSK 1 level today. Finally a lesson query and a vocabulary query run in parallel.
There are no per-lesson or per-word round trips. HSK 1 Starter has 81 words, so the page needs no
pagination. If a curriculum ever exceeds a few hundred words per learner, add server-side
pagination with the same entitled list.

## Behaviour worth knowing

- **One word, one card.** A word that more than one reached lesson teaches is listed once, under
  the first of those lessons. Filtering by any of those lessons still shows it, under the lesson
  chosen, so a lesson's filter always lists every word that lesson teaches.
- **Other curricula.** Words from every published curriculum the learner has reached are listed.
  Today there is one.
- **Unpublishing.** Unpublishing a reached lesson removes it, and nothing is attributed to it any
  more. The existing lesson-state rules then decide what opens next. This is tested.

## Verified

The checks below ran on 2026-11-27 against the local dev server, as a learner who had reached
lesson 1 only:

- 320 px dark, 375 px light and 430 px light: no horizontal scroll, and no text below WCAG AA
  contrast (computed).
- The labels are bound, the form has a search landmark, and the Hanzi has `lang="zh"`.
- Search:

  | Query or filter      | Result      |
  | -------------------- | ----------- |
  | `ni hao`             | 你好        |
  | `hello`              | 你好        |
  | `你`                 | 你 and 你好 |
  | `xiexie`             | none        |
  | `谢谢`               | none        |
  | a locked lesson's id | none        |

- A signed-out visitor is redirected to `/login`.

For the automated tests, see the PR description.

## Learning-path trail (Anesu's work): integration note

No branch of Anesu's for the learning-path trail was present when this was written, so nothing
of hers was read, copied or modified.

- **Shared source of truth.** The explorer and `/learn` both read `getLessonStatesForLevel`. If
  the trail changes how states are computed, the explorer follows automatically. If it only
  changes `/learn`'s presentation, there is nothing to reconcile.
- **Files.** This branch doesn't touch `/learn` (`src/app/(learner)/learn/page.tsx`). It adds one
  link to the lesson overview `/learn/[lessonId]/page.tsx` beside the "Words" heading. If the
  trail edits that file, expect a small, mechanical conflict there.
- **Possible hook.** A trail node could link to `/vocabulary?lesson=<lessonId>` ("words in this
  lesson") for reached lessons. That needs no API.
- **Don't** compute reachability separately in the trail for vocabulary purposes. Reuse the lesson
  states, so the two can't disagree.

## HSK 1 Starter content audit (report only)

This audit covers `content/hsk1-starter.json`. Nothing was changed. All content is PROVISIONAL.
Where a finding is a matter of convention, deciding it is a teacher's job.

**Structure** (`npm run content:validate`, 2026-11-27): passed, with 0 errors.

- 6 units, 16 lessons, 81 words and 102 characters.
- No missing pinyin, meanings or parts of speech.
- No duplicate words.
- No character used in a word without being defined, and no defined character that is unused.
- No stray whitespace and no tone digits.
- Every single-character word's pinyin matches its character entry.

**Existing warnings:**

- Two lessons have 9 new characters (`units.1.lessons.2` and `units.5.lessons.0`; suggested at
  most 8).
- 朋 and 友 share the gloss "friend".

**For a reviewer to decide:**

1. **Pinyin word spacing.**
   - Spaced: "nǐ hǎo", "bú kèqi", "méi guānxi".
   - Joined: "duìbuqǐ", "xièxie", and the other 35 multi-character entries.
   - This may follow word-boundary rules (GB/T 16159) on purpose. Confirm the convention. Search
     ignores spacing either way.
2. **Tone marking policy.**
   - 不客气 is written with the sandhi tone, "bú".
   - 你好 is written with citation tones, "nǐ hǎo", not "ní hǎo".
   - 对不起 shows 不 in the neutral tone, "duìbuqǐ".
   - This is a common dictionary practice, but it should be a stated policy, because learners see
     it and audio would have to match it.
3. **Character-level variants.**
   - 谁 has "shéi", with "shuí" as an alternative.
   - 子 has "zǐ", with "zi" as an alternative (neutral in 儿子).
   - 兴 has "xìng", with "xīng" as an alternative.
   - These are declared as alternatives, which is fine. Check them against the chosen reference.
4. **Provenance gap (known).** The source says the "list document [was] not recorded", so no HSK
   level membership can be claimed (D-060). `hsk20Level` and `hsk30Level` stay null.
5. **Gaps:**
   - 0 of 81 words have an example sentence. The file format has no example field for words yet.
   - 0 of 81 words have audio.
   - 你好 is marked as not being a separate HSK list entry, which is accurate as recorded.
6. **Glosses** read plausibly for a starter course. No gloss looked wrong on a structural read.
   Linguistic accuracy still needs the qualified reviewer (`curriculum:review`, D-075).

None of this was corrected or filled in, and no examples, pinyin or audio were invented.
