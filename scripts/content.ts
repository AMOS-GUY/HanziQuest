/**
 * Curriculum content CLI.
 *   npm run content:validate -- [file]   Validate a content file (default: content/hsk1-starter.json)
 *   npm run content:import   -- [file]   Validate, then import into DATABASE_URL (new lessons are published)
 *   add --draft to import new lessons as drafts instead.
 *   npm run content:preview  -- [file]   Validate, then show what an import would change (read-only)
 *   npm run content:coverage -- [file] --list <word-list.txt>
 *                                        Compare against an authoritative word list you supply
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadStrokeData } from "../src/features/curriculum/stroke-data";
import { validateCurriculumContent } from "../src/features/curriculum/validate-content";
import { importCurriculumContent } from "../src/features/curriculum/import-content";
import { createPrismaClient } from "../src/lib/database/client";
import {
  formatImportPreview,
  previewCurriculumImport,
} from "../src/features/curriculum/import-preview";
import { compareWithWordList, parseWordList } from "../src/features/curriculum/word-list";

const COMMANDS = ["validate", "import", "preview", "coverage"] as const;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const draft = rest.includes("--draft");
  const listIndex = rest.indexOf("--list");
  const listFile = listIndex >= 0 ? rest[listIndex + 1] : undefined;
  const file =
    rest.find((a, i) => !a.startsWith("--") && i !== listIndex + 1) ?? "content/hsk1-starter.json";
  if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
    console.error(
      "Usage: content.ts <validate|import|preview|coverage> [file] [--draft] [--list words.txt]",
    );
    process.exit(2);
  }

  const input = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const result = validateCurriculumContent(input, loadStrokeData);
  for (const issue of result.issues) {
    console.log(`${issue.severity.toUpperCase().padEnd(7)} ${issue.path}: ${issue.message}`);
  }
  console.log(
    `${file}: ${result.stats.units} units, ${result.stats.lessons} lessons, ${result.stats.words} words, ${result.stats.characters} characters`,
  );
  if (!result.ok || !result.content) {
    console.error("Validation failed.");
    process.exit(1);
  }
  console.log("Validation passed.");
  if (command === "validate") return;

  if (command === "coverage") {
    if (!listFile) {
      console.error("coverage needs --list <file> (one word per line; see docs/CURRICULUM.md)");
      process.exit(2);
    }
    const report = compareWithWordList(
      result.content,
      parseWordList(fs.readFileSync(path.resolve(listFile), "utf8")),
    );
    console.log(
      `List: ${report.listSize} entries. Content: ${report.contentWords} words, ${report.covered} in the list.`,
    );
    if (report.notInList.length > 0) {
      console.log(
        `Not in the list (${report.notInList.length}); don't present these as list words:`,
      );
      for (const w of report.notInList) console.log(`  ${w.simplified}  (${w.lesson})`);
    }
    if (report.pinyinDiffers.length > 0) {
      console.log(`Pinyin differs from the list (${report.pinyinDiffers.length}):`);
      for (const w of report.pinyinDiffers)
        console.log(`  ${w.simplified}: content "${w.content}", list "${w.list}"`);
    }
    console.log(`List entries not taught yet: ${report.missing.length}`);
    for (const e of report.missing.slice(0, 200)) console.log(`  ${e.forms.join("/")}`);
    return;
  }

  const prisma = createPrismaClient();
  if (command === "preview") {
    try {
      const preview = await previewCurriculumImport(prisma, result.content);
      for (const line of formatImportPreview(preview)) console.log(line);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  try {
    const summary = await importCurriculumContent(prisma, result.content, {
      publishNewLessons: !draft,
      lookupStrokes: loadStrokeData,
    });
    console.log("Import complete:", summary);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
