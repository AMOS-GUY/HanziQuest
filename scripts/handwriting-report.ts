/**
 * Handwriting validation report (markdown on stdout).
 *   npm run handwriting:report               # real samples collected in the Handwriting lab
 *   npm run handwriting:report -- --synthetic   # synthetic baseline over the starter characters
 *
 * The synthetic baseline is NOT evidence of accuracy with real learners; it is a regression
 * reference that uses the same metric definitions as the real study.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { ENGINE_VERSION, THRESHOLDS } from "../src/features/handwriting/evaluate";
import { fromMakeMeAHanzi } from "../src/features/handwriting/reference";
import type { InkStroke, ReferenceCharacter } from "../src/features/handwriting/types";
import { loadStrokeData } from "../src/features/curriculum/stroke-data";
import {
  CATEGORY_LABEL,
  computeMetrics,
  formatRate,
  scoreSample,
  sizeBucket,
  type SampleCategory,
  type ScoredSample,
  type ValidationMetrics,
} from "../src/features/handwriting/validation";
import { longestStroke, toInk, variants } from "../tests/support/handwriting-fixtures";

function synthetic(): ScoredSample[] {
  const content = JSON.parse(
    fs.readFileSync(path.resolve("content/hsk1-starter.json"), "utf8"),
  ) as { characters: Record<string, unknown> };
  const refs: ReferenceCharacter[] = Object.keys(content.characters).map((h) =>
    fromMakeMeAHanzi(h, loadStrokeData(h)!.medians),
  );
  const out: ScoredSample[] = [];
  const add = (
    category: SampleCategory,
    strokes: InkStroke[],
    expected: ReferenceCharacter,
    participant: string,
  ) => {
    const r = scoreSample({ category, strokes }, expected, refs);
    out.push({
      category,
      accepted: r.accepted,
      detected: r.detected,
      band: r.evaluation.band,
      participant,
      inputDevice: "synthetic",
      sizeBucket: sizeBucket(strokes),
    });
  };
  refs.forEach((r, i) => {
    const seed = i * 13 + 1;
    for (const [k, scale] of [0.3, 0.6, 1].entries()) {
      add(
        "CORRECT",
        toInk(r.medians, { seed: seed + k, scale, wobble: 0.015, jitter: 0.01 }),
        r,
        `S${k}`,
      );
    }
    add("WRONG_CHARACTER", toInk(refs[(i + 37) % refs.length]!.medians, { seed }), r, "S0");
    if (r.medians.length >= 2)
      add("MISSING_STROKE", toInk(variants.missingStroke(r, longestStroke(r)), { seed }), r, "S1");
    add("EXTRA_STROKE", toInk(variants.extraStroke(r), { seed }), r, "S2");
    add("WRONG_DIRECTION", toInk(variants.reversed(r, longestStroke(r)), { seed }), r, "S0");
    if (r.medians.length >= 3)
      add("WRONG_ORDER", toInk(variants.swapped(r, 0, r.medians.length - 1), { seed }), r, "S1");
    add("POOR_SHAPE", toInk(variants.distorted(r, longestStroke(r)), { seed }), r, "S2");
  });
  return out;
}

function render(title: string, metrics: ValidationMetrics, note: string) {
  const lines = [
    `# ${title}`,
    "",
    `Engine \`${ENGINE_VERSION}\` · generated ${new Date().toISOString().slice(0, 10)} · ${metrics.total} samples`,
    "",
    note,
    "",
    "| Measure | Result |",
    "| --- | --- |",
    `| False rejection: written correctly, graded below Good | ${formatRate(metrics.falseRejection)} |`,
    `| Structural false acceptance: wrong character, missing or extra stroke graded Good+ | ${formatRate(metrics.structuralFalseAcceptance)} |`,
    `| Technique errors accepted: direction, order or shape fault graded Good (capped by design) | ${formatRate(metrics.techniqueAcceptance)} |`,
    `| Strict false acceptance: any deliberate error graded Good+ | ${formatRate(metrics.falseAcceptance)} |`,
    `| Specific error named in feedback (all deliberate errors) | ${formatRate(metrics.errorNamed)} |`,
    "",
    "| Category | Samples | Accepted | Specific error named |",
    "| --- | --- | --- | --- |",
    ...metrics.byCategory.map(
      (c) =>
        `| ${CATEGORY_LABEL[c.category]} | ${c.total} | ${formatRate(c.accepted)} | ${c.category === "CORRECT" ? "—" : formatRate(c.detected)} |`,
    ),
    "",
    "| Writing size | False acceptance | False rejection |",
    "| --- | --- | --- |",
    ...metrics.breakdowns.sizeBucket.map(
      (b) => `| ${b.key} | ${formatRate(b.far)} | ${formatRate(b.frr)} |`,
    ),
    "",
    `Thresholds in use: band cut-offs ${JSON.stringify(THRESHOLDS.bands)}, identity distance ≤ ${THRESHOLDS.maxIdentityDistance}, unmatched stroke cost > ${THRESHOLDS.unmatchedCost}.`,
  ];
  if (metrics.warnings.length) {
    lines.push("", "**Warnings:**", "", ...metrics.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n") + "\n";
}

async function main() {
  if (process.argv.includes("--synthetic")) {
    const samples = synthetic();
    process.stdout.write(
      render(
        "Handwriting validation: synthetic baseline",
        computeMetrics(samples),
        "Generated ink from the reference strokes with random jitter, wobble and size. **This is not real handwriting** and says nothing about accuracy with real learners. It is a regression reference that uses the same metrics as the real study. The participant-count warning is expected here.",
      ),
    );
    return;
  }
  const { createPrismaClient } = await import("../src/lib/database/client");
  const { analyseSamples } = await import("../src/features/handwriting/samples");
  const prisma = createPrismaClient();
  try {
    const { metrics } = await analyseSamples(prisma);
    process.stdout.write(
      render(
        "Handwriting validation: real samples",
        metrics,
        "Labelled samples from consenting testers, recorded in the Handwriting lab and re-scored with the current engine.",
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
