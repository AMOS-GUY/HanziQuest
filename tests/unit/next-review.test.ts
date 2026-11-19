import { describe, expect, it } from "vitest";
import { nextReviewText } from "@/features/progress/next-review";

const now = new Date("2026-11-19T10:00:00Z"); // Thursday

describe("next review wording (M15-d)", () => {
  it("uses the learner's own day and clock", () => {
    expect(nextReviewText(new Date("2026-11-19T18:30:00Z"), now, "UTC")).toBe("today at 18:30");
    expect(nextReviewText(new Date("2026-11-20T09:05:00Z"), now, "UTC")).toBe("tomorrow at 09:05");
    // 18:30 UTC is already Friday 03:30 in Tokyo.
    expect(nextReviewText(new Date("2026-11-19T18:30:00Z"), now, "Asia/Tokyo")).toBe(
      "tomorrow at 03:30",
    );
  });

  it("names the weekday within a week, then the date", () => {
    expect(nextReviewText(new Date("2026-11-22T14:00:00Z"), now, "UTC")).toBe("on Sunday at 14:00");
    expect(nextReviewText(new Date("2026-11-27T14:00:00Z"), now, "UTC")).toBe("on 27 Nov");
  });

  it("an overdue time reads as today, and a bad time zone falls back to UTC", () => {
    expect(nextReviewText(new Date("2026-11-18T08:00:00Z"), now, "UTC")).toBe("today at 08:00");
    expect(nextReviewText(new Date("2026-11-20T09:05:00Z"), now, "Not/AZone")).toBe(
      "tomorrow at 09:05",
    );
  });
});
