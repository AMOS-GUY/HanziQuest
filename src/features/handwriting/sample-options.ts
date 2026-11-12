/**
 * Fixed choices for lab samples (M12). Shared by the recorder (client) and the server schema.
 * These replace free text so that no names or identifying details can be stored with a sample.
 */

/** Prompt styles. The pilot plan uses the first three. */
export const SAMPLE_STYLES = [
  "normal",
  "small-or-fast",
  "deliberate-error",
  "small",
  "fast",
  "large",
] as const;
export type SampleStyle = (typeof SAMPLE_STYLES)[number];

/** Collector observations. Mirrors the Prisma `HandwritingObservation` enum. */
export const OBSERVATIONS = [
  "HESITATED",
  "RESTARTED",
  "USED_UNDO",
  "UNSURE_OF_CHARACTER",
  "INSTRUCTION_MISUNDERSTOOD",
  "DIFFERENT_ERROR_THAN_ASKED",
  "WROTE_OUTSIDE_BOX",
  "DEVICE_LAG_OR_PALM_TOUCH",
  "INTERRUPTED",
] as const;
export type Observation = (typeof OBSERVATIONS)[number];

export const OBSERVATION_LABEL: Record<Observation, string> = {
  HESITATED: "Hesitated",
  RESTARTED: "Restarted the character",
  USED_UNDO: "Used undo or clear",
  UNSURE_OF_CHARACTER: "Unsure of the character",
  INSTRUCTION_MISUNDERSTOOD: "Misunderstood the instruction",
  DIFFERENT_ERROR_THAN_ASKED: "Made a different error than asked",
  WROTE_OUTSIDE_BOX: "Wrote outside the box",
  DEVICE_LAG_OR_PALM_TOUCH: "Device lag or palm touch",
  INTERRUPTED: "Interrupted",
};
