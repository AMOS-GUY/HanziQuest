import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  entriesFromBackupRows,
  LedgerError,
  mergeEntries,
  signLedger,
  verifyLedger,
  type LedgerEntry,
} from "@/features/handwriting/erasure-ledger";

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
