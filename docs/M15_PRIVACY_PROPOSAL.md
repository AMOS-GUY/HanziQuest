# M15 privacy notice proposal (for the owner's review: NOT applied)

Nothing in the app's privacy notice or `LEGAL_VERSION` has changed. The learning measurement page
stays off (`LEARNING_ANALYTICS`) until the owner decides on both points below.

## Why a change is proposed

- **What the notice says today:** practice history is used "to grade your writing, track your
  progress, schedule reviews, and improve the handwriting checker".
- **The new purpose:** M15 combines practice history across learners into aggregate statistics,
  to see whether the app helps people learn. That isn't one of the listed purposes.
- **What M15 doesn't do:** collect new data, add trackers or third parties, or show anyone's
  individual results to staff.

## Proposed wording

Add a row to the "What we keep and why" table, after "Practice history":

| What                                                     | Why                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The same practice history, combined across many learners | To see whether HanziQuest helps people learn: for example, how often reviews are remembered and how many people come back after a week. Staff see only totals for groups of at least five learners who signed up in the same week, never an individual's results. Staff and test accounts aren't included. Deleting your account removes you from these figures. |

Optionally, add one sentence under "Your choices": "These statistics use only what the app
already keeps for your learning; nothing extra is collected, and nothing leaves HanziQuest."

## LEGAL_VERSION

The recommendation is to bump it, for example to `2026-11-beta-draft-2`. A new purpose for
existing data is a material change, and CLAUDE.md asks for a bump on material changes.
Consequences:

- Learners are asked to accept the updated terms and notice, through the existing flow.

That is a legal judgment for the owner.

## Owner decisions

1. Approve or change the wording above.
2. Whether to bump `LEGAL_VERSION` (recommended).
3. Then turn on `LEARNING_ANALYTICS` where wanted (staging first).
4. Whether to wire the suppressed overview figures (`features/measurement/overview.ts`) into the
   admin overview (recommended; they only remove disclosure).
5. Keep k = 5, or choose a larger k.
