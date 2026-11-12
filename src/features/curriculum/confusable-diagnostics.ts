/**
 * Advisory confusable-character diagnostics for curriculum imports (M13).
 *
 * Runs the confusable suite (synthetic ink, the unchanged engine) for the characters a content
 * file teaches, with that file's characters as the candidate set: the same set learners are
 * checked against for this level. Never blocks or changes an import: the result is text for the
 * import preview and the content CLI. Deterministic: fixed seeds, sorted output.
 */
import { runConfusableSuite, type ConfusableReport } from "@/features/handwriting/confusables";
import type { CurriculumContent } from "./content-schema";
import type { StrokeData } from "./stroke-data";

export interface ConfusableDiagnostics {
  report: ConfusableReport;
  /** One line per risky pair, deduplicated and sorted. */
  risks: {
    expected: string;
    submitted: string;
    submittedInCandidateSet: boolean;
    accepted: number;
    trials: number;
  }[];
  lines: string[];
}

/** Characters the file asks learners to write (those used in its words). */
export function taughtCharacters(content: CurriculumContent) {
  return new Set(
    content.units.flatMap((u) =>
      u.lessons.flatMap((l) => l.words.flatMap((w) => [...w.simplified])),
    ),
  );
}

export function confusableDiagnostics(
  content: CurriculumContent,
  lookupStrokes: (hanzi: string) => StrokeData | null,
): ConfusableDiagnostics {
  const taught = taughtCharacters(content);
  const report = runConfusableSuite({
    taught,
    candidateSet: [...taught].filter((h) => lookupStrokes(h) !== null),
    lookup: (h) => lookupStrokes(h)?.medians ?? null,
  });
  const risks = report.pairs
    .filter((p) => p.falseAcceptances > 0)
    .map((p) => ({
      expected: p.expected,
      submitted: p.submitted,
      submittedInCandidateSet: p.submittedInCandidateSet,
      accepted: p.falseAcceptances,
      trials: p.trials,
    }));
  const t = report.totals;
  const lines = [
    `Confusable-character check (advisory; synthetic ink, not real handwriting; engine ${report.engineVersion}, config ${report.configId}): ` +
      `${report.pairs.length} look-alike pair(s) checked for this file's characters, ${risks.length} accepted at least once. ` +
      "This never blocks an import.",
  ];
  for (const r of risks)
    lines.push(
      r.submittedInCandidateSet
        ? `Advisory: writing ${r.submitted} when ${r.expected} is asked was accepted in ${r.accepted} of ${r.trials} synthetic trials, although both are in this level. Report it: the engine should tell them apart.`
        : `Advisory: writing ${r.submitted} when ${r.expected} is asked was accepted in ${r.accepted} of ${r.trials} synthetic trials. ${r.submitted} isn't in this level's character set, so identity checking can't reject it; only stroke geometry can.`,
    );
  if (report.missingReferences.length)
    lines.push(`Not checked (no stroke data): ${report.missingReferences.join(" ")}.`);
  if (t.falseRejections)
    lines.push(
      `Note: ${t.falseRejections} of ${t.controlTrials} correctly written synthetic controls were rejected.`,
    );
  return { report, risks, lines };
}
