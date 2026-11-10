# Handwriting engine

HanziQuest offers two kinds of writing practice, and they are kept separate in both the data and
the UI:

| Mode                    | Used by                                                   | Engine                                                              | What it tells us                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guided practice**     | `GUIDED_STROKE` exercises                                 | Hanzi Writer quiz (`components/handwriting/guided-stroke-quiz.tsx`) | The learner traces each stroke over an outline. Hanzi Writer checks one stroke at a time and rejects wrong ones. We record the mistake count, which the client reports (low trust). |
| **Independent writing** | `PINYIN_TO_HANZI`, `MEANING_TO_HANZI`, `FREEHAND_WRITING` | HanziQuest evaluator (`features/handwriting/`)                      | The learner writes freely on a blank grid. The **server** re-evaluates the raw strokes. Using a hint downgrades the attempt to `GUIDED`.                                            |

Hanzi Writer is **not** used as a handwriting recogniser.

## Pipeline (independent writing)

1. **Capture** (`components/handwriting/handwriting-canvas.tsx`). Pointer Events cover mouse,
   touch and pen. Coalesced events give smooth input, `touch-action: none` stops scrolling, and
   the canvas is sized for high-DPI screens. Each stroke stores ordered points
   `{x, y, t}`: coordinates normalised to the box (0–1, y down) and `t` in milliseconds since
   the first touch. Start, end, order and duration can all be derived from these.
2. **Reference data** (`reference.ts`, `reference-store.ts`). Stroke medians come from
   `hanzi-writer-data` (Make Me a Hanzi), stored in `CharacterStroke` and converted into the
   same normalised space.
3. **Normalisation** (`geometry.ts`). Both the learner's ink and the reference are centred on
   their bounding box and scaled uniformly, so the larger side is 1. This removes differences in
   size and position but keeps proportions. Each stroke is resampled to 16 evenly spaced points.
4. **Stroke matching** (`evaluate.ts`). For every learner stroke × reference stroke pair, the
   cost is the mean point distance, taken in the better of the two directions. Strokes are
   paired with the Hungarian algorithm (minimum total cost). A pair costing more than 0.3
   counts as unmatched.
5. **Recognition (identity verification).** The drawing is compared with every character in
   the exercise's HSK level (102 characters for the starter curriculum). It is verified only if
   the expected character is the nearest candidate and its distance is at most 0.2. **This
   verifies identity within that set; it is not general handwriting recognition.**
6. **Scoring.** The dimensions are:
   - **Recognition:** 1 if verified, otherwise 0.
   - **Stroke order:** the longest run of matched strokes in canonical order, divided by the
     expected stroke count.
   - **Direction:** matched strokes not drawn backwards, divided by the expected count. Dots
     shorter than 0.12 are exempt.
   - **Shape and position:** mean per-stroke quality (`1 − cost / 0.3`, with 0 for missing
     strokes), discounted for extra strokes.

   Score = 100 × weighted sum. The default weights are recognition 0.35, order 0.25, direction
   0.15 and shape 0.25. They are stored in each exercise's `evaluationConfig` and must sum to 1.

7. **Band and caps.** The score maps to a band: ≥ 88 Excellent, ≥ 72 Good, ≥ 50 Needs
   improvement, otherwise Try again. Evidence-based caps then apply:
   - identity not verified → **Try again**, whatever the other scores (the identity gate);
   - missing or extra strokes → at most Needs improvement;
   - order or direction errors, a badly shaped stroke, or shape < 0.8 → at most Good;
   - shape < 0.55 → at most Needs improvement.
8. **Feedback.** Messages are generated only from evidence the engine has: wrong character
   ("looks more like 她"), stroke-count differences, which strokes are out of order, which
   stroke goes the wrong way, and which stroke is off in shape or position. The UI shows bands
   and Good/Fair/Needs-work labels, not raw decimals, to avoid false precision. The integer
   score is stored for analysis.

Multi-character answers (e.g. 你好) are written one character per box. Each character is
evaluated separately, and the weakest character sets the overall band.

## Trust model

- The browser evaluates locally for instant feedback, and will do so offline.
- `/api/attempts` stores the raw strokes and **re-evaluates them on the server** with the same
  code and the same candidate set. Client-sent scores or results are ignored.
- Guided-practice mistake counts are client-reported. They are labelled as such in the stored
  evaluation and never count as independent recall.

## Validation status (honest)

| What                                                                                          | Status                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Synthetic sweep over all **102 starter characters** (`tests/unit/handwriting-engine.test.ts`) | ✅ Passing                                                                 |
| — correct writing with jitter, wobble, ±scale, offset, ±0.04 rad rotation                     | 102/102 verified, Good or Excellent                                        |
| — writing size 0.3× vs 1×, speed 2 vs 60 ms/point                                             | Scores within 3 points                                                     |
| — a different character written                                                               | 102/102 rejected (Try again)                                               |
| — similar pairs (他/她, 人/八, 人/儿, 上/下, 午/年, …)                                        | All distinguished                                                          |
| — missing stroke (chars with ≥ 4 strokes)                                                     | Always capped below Good                                                   |
| — extra stroke                                                                                | Flagged                                                                    |
| — reversed longest stroke                                                                     | Detected on ≥ 95 % (required threshold)                                    |
| — first/last strokes swapped                                                                  | Detected on ≥ 95 %                                                         |
| — one stroke stretched 1.8×                                                                   | Shape flagged, not Excellent                                               |
| End-to-end: a full lesson written in the browser (Playwright)                                 | ✅ All 18 exercises Excellent or Good, saved by the server                 |
| **Real learner handwriting**                                                                  | ❌ **Not yet validated.** Thresholds are calibrated only on synthetic ink. |

Before the beta goes public, collect real samples from at least 10 testers (correct and
incorrect writing), measure false accept and false reject rates per band, and retune
`THRESHOLDS` in `evaluate.ts`. Bump `ENGINE_VERSION` whenever thresholds change, so stored
attempts can be told apart.

## Known limitations

- Joined strokes (cursive, 连笔) count as one stroke, so they produce stroke-count feedback.
- Identity is only checked within the level's candidate set. A character outside it can be
  "nearest" to something else.
- Characters with no stroke data get no writing exercises (the importer skips them).
- ONNX or model-based recognition is a future option. The evaluator is a pure module, so a
  recogniser could replace step 5 without changing the rest.
