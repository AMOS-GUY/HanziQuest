import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  entriesFromBackupRows,
  entriesFromPaperRecord,
  LedgerError,
  mergeEntries,
  signLedger,
  verifyLedger,
  type LedgerEntry,
} from "@/features/handwriting/erasure-ledger";
import { writeLedgerFile } from "../../scripts/lib/erasure-ledger-file";

const KEY = "unit-test-ledger-key-0123456789abcdefghij";
const at = "2026-11-12T10:00:00.000Z";
const entries: LedgerEntry[] = [
  { code: "TEST2", reason: "WITHDRAWAL", erasedAt: at },
  { code: "TEST1", reason: "RETENTION_ENDED", erasedAt: at },
];

function reason(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (e instanceof LedgerError) return e.reason;
    throw e;
  }
  return "accepted";
}

const rehash = (list: LedgerEntry[]) =>
  createHash("sha256").update(JSON.stringify(list)).digest("hex");

describe("erasure ledger integrity", () => {
  const good = signLedger(entries, "test", KEY);

  it("signs canonical entries and verifies them (text or object)", () => {
    expect(good.entries.map((e) => e.code)).toEqual(["TEST1", "TEST2"]);
    expect(good.count).toBe(2);
    expect(verifyLedger(JSON.stringify(good), KEY).entries).toEqual(good.entries);
    expect(verifyLedger(good, KEY).count).toBe(2);
  });

  it("rejects corrupted input", () => {
    const text = JSON.stringify(good);
    expect(reason(() => verifyLedger(text.slice(0, 40), KEY))).toBe("corrupted");
    expect(reason(() => verifyLedger("", KEY))).toBe("corrupted");
    expect(reason(() => verifyLedger({ ...good, format: "other" }, KEY))).toBe("corrupted");
    expect(reason(() => verifyLedger({ ...good, extra: 1 }, KEY))).toBe("corrupted");
    expect(
      reason(() =>
        verifyLedger(
          { ...good, entries: [{ code: "jane@example.com", reason: "WITHDRAWAL", erasedAt: at }] },
          KEY,
        ),
      ),
    ).toBe("corrupted");
    expect(
      reason(() =>
        verifyLedger({ ...good, entries: [{ code: "TEST1", reason: "WITHDRAWAL" }] }, KEY),
      ),
    ).toBe("corrupted");
  });

  it("rejects an incomplete ledger (count mismatch, dropped entry)", () => {
    expect(reason(() => verifyLedger({ ...good, count: 3 }, KEY))).toBe("incomplete");
    expect(reason(() => verifyLedger({ ...good, entries: good.entries.slice(1) }, KEY))).toBe(
      "incomplete",
    );
  });

  it("rejects duplicated entries, including case variants", () => {
    const dup = [...good.entries, good.entries[0]!];
    expect(reason(() => verifyLedger({ ...good, count: 3, entries: dup }, KEY))).toBe("duplicate");
    expect(
      reason(() => signLedger([...entries, { ...entries[0]!, code: "test2" }], "test", KEY)),
    ).toBe("duplicate");
  });

  it("rejects a changed entry (checksum) and a consistently re-hashed edit (signature)", () => {
    const edited = [{ ...good.entries[0]!, reason: "WITHDRAWAL" as const }, good.entries[1]!];
    expect(reason(() => verifyLedger({ ...good, entries: edited }, KEY))).toBe("checksum");
    // An attacker removes an entry and recomputes count and checksum: the HMAC still fails.
    const removed = good.entries.slice(1);
    expect(
      reason(() =>
        verifyLedger({ ...good, entries: removed, count: 1, entriesSha256: rehash(removed) }, KEY),
      ),
    ).toBe("signature");
    expect(reason(() => verifyLedger(good, "y".repeat(40)))).toBe("signature");
    expect(reason(() => verifyLedger({ ...good, source: "forged" }, KEY))).toBe("signature");
  });

  it("refuses to sign or verify without a strong key", () => {
    expect(reason(() => signLedger(entries, "test", undefined))).toBe("key");
    expect(reason(() => signLedger(entries, "test", "short"))).toBe("key");
    expect(reason(() => verifyLedger(good, undefined))).toBe("key");
  });

  it("accepts entries in any order (canonicalised before hashing)", () => {
    const reordered = { ...good, entries: [...good.entries].reverse() };
    expect(reason(() => verifyLedger(reordered, KEY))).toBe("accepted");
  });
});

describe("ledger merging and rebuilding", () => {
  it("never drops an entry and keeps each code's earliest erasure", () => {
    const later = "2026-12-01T00:00:00.000Z";
    const merged = mergeEntries(entries, [
      { code: "test1", reason: "WITHDRAWAL", erasedAt: later },
      { code: "TEST3", reason: "WITHDRAWAL", erasedAt: later },
    ]);
    expect(merged.map((e) => e.code)).toEqual(["TEST1", "TEST2", "TEST3"]);
    expect(merged[0]).toEqual({ code: "TEST1", reason: "RETENTION_ENDED", erasedAt: at });
    expect(mergeEntries(entries, [])).toHaveLength(2);
  });

  it("reads a backup's zoneless timestamps as UTC, whatever the local time zone", () => {
    const rows = [
      { code: "TEST1", status: "WITHDRAWN", erasedAt: "2026-11-12 10:00:00", updatedAt: at },
      { code: "TEST2", status: "WITHDRAWN", erasedAt: "2026-11-12 10:00:00.000", updatedAt: at },
    ];
    expect(entriesFromBackupRows(rows).map((e) => e.erasedAt)).toEqual([at, at]);
    expect(() =>
      entriesFromBackupRows([
        { code: "TEST1", status: "WITHDRAWN", erasedAt: "garbage", updatedAt: at },
      ]),
    ).toThrow(LedgerError);
  });

  it("rebuilds entries from a backup's tombstones, ignoring active codes", () => {
    const rows = [
      { code: "TEST1", status: "WITHDRAWN", erasedAt: at, updatedAt: at },
      { code: "TEST2", status: "RETENTION_ENDED", erasedAt: null, updatedAt: at },
      { code: "TEST3", status: "ACTIVE", erasedAt: null, updatedAt: at },
    ];
    expect(entriesFromBackupRows(rows)).toEqual([
      { code: "TEST1", reason: "WITHDRAWAL", erasedAt: at },
      { code: "TEST2", reason: "RETENTION_ENDED", erasedAt: at },
    ]);
  });
});

describe("ledger files: no silent shrink or overwrite", () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "hq-ledger-"));
  const later = "2026-12-01T00:00:00.000Z";

  it("keeps every previously recorded erasure and its first date, and keeps the old file", () => {
    const file = path.join(dir(), "ledger.json");
    const first = writeLedgerFile(file, entries, "live-database", KEY);
    expect(first).toMatchObject({ previousCount: 0, added: 2, backupFile: null });
    // A later source that lacks TEST2 and reports TEST1 with a later date (e.g. an older backup
    // or a re-erasure): nothing is lost and TEST1 keeps its first erasure.
    const second = writeLedgerFile(
      file,
      [
        { code: "TEST1", reason: "WITHDRAWAL", erasedAt: later },
        { code: "TEST3", reason: "WITHDRAWAL", erasedAt: later },
      ],
      "backup:x",
      KEY,
    );
    expect(second.previousCount).toBe(2);
    expect(second.added).toBe(1);
    const now = verifyLedger(fs.readFileSync(file, "utf8"), KEY);
    expect(now.entries.map((e) => e.code)).toEqual(["TEST1", "TEST2", "TEST3"]);
    expect(now.entries[0]).toEqual({ code: "TEST1", reason: "RETENTION_ENDED", erasedAt: at });
    expect(fs.existsSync(second.backupFile!)).toBe(true);
    expect(verifyLedger(fs.readFileSync(second.backupFile!, "utf8"), KEY).count).toBe(2);
    // An empty source never shrinks it either.
    expect(writeLedgerFile(file, [], "live-database", KEY).ledger.count).toBe(3);
  });

  it("refuses to overwrite a ledger that doesn't verify, leaving it untouched", () => {
    const file = path.join(dir(), "ledger.json");
    writeLedgerFile(file, entries, "live-database", KEY);
    const corrupted = fs.readFileSync(file, "utf8").replace("TEST2", "TEST9");
    fs.writeFileSync(file, corrupted);
    expect(() => writeLedgerFile(file, [], "live-database", KEY)).toThrow(LedgerError);
    expect(fs.readFileSync(file, "utf8")).toBe(corrupted);
    // Wrong key and missing key: same refusal.
    const good = path.join(dir(), "ledger.json");
    writeLedgerFile(good, entries, "live-database", KEY);
    const before = fs.readFileSync(good, "utf8");
    expect(() => writeLedgerFile(good, [], "x", "z".repeat(40))).toThrow(LedgerError);
    expect(() => writeLedgerFile(good, [], "x", undefined)).toThrow(LedgerError);
    expect(fs.readFileSync(good, "utf8")).toBe(before);
  });

  it("rejects duplicated sources instead of writing them", () => {
    const file = path.join(dir(), "ledger.json");
    expect(() => writeLedgerFile(file, [...entries, entries[0]!], "x", KEY)).toThrow(LedgerError);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("paper record (last-resort rebuild, still signed)", () => {
  it("parses codes, reasons and dates, ignoring comments", () => {
    expect(
      entriesFromPaperRecord(
        "# withdrawals\n\ntest2 WITHDRAWAL 2026-11-12\nTEST1 RETENTION_ENDED 2026-11-12\n",
      ),
    ).toEqual([
      { code: "TEST1", reason: "RETENTION_ENDED", erasedAt: at.replace("10:00", "00:00") },
      { code: "TEST2", reason: "WITHDRAWAL", erasedAt: at.replace("10:00", "00:00") },
    ]);
  });

  it("rejects malformed, incomplete and duplicated lines", () => {
    for (const bad of [
      "TEST1 WITHDRAWAL",
      "TEST1 LEFT 2026-11-12",
      "TEST1 WITHDRAWAL 12/11/2026",
      "jane@example.com WITHDRAWAL 2026-11-12",
      "TEST1 WITHDRAWAL 2026-11-12 extra",
      "TEST1 WITHDRAWAL 2026-11-12\ntest1 WITHDRAWAL 2026-11-13",
    ])
      expect(() => entriesFromPaperRecord(bad), bad).toThrow(LedgerError);
  });
});
