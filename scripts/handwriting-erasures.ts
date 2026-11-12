/**
 * Handwriting erasure ledger (M12 privacy review; docs/M12_ERASURE_REVIEW.md, D-061, D-062).
 * Every command needs ERASURE_LEDGER_KEY (the owner's signing key, never in the repository).
 *
 *   --export <file> [--source <url>]        Sign the erased codes of a database (default
 *                                            DATABASE_URL). If <file> exists it is verified and
 *                                            merged (a ledger never shrinks), and the old file is
 *                                            kept as <file>.<timestamp>.bak.
 *   --export <file> --from-backup <backup>  Rebuild from a backup's tombstones (lost ledger).
 *   --verify <file>                         Check integrity only.
 *   --status --target <url>                 Pending restore gates.
 *   --apply <file> --target <url>           Verify, then re-apply to a restored database in one
 *                                            transaction and clear its restore gate.
 *   --clear-without-ledger --target <url> --reason "<why>" --confirm "erased data may return"
 *                                            Recovery only, after every way of rebuilding the
 *                                            ledger has failed. Audited.
 * The ledger may not be written inside the repository except under the git-ignored .local/ or
 * backups/ folders: the repository is public.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { createPrismaClient } from "../src/lib/database/client";
import {
  applyLedger,
  clearGatesWithoutLedger,
  entriesFromBackupRows,
  erasedEntries,
  mergeEntries,
  pendingRestoreGates,
  signLedger,
  verifyLedger,
  type LedgerEntry,
} from "../src/features/handwriting/erasure-ledger";
import { arg } from "./lib/db-tools";

const REPO = path.resolve(__dirname, "..");
const ALLOWED_IN_REPO = [path.join(REPO, ".local"), path.join(REPO, "backups")];
const key = () => process.env.ERASURE_LEDGER_KEY;

function safeOutput(file: string) {
  const full = path.resolve(file);
  const inside = (dir: string) => full === dir || full.startsWith(dir + path.sep);
  if (inside(REPO) && !ALLOWED_IN_REPO.some(inside))
    throw new Error(
      "Refusing to write the ledger inside the repository (it is public). Use .local/, backups/ or a path outside the repository.",
    );
  return full;
}

async function backupTombstones(file: string) {
  const lines = readline.createInterface({
    input: fs.createReadStream(path.resolve(file)).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  const rows: { code: string; status: string; erasedAt: string | null; updatedAt: string }[] = [];
  let columns: string[] | null = null;
  let first = true;
  for await (const line of lines) {
    if (!line) continue;
    const value = JSON.parse(line) as {
      format?: string;
      tables?: { table: string; columns: { name: string }[] }[];
      t?: string;
      r?: unknown[];
    };
    if (first) {
      if (value.format !== "hanziquest-backup") throw new Error("Not a HanziQuest backup file.");
      const t = value.tables?.find((x) => x.table === "PilotParticipant");
      if (!t) throw new Error("This backup predates M12: it has no PilotParticipant table.");
      columns = t.columns.map((c) => c.name);
      first = false;
      continue;
    }
    if (value.t !== "PilotParticipant" || !value.r || !columns) continue;
    const row = Object.fromEntries(columns.map((c, i) => [c, value.r![i]])) as Record<
      string,
      string | null
    >;
    rows.push({
      code: row.code!,
      status: row.status!,
      erasedAt: row.erasedAt ?? null,
      updatedAt: row.updatedAt!,
    });
  }
  return entriesFromBackupRows(rows);
}

function target() {
  const url = arg("target");
  if (!url) throw new Error("This command needs an explicit --target <database url>.");
  return url;
}

async function exportLedger(out: string) {
  const file = safeOutput(out);
  const fromBackup = arg("from-backup");
  let fresh: LedgerEntry[];
  let source: string;
  if (fromBackup) {
    fresh = await backupTombstones(fromBackup);
    source = `backup:${path.basename(fromBackup)}`;
  } else {
    const url = arg("source") ?? process.env.DATABASE_URL;
    if (!url) throw new Error("No source database (DATABASE_URL or --source).");
    const prisma = createPrismaClient(url);
    try {
      fresh = await erasedEntries(prisma);
    } finally {
      await prisma.$disconnect();
    }
    source = "live-database";
  }
  let entries = fresh;
  if (fs.existsSync(file)) {
    // Never shrink: the existing ledger must verify, and all its entries are kept.
    const existing = verifyLedger(fs.readFileSync(file, "utf8"), key());
    entries = mergeEntries(existing.entries, fresh);
    source = "merged";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(file, `${file}.${stamp}.bak`);
  }
  const ledger = signLedger(entries, source, key());
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
  console.log(
    `Erasure ledger: ${ledger.count} erased code(s), sha256 ${ledger.entriesSha256.slice(0, 12)}…, written to ${file}`,
  );
}

async function main() {
  const out = arg("export");
  const input = arg("apply");
  const check = arg("verify");
  const commands =
    [out, input, check].filter(Boolean).length +
    (process.argv.includes("--status") ? 1 : 0) +
    (process.argv.includes("--clear-without-ledger") ? 1 : 0);
  if (commands !== 1)
    throw new Error(
      'Usage: --export <file> [--source <url> | --from-backup <file>] | --verify <file> | --status --target <url> | --apply <file> --target <url> | --clear-without-ledger --target <url> --reason <text> --confirm "erased data may return"',
    );

  if (out) return exportLedger(out);

  if (check) {
    const l = verifyLedger(fs.readFileSync(path.resolve(check), "utf8"), key());
    console.log(
      `Ledger OK: ${l.count} code(s), source ${l.source}, exported ${l.exportedAt}, sha256 ${l.entriesSha256.slice(0, 12)}…`,
    );
    return;
  }

  const prisma = createPrismaClient(target());
  try {
    if (process.argv.includes("--status")) {
      const pending = await pendingRestoreGates(prisma);
      console.log(
        pending
          ? `${pending} restore gate(s) PENDING: readiness is 503 until the erasure ledger is applied.`
          : "No pending restore gate.",
      );
      if (pending) process.exitCode = 3;
      return;
    }
    if (input) {
      // Verified (structure, completeness, duplicates, checksum, signature) before any write.
      const text = fs.readFileSync(path.resolve(input), "utf8");
      const r = await applyLedger(prisma, text, key());
      console.log(
        `Erasure ledger applied: ${r.entries} code(s), ${r.codesChanged} changed, ${r.samplesDeleted} sample(s) deleted, ${r.gatesCleared} restore gate(s) cleared.`,
      );
      return;
    }
    if (arg("confirm") !== "erased data may return")
      throw new Error('Recovery without a ledger needs --confirm "erased data may return".');
    const cleared = await clearGatesWithoutLedger(prisma, arg("reason") ?? "");
    console.log(
      `${cleared} restore gate(s) cleared WITHOUT a ledger. Samples erased after this backup was taken may be present again: follow docs/M12_ERASURE_REVIEW.md, "If the ledger is unavailable".`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
