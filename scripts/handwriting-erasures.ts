/**
 * Handwriting erasure ledger (M12 privacy review, docs/DATABASE_BACKUP.md).
 *   npm run handwriting:erasures -- --export <file> [--source <url>]
 *       Writes every erased participant code (code, reason, date; no handwriting) from the
 *       source database (default DATABASE_URL). Read-only.
 *   npm run handwriting:erasures -- --apply <file> --target <url>
 *       Re-applies the ledger to a RESTORED database before it serves traffic, so a backup
 *       taken before an erasure can't bring erased samples back. Idempotent; audited.
 * The ledger is personal-adjacent (pseudonymous codes): it may not be written inside the
 * repository except under the git-ignored .local/ or backups/ folders.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../src/lib/database/client";
import { applyErasureLedger, exportErasureLedger } from "../src/features/handwriting/participants";
import { arg } from "./lib/db-tools";

const REPO = path.resolve(__dirname, "..");
const ALLOWED_IN_REPO = [path.join(REPO, ".local"), path.join(REPO, "backups")];

function safeOutput(file: string) {
  const full = path.resolve(file);
  const inside = (dir: string) => full === dir || full.startsWith(dir + path.sep);
  if (inside(REPO) && !ALLOWED_IN_REPO.some(inside))
    throw new Error(
      "Refusing to write the ledger inside the repository (it is public). Use .local/, backups/ or a path outside the repository.",
    );
  return full;
}

async function main() {
  const out = arg("export");
  const input = arg("apply");
  if (!!out === !!input)
    throw new Error("Usage: --export <file> [--source <url>] | --apply <file> --target <url>");

  if (out) {
    const file = safeOutput(out);
    const url = arg("source") ?? process.env.DATABASE_URL;
    if (!url) throw new Error("No source database (DATABASE_URL or --source).");
    const prisma = createPrismaClient(url);
    try {
      const ledger = await exportErasureLedger(prisma);
      fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });
      console.log(`Erasure ledger: ${ledger.entries.length} erased code(s) written to ${file}`);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  const target = arg("target");
  if (!target)
    throw new Error("--apply needs an explicit --target <database url> (the restored database).");
  const ledger = JSON.parse(fs.readFileSync(path.resolve(input!), "utf8")) as unknown;
  const prisma = createPrismaClient(target);
  try {
    const results = await applyErasureLedger(prisma, ledger);
    const samples = results.reduce((n, r) => n + r.samplesDeleted, 0);
    console.log(
      `Erasure ledger re-applied: ${results.length} code(s); ${samples} resurrected sample(s) deleted again.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
