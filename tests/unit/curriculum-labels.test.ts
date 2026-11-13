import { describe, expect, it } from "vitest";
import { editionLabel, verificationBadge } from "@/features/curriculum/labels";

describe("learner-facing edition labels (M14-b)", () => {
  it("names the edition and never claims official HSK material", () => {
    for (const f of ["HSK_2_0", "HSK_3_0"] as const) {
      const l = editionLabel(f);
      expect(l.note).toMatch(/not official HSK material/);
      expect(`${l.label} ${l.note}`).not.toMatch(
        /\bofficial HSK (course|curriculum)\b(?! material)/i,
      );
    }
    expect(editionLabel("HSK_2_0").label).toBe("HSK 2.0 edition");
    expect(editionLabel("HSK_3_0").label).toBe("HSK 3.0 (2021) edition");
    expect(editionLabel("CUSTOM").label).toBe("HanziQuest course");
  });

  it("doesn't claim level membership (the starter only follows HSK 2.0 loosely)", () => {
    expect(editionLabel("HSK_2_0").note).not.toMatch(
      /\bfollows\b|\bofficial (word|vocabulary) list\b/i,
    );
  });
});

describe("learner-facing verification badges (M14-b)", () => {
  it("keeps REVIEWED distinct from VERIFIED", () => {
    expect(verificationBadge("PROVISIONAL").label).toBe("Provisional content");
    expect(verificationBadge("REVIEWED").label).toBe("Reviewed (not yet verified)");
    expect(verificationBadge("VERIFIED").label).toBe("Verified");
    expect(verificationBadge("REVIEWED").description).toMatch(/not yet verified/i);
  });

  it("only VERIFIED content describes itself as verified", () => {
    for (const v of ["PROVISIONAL", "REVIEWED"] as const)
      expect(verificationBadge(v).description).not.toMatch(
        /^.*\bverified against licensed sources\.$/,
      );
    expect(verificationBadge("VERIFIED").description).toMatch(/verified against licensed sources/);
  });
});
