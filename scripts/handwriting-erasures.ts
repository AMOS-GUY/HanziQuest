/**
 * Handwriting erasure ledger (M12 privacy review; docs/M12_ERASURE_REVIEW.md, D-061, D-062).
 * Every command needs ERASURE_LEDGER_KEY, the owner's signing key, supplied in the process
 * environment at the time of use. It is never in the repository, a committed file, the
 * database, the platform or a log. There is no unsigned mode.
 *
 *   --export <file> [sources]               Sign the erased codes into <file>. Sources (any
 *                                            number, merged):
 *       --source <url>                        a database's tombstones (default DATABASE_URL
 *                                            when no other source is given)
 *       --from-backup <backup.ndjson.gz>      a backup's tombstones (repeatable)
 *       --from-codes <paper-record.txt>       the paper record, `CODE REASON YYYY-MM-DD` per line
 *                                            If <file> exists it must verify; its entries are
 *                                            kept (a ledger never shrinks, dates never move
 *                                            later) and the old file is kept as a .bak.
 *   --verify <file>                         Check integrity only.
 *   --status --target <url>                 Pending restore gates (exit code 3 while gated).
 *   --apply <file> --target <url>           Verify, then re-apply to a restored database in one
 *                                            transaction and clear its restore gate.
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
  entriesFromBackupRows,
  entriesFromPaperRecord,
  erasedEntries,
  mergeEntries,
  pendingRestoreGates,
  verifyLedger,
  type LedgerEntry,
} from "../src/features/handwriting/erasure-ledger";
import { arg } from "./lib/db-tools";
import { writeLedgerFile } from "./lib/erasure-ledger-file";

const REPO = path.resolve(__dirname, "..");
const ALLOWED_IN_REPO = [path.join(REPO, ".local"), path.join(REPO, "backups")];
const key = () => process.env.ERASURE_LEDGER_KEY;

/** Every value of a repeatable flag. */
function args(name: string) {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]!);
  });
  return out;
}

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
  const lists: LedgerEntry[][] = [];
  const sources: string[] = [];
  for (const b of args("from-backup")) {
    lists.push(await backupTombstones(b));
    sources.push(`backup:${path.basename(b)}`);
  }
  for (const c of args("from-codes")) {
    lists.push(entriesFromPaperRecord(fs.readFileSync(path.resolve(c), "utf8")));
    sources.push("paper-record");
  }
  const url = arg("source") ?? (lists.length ? undefined : process.env.DATABASE_URL);
  if (url) {
    const prisma = createPrismaClient(url);
    try {
      lists.push(await erasedEntries(prisma));
    } finally {
      await prisma.$disconnect();
    }
    sources.push("live-database");
  }
  if (!lists.length) throw new Error("No source: give --source, --from-backup or --from-codes.");
  const r = writeLedgerFile(file, mergeEntries(...lists), sources.join("+"), key());
  console.log(
    `Erasure ledger: ${r.ledger.count} erased code(s) (${r.previousCount} before, ${r.added} added), sha256 ${r.ledger.entriesSha256.slice(0, 12)}…, written to ${file}${r.backupFile ? `; previous kept as ${path.basename(r.backupFile)}` : ""}`,
  );
}

async function main() {
  const out = arg("export");
  const input = arg("apply");
  const check = arg("verify");
  const commands =
    [out, input, check].filter(Boolean).length + (process.argv.includes("--status") ? 1 : 0);
  if (commands !== 1)
    throw new Error(
      "Usage: --export <file> [--source <url>] [--from-backup <file>]... [--from-codes <file>] | --verify <file> | --status --target <url> | --apply <file> --target <url>",
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
    // Verified (structure, completeness, duplicates, checksum, signature) before any write.
    const text = fs.readFileSync(path.resolve(input!), "utf8");
    const r = await applyLedger(prisma, text, key());
    console.log(
      `Erasure ledger applied: ${r.entries} code(s), ${r.codesChanged} changed, ${r.samplesDeleted} sample(s) deleted, ${r.gatesCleared} restore gate(s) cleared.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
