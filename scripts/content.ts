/**
 * Curriculum content CLI.
 *   npm run content:validate -- [file]   Validate a content file (default: content/hsk1-starter.json)
 *   npm run content:import   -- [file]   Validate, then import into DATABASE_URL (new lessons are published)
 *   add --draft to import new lessons as drafts instead.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadStrokeData } from "../src/features/curriculum/stroke-data";
import { validateCurriculumContent } from "../src/features/curriculum/validate-content";
import { importCurriculumContent } from "../src/features/curriculum/import-content";
import { createPrismaClient } from "../src/lib/database/client";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const draft = rest.includes("--draft");
  const file = rest.find((a) => !a.startsWith("--")) ?? "content/hsk1-starter.json";
  if (command !== "validate" && command !== "import") {
    console.error("Usage: content.ts <validate|import> [file] [--draft]");
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

  const prisma = createPrismaClient();
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
