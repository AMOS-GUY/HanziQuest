/**
 * Dispute reasons and reviewer outcomes (M13, D-081). Pure: shared by the server and the
 * practice screen. Structured choices only, no free text.
 */
import type {
  AttemptResult,
  DisputeOutcome,
  DisputeReason,
  DisputeStatus,
} from "@/generated/prisma/enums";

export const DISPUTE_REASONS = [
  {
    key: "CORRECT_MARKED_WRONG",
    label: "I wrote the right character, but it was marked wrong",
    eligible: (r: AttemptResult) => r === "NEEDS_IMPROVEMENT" || r === "TRY_AGAIN",
  },
  {
    key: "WRONG_MARKED_CORRECT",
    label: "It was accepted, but I think I wrote it wrong",
    eligible: (r: AttemptResult) => r === "EXCELLENT" || r === "GOOD",
  },
  {
    key: "TECHNIQUE_FEEDBACK_WRONG",
    label: "The stroke order or direction feedback is wrong",
    eligible: (r: AttemptResult) => r !== "SKIPPED",
  },
  {
    key: "INPUT_PROBLEM",
    label: "My strokes weren't captured properly",
    eligible: (r: AttemptResult) => r !== "SKIPPED",
  },
] as const satisfies readonly {
  key: DisputeReason;
  label: string;
  eligible: (r: AttemptResult) => boolean;
}[];

export const DISPUTE_OUTCOMES = [
  { key: "GRADING_WRONG", label: "The result was wrong", status: "RESOLVED" },
  { key: "GRADING_CORRECT", label: "The result was right", status: "RESOLVED" },
  { key: "NOT_ASSESSABLE", label: "Can't be judged from this writing", status: "DISMISSED" },
] as const satisfies readonly { key: DisputeOutcome; label: string; status: DisputeStatus }[];
