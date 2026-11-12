import { describe, expect, it, vi } from "vitest";

// lesson-data imports the app's database client; the helper under test doesn't use it.
vi.mock("@/lib/database/prisma", () => ({ prisma: {} }));
const { uniqueByVocabulary } = await import("@/features/learning/lesson-data");

describe("character page: words using the character (M13 audit)", () => {
  it("lists a word once even when it uses the character twice (谢谢, 爸爸)", () => {
    const rows = [
      { vocabulary: { id: "w1", simplified: "谢谢" } },
      { vocabulary: { id: "w2", simplified: "感谢" } },
      { vocabulary: { id: "w1", simplified: "谢谢" } },
    ];
    expect(uniqueByVocabulary(rows).map((r) => r.vocabulary.simplified)).toEqual(["谢谢", "感谢"]);
  });

  it("keeps distinct words and their order", () => {
    const rows = ["a", "b", "c"].map((id) => ({ vocabulary: { id } }));
    expect(uniqueByVocabulary(rows)).toEqual(rows);
    expect(uniqueByVocabulary([])).toEqual([]);
  });
});
