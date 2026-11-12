/**
 * Writing erasure ledger files safely (D-062). Used by `npm run handwriting:erasures`.
 *
 * - An existing ledger is verified first; if it doesn't verify (corrupted, tampered, other key)
 *   nothing is written and the file is left untouched.
 * - New entries are merged into it: a ledger never shrinks, and a code keeps its earliest
 *   recorded erasure (an export can't overwrite history).
 * - The previous file is kept as `<file>.<timestamp>.bak`, and the new one is written to a
 *   temporary file and renamed, so an interruption never leaves a half-written ledger.
 */
import fs from "node:fs";
import {
  mergeEntries,
  signLedger,
  verifyLedger,
  type ErasureLedger,
  type LedgerEntry,
} from "../../src/features/handwriting/erasure-ledger";

export interface LedgerWrite {
  ledger: ErasureLedger;
  previousCount: number;
  added: number;
  backupFile: string | null;
}

export function writeLedgerFile(
  file: string,
  fresh: readonly LedgerEntry[],
  source: string,
  key: string | undefined,
  now = new Date(),
): LedgerWrite {
  let entries: LedgerEntry[] = [...fresh];
  let previous: ErasureLedger | null = null;
  if (fs.existsSync(file)) {
    previous = verifyLedger(fs.readFileSync(file, "utf8"), key);
    entries = mergeEntries(previous.entries, fresh);
    // Defensive: every previously recorded erasure must still be there, unchanged.
    const kept = new Map(entries.map((e) => [e.code, e]));
    for (const old of previous.entries) {
      const merged = kept.get(old.code);
      if (!merged || merged.erasedAt > old.erasedAt)
        throw new Error(`Refusing to write: the merge would lose or change ${old.code}.`);
    }
  }
  const ledger = signLedger(entries, previous ? "merged" : source, key, now.toISOString());
  let backupFile: string | null = null;
  if (previous) {
    backupFile = `${file}.${now.toISOString().replace(/[:.]/g, "-")}.bak`;
    fs.copyFileSync(file, backupFile);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  return {
    ledger,
    previousCount: previous?.count ?? 0,
    added: ledger.count - (previous?.count ?? 0),
    backupFile,
  };
}
