# Bug reporting and triage (beta)

## How problems reach us

| Channel                                               | Who uses it                      | Where it lands                                                                       |
| ----------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| In-app **Feedback** (`/feedback`)                     | Learners                         | Admin → Feedback (status NEW). Page path, browser family and release attached.       |
| "Grading looks wrong? Tell us"                        | Learners, after writing feedback | Admin → Feedback with kind HANDWRITING                                               |
| Error boundary ("Something went wrong")               | Automatic                        | Server logs and Sentry/GlitchTip if configured. Users see a reference code to quote. |
| GitHub issues (templates in `.github/ISSUE_TEMPLATE`) | Team and invited testers         | Repository issues                                                                    |
| [security contact email]                              | Anyone                           | Private; never a public issue                                                        |

## Triage (daily during the beta)

1. Open **Admin → Feedback → new**. Staff with `feedback:manage` (Super Admin, Curriculum
   Editor, Moderator, Support) can do this.
2. For each item:
   - **Bug** → reproduce, then open a GitHub issue using the bug template (copy the message;
     **remove any personal data**). Set the feedback to _triaged_ and put the issue number in
     the note.
   - **Handwriting** → record the character and the problem. If the reporter agreed to
     contact, ask whether they'd join a lab session. Patterns feed
     `docs/HANDWRITING_VALIDATION.md`. Never change thresholds because of a single report.
   - **Content** → check against the source, fix it in Admin (revision and audit recorded),
     then set _resolved_.
   - **Idea** → label it for the roadmap and set _triaged_.
3. Set _resolved_ when fixed in a deployed release, and _closed_ for duplicates or
   won't-fix (add a note saying why).

## Severity and response targets

| Severity | Meaning                                              | Target                                                  |
| -------- | ---------------------------------------------------- | ------------------------------------------------------- |
| S1       | Data loss, security issue, or nobody can use the app | Start within 4 hours; consider rollback (DEPLOYMENT.md) |
| S2       | A main feature is broken, no workaround              | Fix in the next release (within 3 days)                 |
| S3       | Broken with a workaround                             | Schedule within 2 weeks                                 |
| S4       | Cosmetic or minor                                    | Backlog                                                 |

These targets are suggestions for a small team; adjust them to your capacity.

## Privacy

- The email of the person who sent feedback is shown only if they opted in, and only to staff.
- Don't paste learners' emails or messages into public issues; summarise instead.
- The error reference shown to users (`digest`) is enough to find the server log entry.
