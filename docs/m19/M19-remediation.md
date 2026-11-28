# M19 remediation

Each change is tied to a finding in `M19-findings.md`. Protected areas weren't touched: XP,
mastery, review scheduling, streaks, achievements, completion, unlocking, placement scoring,
progression enforcement (D-084, D-085), authentication and authorization, schemas and
migrations, offline sync, content, analytics privacy and deployment.

| Finding                  | Files                                                                                                                                                                                                                                                      | Tests                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| F-01 landing CTA         | `app/page.tsx` (hero logo `size-36 sm:size-[260px]`, mobile spacing)                                                                                                                                                                                       | e2e `learner-polish.spec.ts` "F-01": the CTA bottom is within 375×667 and 360×780, with no overflow |
| F-02 describedby         | `components/forms/form-field.tsx`                                                                                                                                                                                                                          | unit `form-field.test.tsx` (3). It fails on the old code.                                           |
| F-03 radio pattern       | `components/ui/choice.tsx` (a roving `tabIndex` set after each render, plus arrow, Home and End handling, inside `[role=radiogroup]`)                                                                                                                      | unit `choice.test.tsx` (5); e2e "F-03/F-04"                                                         |
| F-04 focus per step      | `components/ui/use-focus-on-change.ts` (new), `(onboarding)/onboarding/onboarding-flow.tsx`, `(onboarding)/placement/placement-quiz.tsx` (headings get `tabIndex={-1}`; placement heading includes "Question N of M", the visual counter is `aria-hidden`) | unit `use-focus-on-change.test.tsx` (4, including the remounting case); e2e "F-03/F-04"             |
| F-05 destructive styling | `components/admin/admin-form.tsx` (`submitVariant`, `pendingLabel`, defaults unchanged), `(learner)/profile/page.tsx`                                                                                                                                      | e2e "F-05/F-06"                                                                                     |
| F-06 danger contrast     | `app/globals.css` (`--danger-foreground`), `components/ui/button.tsx`                                                                                                                                                                                      | e2e "F-05/F-06" (axe colour contrast in light and dark)                                             |
| F-07 targets             | `(learner)/layout.tsx`, `(public)/layout.tsx`, `components/brand/site-footer.tsx`                                                                                                                                                                          | e2e "F-07" (mobile)                                                                                 |
| F-08 flaky e2e           | `tests/e2e/disputes.spec.ts`, `tests/e2e/helpers.ts` (`latestDisputeId`)                                                                                                                                                                                   | 5 repeats: 5 pass (before: 4 of 5 failed)                                                           |
| F-09 duplicate alt       | `components/brand/logo.tsx` (optional `alt`), `app/page.tsx`                                                                                                                                                                                               | existing `auth-journey` still finds the header logo                                                 |

## Compatibility

- `Choice`'s props are unchanged. The existing e2e helpers, which click options and wait for
  `aria-checked`, still pass (`first-run`, `auth-journey`, `accessibility`).
- `AdminForm`'s new props are optional, and every admin form keeps `primary` and "Saving…".
- `Logo` defaults to its old alt text.
