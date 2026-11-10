import { z } from "zod";

/**
 * Initial, EXPERIMENTAL weights for handwriting evaluation (Part 10.3 of the product spec).
 * They are stored per exercise so they can be tuned without code changes, and must be
 * validated against real learner data before being presented as reliable.
 */
export const evaluationWeightsSchema = z
  .object({
    recognition: z.number().min(0).max(1),
    strokeOrder: z.number().min(0).max(1),
    direction: z.number().min(0).max(1),
    shape: z.number().min(0).max(1),
  })
  .refine(
    (w) => Math.abs(w.recognition + w.strokeOrder + w.direction + w.shape - 1) < 1e-6,
    "Evaluation weights must sum to 1",
  );

export const evaluationConfigSchema = z.object({
  mode: z.enum(["GUIDED", "INDEPENDENT", "CHOICE"]),
  weights: evaluationWeightsSchema,
  /** Characters the learner must write, in order. */
  characters: z.array(z.string()),
  /** Whether a wrong character identity forces a failing result regardless of other scores. */
  identityGate: z.boolean(),
});

export type EvaluationWeights = z.infer<typeof evaluationWeightsSchema>;
export type EvaluationConfig = z.infer<typeof evaluationConfigSchema>;

export const DEFAULT_EVALUATION_WEIGHTS: EvaluationWeights = {
  recognition: 0.35,
  strokeOrder: 0.25,
  direction: 0.15,
  shape: 0.25,
};

export function buildEvaluationConfig(
  mode: EvaluationConfig["mode"],
  characters: string[],
): EvaluationConfig {
  return evaluationConfigSchema.parse({
    mode,
    weights: DEFAULT_EVALUATION_WEIGHTS,
    characters,
    identityGate: true,
  });
}
