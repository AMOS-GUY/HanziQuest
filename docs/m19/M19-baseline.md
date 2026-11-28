# M19 baseline: learner experience quality

Recorded 2026-11-28.

## Starting point

| Item       | State                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `main`     | `4193d91` (#57, M18), CI green                                                                                                          |
| Branch     | `feature/m19-learner-experience-quality` from `4193d91`. Not based on any open PR.                                                      |
| M18 review | Done. Its fixes are in **#58** (`fix/m18-review`), open and not merged. The review found no critical security issue, so M19 went ahead. |
| #48        | Open. It conflicts with `main` in `DECISIONS.md` only (D-084 against D-085).                                                            |
| #54        | Open, CLEAN                                                                                                                             |

## Files avoided because open PRs change them

| File                                                                              | PRs           |
| --------------------------------------------------------------------------------- | ------------- |
| `components/lessons/practice-runner.tsx`                                          | #49, #52, #58 |
| `(learner)/home/page.tsx`, `features/progress/queries.ts`                         | #52           |
| `(learner)/learn/[lessonId]`, `progress`, `vocabulary/*`                          | #54, #49      |
| `components/navigation/learner-nav.tsx`, `practice-hub.tsx`, `(learner)/practice` | #51           |

So the practice runner's feedback and end screens, Home, the lesson overview, Progress and the
Vocabulary Explorer were **audited but not changed**. Their findings are listed as such.

## Architecture and design system (as found)

- **Stack and rendering:** Next.js 16 App Router. Most pages are server-rendered. Interactive
  parts are client components.
- **UI primitives:** written in the repo (D-002): `components/ui/*`, with `Button` variants,
  `Card`, `Choice`, `Input`, `ProgressBar`, `Alert` and `Badge`.
- **Theme:** CSS tokens in `app/globals.css`, with dark mode via `prefers-color-scheme`.
- **Chinese text:** a CJK font stack through `lang="zh"` and the `.hanzi` class.
- **Motion:** framer-motion, using `useReducedMotion` in the onboarding steps.
- **Existing accessibility tests:** `tests/e2e/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA)
  on learner, public and admin pages, in light and dark, on desktop and mobile.

## Method

- **Account:** a new local learner was registered (credentials only in the git-ignored `.local/`)
  and went through onboarding, placement, Home, the learning path, a character page, character
  practice, Review, Profile, Feedback, Offline and the public pages.
- **Viewports:** 360×780, 375×667, 390×844, 430, 768×1024 (tablet) and desktop, light and dark.
- **Per-page script:** horizontal overflow, interactive targets under 24 px, unlabelled controls,
  nameless buttons, Chinese text without `lang`, and computed text contrast.
- **By hand:** keyboard behaviour, focus after each step, ARIA roles and live regions, canvas
  labelling and `touch-action`.
