/**
 * Handwriting replay harness (M13; docs/M13_HANDWRITING_DIAGNOSTICS.md). READ-ONLY.
 *   npm run handwriting:replay                    attempts + duplicates + lab-sample split
 *   npm run handwriting:replay -- --attempts      stored learner attempts only
 *   npm run handwriting:replay -- --samples       lab samples only (add --include-tests for TEST codes)
 *   npm run handwriting:replay -- --confusables   the confusable suite on the starter content
 *   add --details for per-attempt differences (attempt ids and fields; no learner ids or ink)
 *   add --json for machine-readable output
 *   add --limit N to replay at most N attempts (default 5000)
 *
 * Every database access goes through a read-only client: nothing is written, so learner
 * progress, XP, schedules, attempts, consent and samples are untouched. Output never contains
 * user ids, participant codes or strokes. Results on synthetic ink are not accuracy evidence.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPrismaClient } from "../src/lib/database/client";
import { loadStrokeData } from "../src/features/curriculum/stroke-data";
import { curriculumContentSchema } from "../src/features/curriculum/content-schema";
import { confusableDiagnostics } from "../src/features/curriculum/confusable-diagnostics";
import {
  duplicateReport,
  replayStoredAttempts,
  sampleSplit,
  type AttemptReplayReport,
} from "../src/features/handwriting/replay";
import { arg } from "./lib/db-tools";

const has = (flag: string) => process.argv.includes(`--${flag}`);

function printAttempts(r: AttemptReplayReport, details: boolean) {
  console.log(`Stored attempts replayed with ${r.engineVersion}: ${r.attempts}`);
  for (const [status, n] of Object.entries(r.byStatus)) console.log(`  ${status.padEnd(24)} ${n}`);
  console.log(`  nondeterministic replays  ${r.nondeterministic}`);
  if (!details) return;
  for (const x of r.results.filter((x) => x.status !== "identical")) {
    console.log(`  - ${x.attemptId}: ${x.status}${x.problem ? ` (${x.problem})` : ""}`);
    for (const d of x.diffs.slice(0, 12))
      console.log(
        `      ${d.field}: ${JSON.stringify(d.original)} → ${JSON.stringify(d.replayed)}`,
      );
  }
}

async function main() {
  const only = ["attempts", "samples", "confusables"].filter(has);
  const want = (k: string) => only.length === 0 || only.includes(k);
  const json: Record<string, unknown> = {};

  if (want("confusables")) {
    const file = arg("content") ?? "content/hsk1-starter.json";
    const content = curriculumContentSchema.parse(
      JSON.parse(fs.readFileSync(path.resolve(file), "utf8")),
    );
    const d = confusableDiagnostics(content, loadStrokeData);
    if (has("json"))
      json.confusables = {
        ...d.report,
        cases: has("details") ? d.report.cases : undefined,
      };
    else {
      console.log(`Confusable suite on ${file} (SYNTHETIC ink; not evidence about real learners)`);
      for (const line of d.lines) console.log(`  ${line}`);
      const t = d.report.totals;
      console.log(
        `  totals: ${t.falseAcceptances}/${t.confusableTrials} confusable trials accepted (${t.falseAcceptancesInSet} in-set, ${t.falseAcceptancesOutOfSet} out-of-set); ${t.falseRejections}/${t.controlTrials} controls rejected`,
      );
    }
    if (only.length === 1) return finish(json);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(url);
  try {
    if (want("attempts")) {
      const limit = Number(arg("limit") ?? 5000);
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error("--limit must be a positive integer");
      const r = await replayStoredAttempts(prisma, { limit });
      const dup = await duplicateReport(prisma);
      if (has("json"))
        Object.assign(json, {
          attempts: { ...r, results: has("details") ? r.results : undefined },
          duplicates: dup,
        });
      else {
        printAttempts(r, has("details"));
        console.log(
          `Duplicates: ${dup.attempts} attempts; ${dup.duplicateClientEventIds} repeated client event ids; ${dup.sameMomentGroups} same-moment groups (${dup.sameMomentExtraAttempts} extra attempts)`,
        );
      }
    }
    if (want("samples")) {
      const s = await sampleSplit(prisma, { includeTests: has("include-tests") });
      if (has("json")) json.samples = s;
      else {
        console.log(`Lab samples (${s.source}): ${s.total}`);
        for (const [name, set] of [
          ["development", s.development],
          ["held-out", s.heldOut],
        ] as const)
          console.log(
            `  ${name.padEnd(12)} ${set.participants} participant(s), ${set.samples} samples (${set.correct} correct, ${set.incorrect} incorrect)`,
          );
        console.log(`  writers in both sets: ${s.writerOverlap}`);
        console.log(`  reproduces the lab's metrics: ${s.reproducesLabMetrics ? "yes" : "NO"}`);
        console.log(
          s.sufficientForValidation
            ? "  sufficient for a validation estimate"
            : `  NOT sufficient for validation: ${s.insufficientBecause.join("; ")}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  finish(json);
}

function finish(json: Record<string, unknown>) {
  if (has("json")) console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
