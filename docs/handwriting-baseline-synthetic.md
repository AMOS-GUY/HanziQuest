# Handwriting validation: synthetic baseline

Engine `hq-eval-1` · generated 2026-11-10 · 908 samples

Generated ink from the reference strokes with random jitter, wobble and size. **This is not real handwriting** and says nothing about accuracy with real learners. It is a regression reference that uses the same metrics as the real study. The participant-count warning is expected here.

| Measure                                                                                   | Result          |
| ----------------------------------------------------------------------------------------- | --------------- |
| False rejection: written correctly, graded below Good                                     | 0.0% (0/306)    |
| Structural false acceptance: wrong character, missing or extra stroke graded Good+        | 0.0% (0/305)    |
| Technique errors accepted: direction, order or shape fault graded Good (capped by design) | 84.5% (251/297) |
| Strict false acceptance: any deliberate error graded Good+                                | 41.7% (251/602) |
| Specific error named in feedback (all deliberate errors)                                  | 99.8% (601/602) |

| Category                    | Samples | Accepted         | Specific error named |
| --------------------------- | ------- | ---------------- | -------------------- |
| Correct, written normally   | 306     | 100.0% (306/306) | —                    |
| One extra stroke            | 102     | 0.0% (0/102)     | 100.0% (102/102)     |
| One stroke left out         | 101     | 0.0% (0/101)     | 100.0% (101/101)     |
| Badly proportioned / placed | 102     | 54.9% (56/102)   | 99.0% (101/102)      |
| A different character       | 102     | 0.0% (0/102)     | 100.0% (102/102)     |
| A stroke drawn backwards    | 102     | 100.0% (102/102) | 100.0% (102/102)     |
| Strokes in the wrong order  | 93      | 100.0% (93/93)   | 100.0% (93/93)       |

| Writing size        | False acceptance | False rejection |
| ------------------- | ---------------- | --------------- |
| large (≥70%)        | 44.0% (248/564)  | 0.0% (0/99)     |
| medium (35–70%)     | 8.3% (3/36)      | 0.0% (0/105)    |
| small (<35% of box) | 0.0% (0/2)       | 0.0% (0/102)    |

Thresholds in use: band cut-offs {"excellent":88,"good":72,"needsImprovement":50}, identity distance ≤ 0.2, unmatched stroke cost > 0.3.

**Warnings:**

- Samples come from 3 participant(s); at least 15 are needed.
