/**
 * Curriculum provenance (M14). Read-only.
 *   npm run content:provenance                 Report on DATABASE_URL: sources, verification,
 *                                              review metadata and edition tags
 *   npm run content:provenance -- --register   Validate content/sources.json only (no database)
 *   npm run content:provenance -- --reviews    Review progress per published curriculum
 *   npm run content:provenance -- --compare a.txt b.txt
 *                                              Edition mapping dry run: compare two word lists
 *                                              (format as for content:coverage; no database)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { compareLists, sourceRegister } from "../src/features/curriculum/sources";
import { provenanceReport } from "../src/features/curriculum/provenance-report";
import { reviewProgress } from "../src/features/curriculum/review";
import { parseWordList } from "../src/features/curriculum/word-list";
import { createPrismaClient } from "../src/lib/database/client";

async function main() {
  const args = process.argv.slice(2);
  const register = sourceRegister();
  if (args.includes("--register")) {
    console.log(`Source register: ${register.sources.length} entries, valid.`);
    for (const s of register.sources)
      console.log(
        `  ${s.id.padEnd(28)} ${s.kind.padEnd(14)} ${s.licenseStatus.padEnd(13)} ${s.approval.status}`,
      );
    return;
  }
  const at = args.indexOf("--compare");
  if (at >= 0) {
    const [a, b] = [args[at + 1], args[at + 2]];
    if (!a || !b) {
      console.error("Usage: --compare <list-a.txt> <list-b.txt>");
      process.exit(2);
    }
    const read = (f: string) =>
      parseWordList(fs.readFileSync(path.resolve(f), "utf8")).map((e) => e.forms[0]!);
    const r = compareLists(read(a), read(b));
    console.log(`Dry run, nothing written. ${a} vs ${b}`);
    console.log(`  in both: ${r.inBoth.length}`);
    console.log(
      `  only in ${a}: ${r.onlyInA.length}${r.onlyInA.length ? ` (${r.onlyInA.join(" ")})` : ""}`,
    );
    console.log(
      `  only in ${b}: ${r.onlyInB.length}${r.onlyInB.length ? ` (${r.onlyInB.join(" ")})` : ""}`,
    );
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(url);
  try {
    if (args.includes("--reviews")) {
      // Review progress per published curriculum (M14-b). Read-only.
      const curricula = await prisma.curriculum.findMany({
        where: { status: "PUBLISHED" },
        select: { id: true, name: true, version: true },
      });
      for (const c of curricula) {
        const p = await reviewProgress(prisma, c.id, register);
        console.log(
          `${c.name} (${c.version}): ${p.byStatus.approved}/${p.total} approved; needs review ${p.byStatus["needs-review"]}; changes requested ${p.byStatus["changes-requested"]}; changed since approval ${p.byStatus.stale}; status without review record ${p.byStatus["unreviewed-status"]}; blocked by sources ${p.blockedBySources}; curriculum ${p.curriculum}`,
        );
      }
      return;
    }
    console.log(JSON.stringify(await provenanceReport(prisma, register), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
