# Handwriting disputes (M13, D-081)

A learner who thinks a handwriting result is wrong can say so. A reviewer looks at the writing
and records a finding.

**A dispute never changes anything about learning:** not the result, score, XP, mastery,
reviews, streak or the attempt itself. Findings are evidence for handwriting validation
(M13_VALIDATION_PROTOCOL.md), not corrections.

## Learner side

- **Where:** "Grading looks wrong?" under a handwriting result in practice. It's available once
  the attempt has been saved on the server; offline attempts become disputable after they sync.
- **What they choose:** one reason that fits the result. No free text.

  | Reason                                               | Offered when the result was  |
  | ---------------------------------------------------- | ---------------------------- |
  | I wrote the right character, but it was marked wrong | Needs improvement, Try again |
  | It was accepted, but I think I wrote it wrong        | Excellent, Good              |
  | The stroke order or direction feedback is wrong      | any graded result            |
  | My strokes weren't captured properly                 | any graded result            |

- **Consent:** each time, a checkbox: "A reviewer may look at this writing to check the result.
  It won't change your result or progress." It's required, and its time is recorded.
- **Limits:**
  - one dispute per attempt;
  - within 14 days of the attempt reaching the server;
  - 10 a day per learner.
- **Follow-up:** the profile lists the learner's disputes and their findings.

## Reviewer side

- **Who:** `handwriting:review-disputes`, held by Super Admins and Curriculum editors (who run the
  handwriting lab).
- **Where:** Admin → Disputes. Each dispute shows:
  - the learner's ink, drawn as written;
  - what the engine reported for each character (band, the character it resembled most, and its
    named findings);
  - the reason, the original result and the engine version.

  **No learner identifiers** are shown: no name, email or account id.

- **Lifecycle:**

  | Step                                                                 | Result            |
  | -------------------------------------------------------------------- | ----------------- |
  | Submitted                                                            | SUBMITTED         |
  | A reviewer claims it ("Review this")                                 | UNDER_REVIEW      |
  | The claimer releases it                                              | back to SUBMITTED |
  | The claimer records "The result was wrong" or "The result was right" | RESOLVED          |
  | The claimer records "Can't be judged from this writing"              | DISMISSED         |

- **Rules:**
  - Nobody reviews their own dispute, Super Admins included.
  - Only the claimer decides.
  - Decided disputes stay decided.
  - A claim whose reviewer's account was deleted, or that has been idle for 7 days, can be taken
    over by another reviewer, so nothing gets stuck.
  - Every step is one conditional database update, so two reviewers can't both claim, and a
    double click can't decide twice.

## Security and privacy

- **Ownership:** the attempt is looked up by its client event id **and** the signed-in learner.
  Another learner's attempt is indistinguishable from one that doesn't exist (404).
- **Server-side checks:**
  - Learners: the API checks the session, the origin (`handleApi`), the body size (2 KB) and the
    rate limit.
  - Reviewers: the actions check `handwriting:review-disputes`, and so does the service.
- **No free text anywhere:** learner reasons and reviewer outcomes are fixed codes. Unknown
  fields are rejected.
- **Data minimisation:**
  - The ink stays where it already is, on the attempt. Disputes store no copy.
  - Audit entries record the reason, original result, status and outcome. They contain no ink,
    no email and no learner name.
  - Failure logs record only the error type.
- **Account deletion:** a learner's disputes are deleted with their account (and the attempts and
  ink with them). Audit entries remain with the actor cleared, as for all audit entries. If a
  reviewer deletes their account, their findings stay, with the role recorded.
- **Retention:** disputes live as long as the attempt, which is as long as the account. A
  shorter retention for decided disputes is an owner decision; it isn't built.
- **Not validation samples:** disputes are self-selected, so they can't estimate accuracy. Using
  disputed ink as a validation sample would need the M12 per-person consent process. That's an
  owner decision and isn't built.

## Code

- `src/features/handwriting/disputes.ts` (service)
- `dispute-reasons.ts` (shared reasons and outcomes)
- `dispute-actions.ts` (reviewer actions)
- `src/app/api/disputes/route.ts`
- `src/app/admin/disputes/page.tsx`
- `src/components/feedback/dispute-result.tsx`
- Migration `m13_handwriting_disputes` (additive)
- Tests: `tests/unit/disputes.test.ts`, `tests/integration/disputes.test.ts`,
  `tests/e2e/disputes.spec.ts`
