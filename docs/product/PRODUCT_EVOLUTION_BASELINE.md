# Product evolution: baseline (2026-11-27)

Everything here was checked directly in the repository, through the GitHub API (unauthenticated,
read-only), and in a local development build with a synthetic test learner. Nothing was checked
on staging or production.

> **Status update (2026-11-27, later the same day):** `gh` was then logged in. PRs #45–#53 were
> opened for the branches below, alongside #34; none is merged. The tables below record the state
> **before** that. Live state: `gh pr list`.

## Repository

| Item              | State                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `main`            | `d3042e8` (#44 session-start race fix)                                                               |
| CI on `main`      | `docker` passes. **`verify` fails** at "Dependency audit (production, high+)": the `effect` advisory |
| Branch protection | **None.** No branch protection and no rulesets (API: `protected: false`, `rulesets: []`)             |
| GitHub CLI        | Installed, not logged in, so no PRs can be opened from this machine                                  |

**Stabilization work:**

| Item                                                            | Branch                                  | State                                                  |
| --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| Session-start race fix                                          | `fix/session-start-race`                | **Merged** (#44)                                       |
| E2E landing CTA                                                 | `fix/e2e-landing-cta`                   | **Merged** (#43)                                       |
| Restore after #35, practice hub, watch-first, contributor guide |                                         | **Merged** (#39–#42)                                   |
| Dependency fix (eslint 9, scoped `effect` override)             | `fix/eslint-9-peer-range`               | Not merged, no PR. **`main` stays red until it lands** |
| M13 docs consistency follow-up                                  | `docs/m13-consistency-followup`         | Not merged, no PR                                      |
| M13 toolkit                                                     | `feature/m13-analysis-toolkit`          | **PR #34 open**                                        |
| Toolkit exploratory label                                       | `feature/m13-toolkit-exploratory-label` | Not merged; stacked on #34                             |
| Empty-lesson completion fix (D-084)                             | `fix/empty-lesson-completion`           | Not merged, no PR                                      |
| Accessibility headings                                          | `fix/a11y-page-headings`                | Not merged, no PR                                      |
| Governance (protection proposal, CONTRIBUTING roles)            | `docs/governance-update`                | Not merged, no PR. Rulesets inactive                   |

**Collaborator branch:** `feature/quiz-logic` (Anesu) is unchanged at `e015e33`. It is not to be
merged as is (review: `.local/REVIEW-for-Anesu-quiz-logic.md`).

## What the product has today (don't duplicate)

**Learner:**

- landing, registration (open in development, invite-only in production), login;
- onboarding: experience, HSK history, goals, daily goal, placement or start;
- Home: next lesson, daily goal and streak, review status;
- learning path (`/learn`): locked, available and completed states;
- lesson overview: characters and words, tap to watch stroke order;
- practice runner: pinyin-to-hanzi, meaning-to-hanzi, guided strokes with "watch the strokes",
  and free writing with server grading;
- the completion screen: XP, rewards, results summary, next lesson;
- Review: due count, rounds, forecast, empty states;
- Progress: totals, 14 days, characters by mastery level, skills, achievements;
- word and character pages, offline download and sync, feedback, handwriting disputes.

**Admin:**

- overview, curricula, lessons, characters, vocabulary;
- content quality, content review, import;
- handwriting lab and disputes;
- feedback, invites, users, operations, audit log.

**Engine (protected):**

- server handwriting grading (`hq-eval-1`);
- XP and daily goal, streaks, achievements;
- mastery levels (NEW, LEARNING, FAMILIAR, MASTERED), replayed from attempts;
- SM-2-style review scheduling;
- placement test-out;
- progression locks.

## Curriculum data

`content/hsk1-starter.json`:

- 6 units, 16 lessons, 102 characters, 81 words, all **PROVISIONAL** (no teacher review);
- **no audio:** 0 audio URLs.

The importer generates four exercise types: pinyin-to-hanzi, meaning-to-hanzi, guided stroke and
free writing. `CHARACTER_RECONSTRUCTION` and `LISTENING_TO_WRITING` exist in the schema but no
content uses them. **Listening and pronunciation practice need real audio first.**

## Architectural constraints

- Business rules live in `src/features/*` services, and pages only render.
- Authorization is server-side (`requireUser`, `requirePagePermission`).
- XP, mastery and streaks are server-authoritative.
- Curriculum is data.
- The `(practice)` route group is a focused, navigation-free layout for sessions.
- Design tokens are in `globals.css` (BRANDING.md).
- The CSP forbids inline scripts and framing.

## UX gaps found (details in PRODUCT_EVOLUTION_REPORT.md)

1. **The practice hub can't be reached.** No link points to it, and it has no app navigation.
2. **Home doesn't say what has been learned, or what to work towards.**
3. **The lesson completion screen doesn't connect to Review.**
4. **There's no word-list page** (`/vocabulary` has no index).
5. **Four pages have no `<h1>`.** Fixed on `fix/a11y-page-headings`, not merged.
6. **No listening or pronunciation**, because there's no audio content.

## Outstanding risks

- `main` CI is red, and branch protection is off.
- All content is provisional.
- Handwriting accuracy is unvalidated on real learners.
