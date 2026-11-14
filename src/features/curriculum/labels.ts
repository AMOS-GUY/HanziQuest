/**
 * Learner-facing labels for a curriculum's edition and review status (M14-b, D-070).
 *
 * - The edition says which standard the course follows. It never claims to be official HSK
 *   material: even VERIFIED content is HanziQuest's own course, built on a standard.
 * - The verification badge keeps REVIEWED distinct from VERIFIED (`verificationLabel`), and
 *   never shows anything as verified unless its `verification` is VERIFIED.
 */
import { verificationLabel, type Verification } from "./provenance";

export type Framework = "HSK_2_0" | "HSK_3_0" | "CUSTOM";

export interface EditionLabel {
  /** Short label, e.g. "HSK 2.0 edition". */
  label: string;
  /** One sentence for learners. */
  note: string;
}

export function editionLabel(framework: Framework): EditionLabel {
  switch (framework) {
    case "HSK_2_0":
      return {
        label: "HSK 2.0 edition",
        note: "Organised around the HSK 2.0 levels. HanziQuest's own course, not official HSK material.",
      };
    case "HSK_3_0":
      return {
        label: "HSK 3.0 (2021) edition",
        note: "Organised around the HSK 3.0 (2021) levels. HanziQuest's own course, not official HSK material.",
      };
    case "CUSTOM":
      return {
        label: "HanziQuest course",
        note: "A HanziQuest course, not tied to an HSK edition.",
      };
  }
}

export interface VerificationBadge {
  label: string;
  variant: "warning" | "muted" | "default";
  /** What the status means, in plain words (for a tooltip or a note). */
  description: string;
}

export function verificationBadge(verification: Verification): VerificationBadge {
  const label = verificationLabel(verification);
  switch (verification) {
    case "PROVISIONAL":
      return {
        label,
        variant: "warning",
        description:
          "Pinyin and meanings are provisional: no reviewer has approved this version yet.",
      };
    case "REVIEWED":
      return {
        label,
        variant: "muted",
        description:
          "Approved by a content reviewer. A second, independent check against licensed sources is still to come.",
      };
    case "VERIFIED":
      return {
        label,
        variant: "default",
        description:
          "Approved by two independent content reviewers and verified against licensed sources.",
      };
  }
}
