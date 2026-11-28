import { describe, expect, it } from "vitest";
import { PREVIEW_PRACTICE_NOTICE, saveStatusText } from "@/components/lessons/save-status";

const base = { adminPreview: false, previewAttempt: false, xpAwarded: undefined };

describe("saveStatusText", () => {
  it("labels preview practice without promising later credit (D-085)", () => {
    const text = saveStatusText({ ...base, save: "saved", previewAttempt: true, xpAwarded: 0 });
    expect(text).toBe(PREVIEW_PRACTICE_NOTICE);
    expect(text).toMatch(/doesn't count toward your progress/);
    expect(text).not.toMatch(/once|later|when you reach|will count|counts? once|unlock/i);
  });

  it("never shows XP for a preview, even if a number is present", () => {
    expect(saveStatusText({ ...base, save: "saved", previewAttempt: true, xpAwarded: 10 })).toBe(
      PREVIEW_PRACTICE_NOTICE,
    );
  });

  it("keeps the existing messages for counted attempts", () => {
    expect(saveStatusText({ ...base, save: "saved", xpAwarded: 8 })).toBe("Saved · +8 XP");
    expect(saveStatusText({ ...base, save: "saved", xpAwarded: 0 })).toBe("Saved");
    expect(saveStatusText({ ...base, save: "saving" })).toBe("Saving…");
    expect(saveStatusText({ ...base, save: "queued" })).toMatch(/sync when you're online/);
    expect(saveStatusText({ ...base, save: "failed" })).toBe("Not saved yet.");
    expect(saveStatusText({ ...base, save: undefined })).toBe("");
    expect(saveStatusText({ ...base, adminPreview: true, save: "saved" })).toBe(
      "Preview: nothing is saved.",
    );
  });
});
