# Frontend work package: the learning-path "trail" (for Anesu)

A suggestion for Amos to discuss with Anesu. It hasn't been assigned or sent to anyone.

## Objective

Make `/learn` feel like a **journey**, the HanziQuest trail:

- learners should see at a glance where they are, what's next and what they've completed;
- and want to take the next step.

Today it's a clear but plain list.

This builds on your quest voice ("A clear trail", "Join the quest") and your practice-hub design.
The visual direction is yours: path, map, stepping stones, or something else.

## Why this one

- **It's high-value:** the learning path is the product's spine.
- **It's purely presentational:** all data comes from the server already.
- **It doesn't overlap any open branch:** no open branch touches `src/app/(learner)/learn/` or
  its components. That was checked on 2026-11-27.

## Where

| File                               | Role                                                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/(learner)/learn/page.tsx` | The page. It calls `getLearnerPath(user.id)` on the server, which gives curricula → levels → units → lessons, each with a `LessonState`, plus `next`, `completed` and `total` |
| New components                     | Under `src/components/learn/` (for example `trail.tsx`, `trail-lesson.tsx`)                                                                                                   |
| Reuse                              | `Badge`, `ProgressBar`, `Card`, `Button` and the `cn` helper; tokens from `globals.css` (`docs/BRANDING.md`)                                                                  |

**The data you get:** each lesson's `LessonState` is one of `LOCKED`, `AVAILABLE`,
`IN_PROGRESS`, `COMPLETED` or `TESTED_OUT`. Show it; never compute it.

## Acceptance criteria

1. **Same data, new presentation:**
   - every lesson, unit and state the current page shows is still shown;
   - the `next` lesson is unmistakable, with one clear "continue" action;
   - the curriculum's "Provisional content" and edition labels stay visible.
2. **States are distinct without relying on colour alone:** icon or text for locked, available,
   in progress, completed and tested out.
3. **Locked lessons aren't links,** exactly as today. The trail must never let a learner jump
   ahead.
4. **Mobile first:**
   - works at 320, 375, 390 and 430 px;
   - no horizontal scrolling, readable text, tap targets of 44 px or more.
5. **Accessibility:**
   - one `<h1>`, and a list structure for lessons;
   - each lesson's link names its state (the e2e test reads names like
     `1. Saying hello … Completed`);
   - keyboard focus is visible;
   - contrast of 4.5:1 or more in light **and** dark.
6. **Motion:** optional and subtle, and it respects reduced motion (`useReducedMotion`, or
   `MotionConfig reducedMotion="user"`).
7. **Tests:**
   - `tests/e2e/learning-journey.spec.ts` and `tests/e2e/accessibility.spec.ts` pass unchanged,
     or are updated only where a visible label changes, with a note in the PR.
   - `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
     all pass.
8. **The PR** has screenshots: mobile and desktop, light and dark.

## Protected areas (don't change; ask first)

- **Learning logic:**
  - `getLearnerPath`, `getLessonStatesForLevel` and anything else in `src/features/*`;
  - which lessons are locked;
  - XP, streaks, mastery, review and grading.
- **Auth and data:** auth, `src/proxy.ts`, `prisma.config.ts`, the Prisma schema and migrations.
- **Content:** curriculum content (`content/*.json`). Don't hardcode lessons or characters.
- **New dependencies,** including UI libraries: discuss first.

**Design is yours** (layout, illustration, motion, copy tone). **Logic stays on the server.**

## How to work

1. Branch `feature/learning-path-trail` from `main`.
2. Open a draft PR early with a screenshot or sketch, so Amos (or Claude, on request) can give
   feedback before the details.
3. Run the real app locally: `npm run db:local`, `npm run db:seed`, register at `/register`.
   **No fake data.**
4. Ask for a review when it's ready. Amos merges.

## Related ideas from your earlier work (optional, separate PRs)

- **The "Draw this meaning" prompt animation** in the practice runner.
- **A session XP counter.**

Both are described in `.local/REVIEW-for-Anesu-quiz-logic.md`. The practice runner is also
touched by open branches, so coordinate before starting either of them.
