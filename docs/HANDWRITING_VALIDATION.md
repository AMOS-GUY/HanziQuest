# Handwriting validation with real learners

The evaluation engine (`hq-eval-1`, see `HANDWRITING.md`) has so far been tested only on
**computer-generated ink**. That shows the code does what it was designed to do. It does not
show how accurate it is with real people's handwriting. This document is the procedure for
finding out, and the rules for changing thresholds based on what we find.

HanziQuest does **not** do general handwriting recognition. It checks whether a drawing matches
the expected character better than every other character in the candidate set (all characters
with stroke data, currently the 102 HSK 1 starter characters), then grades stroke count, order,
direction and shape. Guided (traced) practice uses Hanzi Writer and is outside this study.

## What we measure

Every sample is labelled with what the participant was asked to write (ground truth). The
engine's verdict is **accepted** when the band is Excellent or Good, the bands that count as a
successful independent recall for mastery and review scheduling.

| Metric                      | Definition                                                                   | Beta target |
| --------------------------- | ---------------------------------------------------------------------------- | ----------- |
| False rejection (FRR)       | Correctly written samples graded below Good                                  | ≤ 10 %      |
| Structural false acceptance | Wrong character, missing or extra stroke graded Good or better               | ≤ 2 %       |
| Wrong-character acceptance  | A different character accepted as the expected one                           | ≤ 1 %       |
| Specific error named        | Deliberate errors where the feedback names the actual problem                | ≥ 80 %      |
| Technique errors accepted   | Direction, order or proportion faults graded Good (capped at Good by design) | report only |

Results are broken down by input device (finger, stylus, mouse), writing size (share of the
box used) and participant. A threshold that only works for one group is not acceptable.

**Policy question to settle with real data:** a character written with a reversed stroke or
the wrong stroke order is currently capped at **Good** with specific feedback, so it still
counts as recalled. The synthetic baseline shows this happens in 85 % of technique-error
samples. If testers and teachers agree that technique errors should not count as recall,
change the caps (a scoring-policy change, recorded in `DECISIONS.md`), not the distance
thresholds.

## Collecting samples

**Who.** At least 15 participants (target 20–30), mixing complete beginners, learners who have
studied for at least a year, at least 2 native or heritage writers, at least 2 left-handed
writers, and phone (finger), tablet (stylus) and laptop (mouse or trackpad) users.

**Consent.** Before recording, explain that the participant's handwriting strokes (no audio, no
video, no name) will be stored to test the app and may be kept for future engine versions, and
that they can ask for their samples to be deleted. Tick the consent box only after they agree.
Participants are identified only by a code (`P01`, `P02`, …). Keep the code-to-person mapping,
if any, outside the app.

**Where.** _Admin → Handwriting lab_ (`/admin/handwriting`). It needs the
`handwriting:validate` permission (Super Admin and Curriculum Editor roles).

**Per participant (about 20 minutes)**, pick 12 characters spanning simple (人, 大, 口),
medium (你, 好, 我) and complex (谢, 都, 喜) ones, and record:

1. **Correct ×2** each: once at a comfortable size, once deliberately small or fast. Ask them to
   write naturally. Don't coach their stroke order.
2. **One deliberate error** per character, rotating through: a different character
   (similar-looking where possible, e.g. 他 for 她, 人 for 八, 日 for 目), one stroke left out,
   one extra stroke, one stroke drawn backwards, two strokes swapped, a stroke badly
   misplaced.

That gives about 36 samples per participant: roughly 24 correct and 12 incorrect. With 15
participants this exceeds the minimum the lab enforces before tuning: 300 correct, 300
incorrect, 15 participants. Add more incorrect samples per session to reach 300 sooner.

**Quality notes.** Discard a sample (don't record it) if the participant was interrupted
mid-character. If the participant writes something other than requested, record it under the
category that matches what was actually written.

## Analysing

- The lab page shows live metrics, re-scored with the current engine.
- `npm run handwriting:report` prints a markdown report of the real samples. Save it under
  `docs/` with the date.
- `/api/admin/handwriting/samples?strokes=1` exports every sample with its raw ink for deeper
  analysis, such as replaying samples against candidate thresholds offline.
- `npm run handwriting:report -- --synthetic` regenerates the synthetic baseline
  (`docs/handwriting-baseline-synthetic.md`).

## Changing thresholds (rules)

1. Change thresholds only when the real-sample report misses a target, and only once the
   minimum sample size has been reached.
2. Evaluate a candidate change on **all** stored samples, including every device and size
   group, and on the synthetic sweep (`tests/unit/handwriting-engine.test.ts`). A change that
   improves FRR but raises structural false acceptance above target is rejected.
3. Keep a held-out set: tune on samples from two thirds of the participants and confirm on the
   remaining third.
4. Bump `ENGINE_VERSION` in `src/features/handwriting/evaluate.ts`. Stored attempts keep the
   version they were graded with.
5. Record the before and after reports and the reasoning in `DECISIONS.md`.
6. Never change a threshold just to make a test pass or to make the numbers look better.

## Current status (2026-11-10)

- Collection tooling, metrics, export and reports: **built and tested**.
- Real samples collected: **0**. No accuracy claim can be made for real learners yet.
- Synthetic baseline (`handwriting-baseline-synthetic.md`): 0 % false rejection over 306
  correct samples at three sizes, 0 % structural false acceptance (305 samples), 100 % of
  wrong characters rejected, and the specific error named in 99.8 % of deliberate errors.
  Technique errors (direction, order, shape) are accepted as Good by design in 85 % of cases.
- Thresholds are **unchanged** from M2: there is no real-world evidence to justify a change yet.

## Known limitations

- Identity is verified only against the candidate set. A character outside the set that
  happens to resemble an expected one cannot be recognised as "something else".
- Stroke order is judged on matched strokes. Joined or cursive strokes are treated as missing
  or extra strokes.
- Writing that fills only a tiny corner of the box is normalised up, which also magnifies
  wobble. The size breakdown exists to catch this.
- Guided-practice mistake counts come from the browser (Hanzi Writer). They are labelled
  low-trust and never count as independent recall.
