/**
 * The status line under an exercise's feedback. Pure, so the wording is tested
 * (tests/unit/save-status.test.ts).
 *
 * A preview attempt (content the learner hasn't reached, D-085) never earns progress, now or
 * later, so its notice must not promise any.
 */
export const PREVIEW_PRACTICE_NOTICE = "Preview practice: this doesn't count toward your progress.";

export type SaveState = "saving" | "saved" | "queued" | "failed";

export function saveStatusText(input: {
  /** The admin preview of a lesson: nothing is submitted at all. */
  adminPreview: boolean;
  save: SaveState | undefined;
  /** The server stored this attempt as preview practice (`counted: false`). */
  previewAttempt: boolean;
  xpAwarded: number | undefined;
}): string {
  if (input.adminPreview) return "Preview: nothing is saved.";
  switch (input.save) {
    case "saving":
      return "Saving…";
    case "saved":
      if (input.previewAttempt) return PREVIEW_PRACTICE_NOTICE;
      return input.xpAwarded ? `Saved · +${input.xpAwarded} XP` : "Saved";
    case "queued":
      return "Saved on this device. It will sync when you're online.";
    case "failed":
      return "Not saved yet.";
    default:
      return "";
  }
}
