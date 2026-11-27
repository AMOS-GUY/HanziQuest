# Product evolution report (2026-11-27)

## 1. Baseline

See PRODUCT_EVOLUTION_BASELINE.md.

- `main` is `d3042e8`.
- **`verify` is red** (the `effect` audit), and `docker` passes.
- **There's no branch protection.**
- **Merged:** the session race fix (#44) and the e2e CTA fix (#43).
- **Not merged:** the dependency fix, the M13 docs follow-up, the toolkit (#34) and its label, the
  empty-lesson fix, the accessibility headings, and the governance branch.

## 2. Audit findings

The audit ran with a synthetic local learner, on the DISCOVER → LEARN → PRACTICE → RECALL →
FEEDBACK → REVIEW → MASTER → PROGRESS loop.

| Stage    | Today                                                                                             | Gap                                                              |
| -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Discover | The learning path shows units, lessons and states; Home shows the next lesson                     | The path is a plain list (a design opportunity, handed to Anesu) |
| Learn    | The lesson overview shows characters, words, pinyin and meaning, and you can tap to watch strokes | **No audio:** 0 audio URLs, so no pronunciation                  |
| Practice | Pinyin/meaning-to-hanzi, guided strokes (with watch-first), free writing                          | **The practice hub can't be reached** (no link, no navigation)   |
| Recall   | Free writing is independent recall; hints turn it into guided practice (disclosed)                | —                                                                |
| Feedback | Server bands, specific feedback, disputes                                                         | —                                                                |
| Review   | Due count, rounds, forecast, clear empty states                                                   | **The completion screen doesn't connect to Review**              |
| Master   | Mastery levels exist (Progress page)                                                              | **Home doesn't show them**                                       |
| Progress | Daily goal, streak, Progress page, achievements                                                   | **Home doesn't say what you're working towards**                 |

**Other findings:**

- **No word list:** there's no `/vocabulary` index (tech debt M1).
- **Four pages without an `<h1>`:** fixed on `fix/a11y-page-headings`.
- **Fine at 320–430 px:** onboarding, Home and Review are already clear and work at these widths.

## 3. Product decisions

- **Fix the reachability and loop gaps first,** with existing data. No new learning mechanics.
- **Practice is a tab, not a duplicate of Home.** The hub keeps Anesu's design and links to the
  existing session pages.
- **Show mastery and achievements only from engine data,** with the Progress page's labels.
- **No listening or pronunciation UI** until real audio exists. Not built.
- **No word list in this mission.** It touches progression visibility, so it's proposed
  separately (M1).

## 4. Implemented improvements

| Branch                       | Commit      | What                                                                                                                                                                |
| ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/learner-navigation` | `4ff8f02`   | The Practice tab; the hub moves into the learner layout; equal-width bottom nav (fits 320 px); e2e                                                                  |
| `feature/home-learning-loop` | `7e9fd09`   | Home "Your learning" (engine mastery counts, next achievement); completion links to Review; `getNextAchievement` (read-only) and its integration test; e2e extended |
| `docs/product-evolution`     | this branch | Baseline, report, tech debt, Anesu task                                                                                                                             |

## 5. Architecture decisions

- **No new libraries or components:** `Card`, `Button` and `ProgressBar` were reused.
- **Data reads are server-side only:** one read-only query was added in `features/progress`.
- **The hub lives in `(learner)`;** sessions stay in `(practice)`. The two route groups share the
  `practice` segment, with different leaf paths.

## 6. Testing results

**Full local CI on all ten proposed branches merged in order (`a7aa8d8`): 25 PASS, 0 FAIL.**

| Area                                | Result                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| Unit                                | 331                                                       |
| Integration                         | 203                                                       |
| E2E (Chromium, desktop and Pixel 7) | 51 passed, 25 skipped by design                           |
| Also                                | Production build, migration and backup drills, smoke test |

**Not run:**

- **BLOCKED:** Docker (image build and container checks) and `age` (backup encryption).
- **NOT RUN:** Firefox (advisory).
- **GitHub Actions** (after the PRs were opened):
  - **#45 (dependency fix):** fully green, including `age` encryption, Firefox e2e and `docker`.
  - **The other PRs:** failed at the shared production audit (step 6), the issue #45 fixes, so
    GitHub hasn't yet run their own changes. Re-run their checks once #45 is merged.

**Manual browser checks** (local, synthetic learner):

- Practice tab at 320 px: six items × 53 px, no overflow.
- Desktop sidebar.
- Home at 390 px: the new learner's empty state and real next achievement.
- A signed-out visitor to `/practice` is redirected.
- Lesson practice still renders in the focused layout.

## 7. Accessibility

- **New sections are labelled:** a region named "Your learning", plus a list named "Characters
  by level".
- **`aria-current` on the Practice tab.**
- **Contrast:** uses existing tokens only, verified on 2026-11-26 at 4.5:1 or more.
- **Reduced motion:** the hub keeps `MotionConfig reducedMotion="user"`.
- **Headings:** `fix/a11y-page-headings` adds the missing `<h1>`s.

## 8. Security review

- **No auth, proxy, permission or database-guard changes.**
- **The hub now sits behind** the learner layout's sign-in, onboarding and terms checks, as well
  as its own.
- **The new query reads** only the signed-in learner's achievements.
- **No new client-side trust:** counts come from the server.

## 9. Technical debt

See PRODUCT_EVOLUTION_TECH_DEBT.md.

- **H1:** red `main` and no protection.
- **M1:** word list.
- **M2:** the admin 404 rewrite origin (needs owner approval).
- **M3:** 404 pages return 200.

## 10. Anesu work package

docs/collaboration/ANESU_PRODUCT_EVOLUTION_TASK.md: **the learning-path "trail"** for `/learn`.

- **Presentational only:** server data, with locked lessons never linked.
- **Requirements:** mobile and accessibility criteria, light and dark screenshots.
- **No overlap** with any open branch.

## 11. Owner decisions

1. **Merge the dependency fix,** which makes `main` green, then activate the rulesets
   (governance branch).
2. **Merge order** for the remaining branches (below).
3. **The word list (M1):** whether to add `/vocabulary` scoped to reached lessons.
4. **The admin 404 rewrite (M2):** whether to change `src/proxy.ts`.
5. **Audio:** sourcing it (licensing, and possibly cost) before any listening or pronunciation
   work.
6. **Whether to offer Anesu the trail task.**

**Suggested merge order:**

1. `fix/eslint-9-peer-range`
2. `docs/m13-consistency-followup`
3. #34, the toolkit
4. `feature/m13-toolkit-exploratory-label`
5. `fix/empty-lesson-completion`
6. `fix/a11y-page-headings`
7. `docs/governance-update`
8. `feature/learner-navigation`
9. `feature/home-learning-loop`
10. `docs/product-evolution`

## 12. Next recommended milestone

**"Words and sound": complete the LEARN stage with real content.**

- **Word list:** a `/vocabulary` index scoped to reached lessons (M1).
- **Audio:** licensed audio for HSK 1 Starter words (an owner sourcing decision), then
  pronunciation playback on word and lesson pages.
- **Content:** teacher review to move content beyond PROVISIONAL.
- **Design:** Anesu's learning-path trail, in parallel.

**Not in this milestone:** M13 human validation stays off until the independent statistical
review is done.
