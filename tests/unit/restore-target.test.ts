import { describe, expect, it } from "vitest";
import { restoreTargetProblems } from "../../scripts/lib/restore-target";

const hosted = "postgresql://u:p@ep-x-pooler.example.invalid/hanziquest";
const target = "postgresql://drill:drill@localhost:5432/hq_restore_verify";
const scratch = "postgresql://drill:drill@localhost:5432/drill";

describe("restore-verification target guard (backup.yml)", () => {
  it("accepts a separate, disposable, local database", () => {
    expect(restoreTargetProblems(hosted, target, scratch)).toEqual([]);
    expect(
      restoreTargetProblems(hosted, "postgresql://a:b@127.0.0.1:5433/hq_restore_verify_2", scratch),
    ).toEqual([]);
  });

  it("refuses the backup source itself", () => {
    expect(restoreTargetProblems(target, target).join(" ")).toMatch(/is the backup source/);
    // Same database written differently (default port, credentials).
    expect(
      restoreTargetProblems(
        "postgresql://x:y@LOCALHOST/hq_restore_verify",
        "postgresql://drill:drill@localhost:5432/hq_restore_verify",
      ).join(" "),
    ).toMatch(/is the backup source/);
  });

  it("refuses the app's DATABASE_URL (the old backup.yml bug)", () => {
    expect(restoreTargetProblems(hosted, target, target).join(" ")).toMatch(/DATABASE_URL/);
  });

  it("refuses hosted or non-disposable targets", () => {
    expect(restoreTargetProblems(scratch, hosted).join(" ")).toMatch(/local database/);
    expect(restoreTargetProblems(hosted, scratch).join(" ")).toMatch(/hq_restore_verify/);
    expect(
      restoreTargetProblems(hosted, "postgresql://a:b@localhost/hanziquest").join(" "),
    ).toMatch(/hq_restore_verify/);
  });

  it("never echoes URLs or credentials", () => {
    const all = [
      ...restoreTargetProblems(target, target, target),
      ...restoreTargetProblems(scratch, hosted),
    ].join(" ");
    expect(all).not.toMatch(/drill:drill|u:p|ep-x|postgresql:/);
    expect(() => restoreTargetProblems("not a url", target)).toThrow(/not a valid database URL/);
    try {
      restoreTargetProblems("mysql://secret:pw@h/db", target);
    } catch (e) {
      expect(String(e)).not.toContain("secret");
    }
  });
});
