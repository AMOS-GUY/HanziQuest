# M19 findings

**Severity:** P1 is high, P2 medium, P3 low. **No P0 or P1 was found**, and nothing touched
security, progression or data integrity.

## Fixed

| ID   | Sev.             | Finding                                                                                                                                              | Evidence (before)                                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                           |
| ---- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | P2               | The landing page's "Join the quest" is below the first screen on small phones                                                                        | 360×780: the button top was at y 784 (fold 780). 375×667 was worse. The 260 px hero logo filled the screen.                                                                   | The hero logo is 144 px on phones and 260 px from `sm`, with tighter mobile spacing. After: the button bottom is at 688 on 360×780 and 636 on 375×667.                                                                                                                                        |
| F-02 | P3               | Form fields with a hint point `aria-describedby` at the hint even when the error replaces it                                                         | Password after a failed submit: `aria-describedby="password-error password-hint"`, and `#password-hint` doesn't exist                                                         | Reference the hint only when it's rendered (`FormField`)                                                                                                                                                                                                                                      |
| F-03 | P2               | Onboarding and placement radio groups don't follow the ARIA radio pattern                                                                            | Every option was a separate tab stop, and the arrow keys did nothing                                                                                                          | `Choice` (radio): one tab stop (the selected option, else the first). Arrows, Home and End move and select. Checkboxes are unchanged.                                                                                                                                                         |
| F-04 | P2               | Multi-step flows don't move focus, so screen-reader users aren't told the question changed                                                           | Onboarding: focus stayed on Continue. Placement: on Next, and "Question N of M" wasn't announced.                                                                             | `useFocusOnChange`, a callback ref: focus goes to the new step's heading, and the placement heading includes "Question N of M". The first attempt, an effect, focused the old heading during AnimatePresence's exit and dropped focus to the body. The callback ref fixes that and is tested. |
| F-05 | P2               | "Delete my account permanently" looks like the main action (green primary), and shows "Saving…" while deleting                                       | Profile, in the danger card                                                                                                                                                   | `AdminForm` gets `submitVariant="danger"` and `pendingLabel="Deleting…"`, used by Profile. Other forms are unchanged.                                                                                                                                                                         |
| F-06 | P2               | The `danger` button is unreadable in dark mode (latent: first used by F-05)                                                                          | White on `#ff8a80`: 2.28:1                                                                                                                                                    | A `--danger-foreground` token: white in light mode (5.72:1), `#0d1f1c` in dark mode (7.48:1)                                                                                                                                                                                                  |
| F-07 | P3               | Small touch targets: the mobile header's "Feedback" and "Admin", the public header's "Join the beta", and the footer's Beta guide, Privacy and Terms | 20 px tall                                                                                                                                                                    | The headers are 44 px, the footer at least 24 px (padding only)                                                                                                                                                                                                                               |
| F-08 | P2 (reliability) | `disputes.spec.ts` was flaky (it failed once and passed on retry in both M18 local runs)                                                             | It took `.first()` of the reason text, which can be another run's dispute; and it navigated straight after deciding, which can cancel the server action. 5 repeats: 4 failed. | Select this run's dispute by its id (`latestDisputeId`), and wait for the decision before navigating. 5 repeats: 5 passed. Test only.                                                                                                                                                         |
| F-09 | P3               | The hero logo repeats "HanziQuest" as alt text next to the header logo                                                                               | Two images named "HanziQuest"                                                                                                                                                 | `Logo` takes an optional `alt`, and the hero uses `alt=""` (decorative)                                                                                                                                                                                                                       |

## Not fixed

| ID   | Sev. | Finding                                                                                                     | Why                                                                                                                                                 |
| ---- | ---- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-01 | P2   | Practice pages (`/practice/*`) have no `<h1>`                                                               | **Open PR #49** fixes exactly this                                                                                                                  |
| N-02 | P3   | The handwriting canvas has no keyboard equivalent                                                           | Inherent to handwriting. **Skip** is the documented alternative (D-019). The canvas is labelled, uses `touch-action: none`, and shows instructions. |
| N-03 | P3   | The dispute queue shows only the 20 oldest open disputes, so the e2e test assumes its dispute is among them | True on CI's fresh database. A long-lived local database with more than 20 leftover open disputes could still hide it. Not a product bug.           |
| N-04 | —    | Practice runner feedback, end screen, Home, lesson overview, Progress, Vocabulary                           | Audited: no overflow, contrast or labelling defects found at 360 to 430 px. Not changed because of open PRs (see the baseline).                     |

## Audited with no defect found

- Registration: labels, `autocomplete`, errors linked with focus to the first invalid field.
- Login.
- The onboarding copy.
- Placement flow and result.
- Home, the learning path, Review and the empty review state.
- The character page with the stroke-order player.
- The guided quiz: `role="application"`, a label, and a live stroke counter.
- The freehand canvas: `role="img"`, a label, `touch-action: none`.
- Feedback, Offline, the beta guide.
- Tablet and desktop layouts.
- No horizontal overflow and no low-contrast text on any audited page, in light or dark.

## Performance

No change was made.

- No bottleneck was observed during the audit: page loads in local dev were quick, and there were
  no repeated requests.
- Nothing was measured beyond that, so this doc claims no performance improvement.
