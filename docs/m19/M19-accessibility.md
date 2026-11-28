# M19 accessibility notes

**This is not a WCAG conformance claim.**

- The automated part (axe, WCAG 2.1 A and AA) covers what can be detected automatically. The
  per-page script adds target size, labelling, `lang` and contrast checks. Keyboard and focus
  behaviour were checked by hand in the browser and pinned by tests.
- Screen-reader output wasn't tested with a real screen reader (NVDA, VoiceOver). Announcements
  are inferred from roles, names and focus.

## Improved

- **Radio groups** (onboarding, placement): the ARIA radio-group keyboard pattern (F-03).
- **Multi-step flows:** focus moves to each new question's heading, and placement announces
  "Question N of M" (F-04).
- **Destructive action:** distinct styling and a correct pending label (F-05). Dark-mode contrast
  goes from 2.28 to 7.48 (F-06).
- **Form errors:** no dangling `aria-describedby` (F-02).
- **Touch targets:** at least 24 px for footer links and 44 px for header links (F-07, WCAG 2.2
  target size).
- **Decorative logo** isn't announced twice (F-09).

## Checked and already fine

- **Labels:** every audited input has a label, and every button and link an accessible name.
- **Errors:** registration sets `aria-invalid`, links its errors, and moves focus to the first
  invalid field.
- **Chinese text:** carries `lang="zh"` everywhere audited.
- **Handwriting:**
  - the guided quiz is `role="application"`, with a label and a live stroke count;
  - the freehand canvas is `role="img"` with a label and `touch-action: none`;
  - Skip is the alternative for learners who can't draw (D-019).
- **Reduced motion:** onboarding transitions use `useReducedMotion`.
- **Contrast:** no failing text contrast on any audited page, light or dark, at 360 to 430 px,
  tablet and desktop.

## Remaining limitations

- **Practice pages have no `<h1>`.** Open PR #49 fixes this.
- **No real screen-reader pass.** One is recommended before launch.
- **The canvas has no keyboard way to write.** That's inherent; Skip is the alternative.
- **The practice runner's feedback and end screens weren't changed in M19** (open PR overlap).
  Their audit found no defect.
