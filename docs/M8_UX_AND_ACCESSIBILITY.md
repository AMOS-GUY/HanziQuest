# M8 learner experience and accessibility (2026-11-11)

Branch: `feature/m8-experience` (built on M7). The approach was to measure first, then fix
what the measurements and a code review of the writing flow found. Working screens were not
redesigned. The emerald brand, logo assets, typography and component library are unchanged.

## Measured baseline

New automated check: `tests/e2e/accessibility.spec.ts`.

- It runs [axe-core](https://github.com/dequelabs/axe-core) (WCAG 2.0/2.1 A and AA rules) on
  20 learner and public pages in light **and** dark mode, on desktop Chrome and on Pixel 7
  emulation.
- It also checks every page for horizontal overflow.

Before the fixes, 4 distinct violations were found. There was no overflow at desktop or
Pixel 7 width.

| Page     | Rule                               | Cause                                                                                                                                              | Fix                                                                                                   |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Home     | color-contrast (light)             | Accent-card text at 80% opacity                                                                                                                    | Full-strength `text-accent-foreground` (Home and Review)                                              |
| Learn    | color-contrast (light and dark)    | Locked lessons faded the whole card to 60% opacity                                                                                                 | Locked lessons use a dashed border and a muted background instead; text keeps full contrast           |
| Learn    | label-content-name-mismatch (both) | Lesson links had an `aria-label` ("Title, Start") that hid the visible text and disagreed with it: the card said "Up next", the label said "Start" | Removed the label. The accessible name is now the visible content (title, state, characters, counts). |
| Progress | color-contrast (light)             | Unearned achievements at 70% opacity                                                                                                               | Same treatment as locked lessons                                                                      |

After the fixes, **0 violations on all 20 pages, in both themes, on both projects.**

The heading structure on Learn was also fixed. With more than one curriculum it had several
`h1`s; it now has one page `h1`, curricula as `h2`, units as `h3` and lessons as `h4`.

axe finds only what can be detected automatically. Focus order, wording, and the experience
with a real screen reader or switch device still need a manual check, which hasn't been done.

## Handwriting and writing flow

| Problem found in review                                                                                                                                                                | Change                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Palm rejection:** a palm touching first blocked the stylus, and touches during pen writing added stray strokes.                                                                      | Once a stylus is used, touch input is ignored on that canvas. A pen landing during a touch stroke replaces it.              |
| **Cancelled gestures** (the OS took the pointer) were saved as partial strokes.                                                                                                        | They are discarded.                                                                                                         |
| `setPointerCapture` could throw for a pointer that had already ended, and abort the stroke.                                                                                            | Guarded.                                                                                                                    |
| **Landscape phones:** the square canvas (up to 28rem) was taller than the screen, so **Check** was off-screen while writing.                                                           | The canvas is capped at `max(16rem, 100dvh − 19rem)`. It stays at least 16rem so small screens don't lose writing accuracy. |
| **Keyboard and screen readers:** pressing **Check** removed the focused button, so focus fell to the page and the result wasn't announced. The next exercise didn't move focus either. | Focus moves to the result group after Check, and to the prompt for each new exercise or retry.                              |
| Multi-character words used `role="tab"` without tab panels or arrow keys.                                                                                                              | Replaced by a labelled group of toggle buttons (`aria-pressed`).                                                            |
| Learners found out that a hint turns an attempt into guided practice only _after_ using one.                                                                                           | The note is shown before, and changes once a hint is used.                                                                  |
| No feedback while drawing.                                                                                                                                                             | A stroke counter under the canvas ("3 strokes"); before the first stroke it says "Write with your finger, stylus or mouse". |
| The hint's ghost character was very faint (15%).                                                                                                                                       | 20%. It is still clearly a hint, and easier to see on dark backgrounds.                                                     |
| Practice pages (the heaviest: stroke data and references) had no loading state.                                                                                                        | A practice-shaped skeleton ("Preparing your exercises…"), static under reduced motion.                                      |

Unchanged and verified:

- `touch-action: none` on the canvas and its wrapper, so drawing never scrolls or zooms.
- Pointer Events with coalesced points and high-DPI rendering.
- Undo, Clear and Check are disabled when there is nothing to act on.
- Reduced motion is respected: Framer Motion's `useReducedMotion` plus the global CSS rule.

## Progress: recall, technique and guided practice

The Progress page has a new **"How you write"** section using M7's `skillTotals`:

- the recall rate on independent attempts
- the stroke order and direction rate on recalled characters
- the number of guided (traced or hinted) attempts, labelled as not counting towards recall

It says plainly that only writing from memory counts towards mastery.

## Tests added

- `tests/e2e/accessibility.spec.ts`: 4 runs (light/dark × desktop/mobile) over 20 pages,
  covering axe WCAG A/AA and horizontal overflow.
- `tests/e2e/writing-experience.spec.ts`:
  - touch, mouse and stylus input; cancelled gestures; palm rejection; Undo, Clear and
    disabled states; the hint notice
  - keyboard focus after Check and Retry
  - landscape phone (740×360): the canvas fits and Check is reachable
  - 320 px phone: no horizontal scroll, and the canvas stays at least 250 px wide
- Updated: `learning-journey.spec.ts` now finds lessons by their visible text. The e2e writing
  helper uses the new toggle group.

## Screenshots

Taken from the production build with `SCREENSHOTS=1 npx playwright test screenshots`. They are
in `docs/screenshots/`: desktop in light mode, and Pixel 7 emulation in dark mode, for Home,
Learn, Writing, Result and Progress. They are emulator captures, not photos of physical
devices.

## Not done or not verified

- **Physical devices and real styluses** (iPad with Apple Pencil, Android with S Pen) are
  untested. Palm rejection was tested with synthetic pointer events only.
- **Firefox:** Playwright's Firefox can't start on this machine.
- **Manual screen-reader pass** (VoiceOver, TalkBack, NVDA) hasn't been done.
- The admin area wasn't part of the axe run. It is staff-only and desktop-first; worth adding
  later.
