import { describe, expect, it } from "vitest";
import { DEFAULT_CONTENT_FILE, parseContentArgs } from "../../scripts/lib/content-args";

describe("content CLI arguments", () => {
  it("uses the file named, wherever it appears", () => {
    expect(parseContentArgs(["import", "my.json"])).toMatchObject({ ok: true, file: "my.json" });
    expect(parseContentArgs(["import", "my.json", "--draft"])).toMatchObject({
      file: "my.json",
      draft: true,
    });
    expect(parseContentArgs(["import", "--draft", "my.json"])).toMatchObject({
      file: "my.json",
      draft: true,
    });
    expect(parseContentArgs(["coverage", "my.json", "--list", "words.txt"])).toMatchObject({
      file: "my.json",
      listFile: "words.txt",
    });
    expect(parseContentArgs(["coverage", "--list", "words.txt", "my.json"])).toMatchObject({
      file: "my.json",
      listFile: "words.txt",
    });
  });

  it("uses the default file only when none is named", () => {
    expect(parseContentArgs(["validate"])).toMatchObject({ file: DEFAULT_CONTENT_FILE });
  });

  it("refuses anything ambiguous instead of guessing", () => {
    for (const argv of [
      ["import", "a.json", "b.json"],
      ["import", "--drafts", "a.json"],
      ["coverage", "a.json", "--list"],
      ["validate", "a.json", "--draft"],
      ["import", "a.json", "--list", "w.txt"],
      ["publish", "a.json"],
      [],
    ])
      expect(parseContentArgs(argv).ok, argv.join(" ")).toBe(false);
  });
});
