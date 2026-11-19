import { describe, expect, it } from "vitest";
import { DISPUTE_OUTCOMES, DISPUTE_REASONS } from "@/features/handwriting/dispute-reasons";
import { decisionSchema, disputeInputSchema } from "@/features/handwriting/disputes";
import { hasPermission } from "@/lib/permissions/permissions";

const reasons = (result: Parameters<(typeof DISPUTE_REASONS)[number]["eligible"]>[0]) =>
  DISPUTE_REASONS.filter((r) => r.eligible(result)).map((r) => r.key);

describe("dispute reasons (M13, D-081)", () => {
  it("offer only reasons that fit the result", () => {
    expect(reasons("TRY_AGAIN")).toEqual([
      "CORRECT_MARKED_WRONG",
      "TECHNIQUE_FEEDBACK_WRONG",
      "INPUT_PROBLEM",
    ]);
    expect(reasons("GOOD")).toEqual([
      "WRONG_MARKED_CORRECT",
      "TECHNIQUE_FEEDBACK_WRONG",
      "INPUT_PROBLEM",
    ]);
    expect(reasons("SKIPPED")).toEqual([]);
  });

  it("decided disputes are resolved or dismissed; none of the outcomes is a correction", () => {
    expect(DISPUTE_OUTCOMES.map((o) => [o.key, o.status])).toEqual([
      ["GRADING_WRONG", "RESOLVED"],
      ["GRADING_CORRECT", "RESOLVED"],
      ["NOT_ASSESSABLE", "DISMISSED"],
    ]);
    expect(() => decisionSchema.parse({ outcome: "CHANGE_RESULT" })).toThrow();
    expect(() => decisionSchema.parse({ outcome: "GRADING_WRONG", note: "x" })).toThrow();
  });
});

describe("dispute input", () => {
  const ok = {
    clientEventId: "8b0c1f6e-2a6f-4d7e-9a3c-1f2e3d4c5b6a",
    reason: "INPUT_PROBLEM",
    consent: true,
  };
  it("needs explicit consent and accepts no free text", () => {
    expect(disputeInputSchema.parse(ok)).toEqual(ok);
    expect(() => disputeInputSchema.parse({ ...ok, consent: false })).toThrow(/reviewer may look/);
    expect(() => disputeInputSchema.parse({ ...ok, comment: "it was right" })).toThrow();
    expect(() => disputeInputSchema.parse({ ...ok, clientEventId: "not-a-uuid" })).toThrow();
  });
});

describe("who reviews disputes", () => {
  it("Super Admins and Curriculum editors only", () => {
    expect(hasPermission(["SUPER_ADMIN"], "handwriting:review-disputes")).toBe(true);
    expect(hasPermission(["CURRICULUM_EDITOR"], "handwriting:review-disputes")).toBe(true);
    for (const role of ["CONTENT_REVIEWER", "MODERATOR", "ANALYST", "SUPPORT", "LEARNER"] as const)
      expect(hasPermission([role], "handwriting:review-disputes"), role).toBe(false);
  });
});
