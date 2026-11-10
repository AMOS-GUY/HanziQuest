"use client";

import { CheckCircle2, CircleAlert, Sparkles, XCircle } from "lucide-react";
import type {
  CharacterEvaluation,
  EvaluationBand,
  InkStroke,
  WordEvaluation,
} from "@/features/handwriting/types";
import type { CharacterStrokeJson } from "@/features/handwriting/reference-store";
import { MMAH_TRANSFORM } from "@/components/characters/stroke-geometry";
import { techniqueNote } from "@/features/handwriting/technique";
import { cn } from "@/lib/utilities/cn";

export const BAND_COPY: Record<
  EvaluationBand | "SKIPPED",
  { title: string; tone: "great" | "ok" | "warn" | "bad" }
> = {
  EXCELLENT: { title: "Excellent!", tone: "great" },
  GOOD: { title: "Good", tone: "ok" },
  NEEDS_IMPROVEMENT: { title: "Needs improvement", tone: "warn" },
  TRY_AGAIN: { title: "Try again", tone: "bad" },
  SKIPPED: { title: "Skipped", tone: "warn" },
};

const TONE_CLASS = {
  great: "bg-accent text-accent-foreground",
  ok: "bg-accent text-accent-foreground",
  warn: "bg-[#fff1d6] text-[#7a4b00] dark:bg-[#3d2e10] dark:text-[#ffd58a]",
  bad: "bg-danger-surface text-danger",
};

export function BandBanner({
  band,
  detail,
}: {
  band: EvaluationBand | "SKIPPED";
  detail?: string;
}) {
  const copy = BAND_COPY[band];
  const Icon =
    copy.tone === "great"
      ? Sparkles
      : copy.tone === "ok"
        ? CheckCircle2
        : copy.tone === "warn"
          ? CircleAlert
          : XCircle;
  return (
    <div
      role="status"
      className={cn("flex items-center gap-3 rounded-2xl px-4 py-3", TONE_CLASS[copy.tone])}
    >
      <Icon className="size-7 shrink-0" aria-hidden />
      <div>
        <p className="text-xl font-black">{copy.title}</p>
        {detail ? <p className="text-sm font-semibold opacity-90">{detail}</p> : null}
      </div>
    </div>
  );
}

function level(value: number) {
  if (value >= 0.9) return { label: "Good", className: "text-primary" };
  if (value >= 0.6) return { label: "Fair", className: "text-[#9a6200] dark:text-[#ffd58a]" };
  return { label: "Needs work", className: "text-danger" };
}

/** Learner's ink drawn over the faint reference character; flagged strokes in coral. */
function InkOverlay({
  ink,
  reference,
  flagged,
}: {
  ink: InkStroke[];
  reference?: CharacterStrokeJson;
  flagged: Set<number>;
}) {
  return (
    <svg
      viewBox="0 0 1 1"
      className="border-border bg-surface size-28 shrink-0 rounded-2xl border-2"
      aria-hidden
    >
      {reference ? (
        <g transform="scale(0.0009765625)">
          <g transform={MMAH_TRANSFORM}>
            {reference.strokes.map((d, i) => (
              <path key={i} d={d} fill="var(--surface-muted)" />
            ))}
          </g>
        </g>
      ) : null}
      {ink.map((stroke, i) => (
        <polyline
          key={i}
          points={stroke.points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={flagged.has(i) ? "var(--brand-coral)" : "var(--foreground)"}
          strokeWidth={0.035}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function CharacterFeedback({
  evaluation,
  ink,
  reference,
  candidateLabel,
}: {
  evaluation: CharacterEvaluation;
  ink: InkStroke[];
  reference?: CharacterStrokeJson;
  candidateLabel: string;
}) {
  const flaggedRefs = new Set(
    evaluation.feedback.filter((f) => f.stroke).map((f) => f.stroke! - 1),
  );
  const flagged = new Set(
    evaluation.matches
      .filter((m) => m.referenceStroke === null || flaggedRefs.has(m.referenceStroke))
      .map((m) => m.userStroke),
  );
  const dims = evaluation.identity.verified
    ? [
        { name: "Stroke order", value: evaluation.dimensions.strokeOrder },
        { name: "Stroke direction", value: evaluation.dimensions.direction },
        { name: "Shape and position", value: evaluation.dimensions.shape },
      ]
    : [];

  return (
    <div className="flex gap-4">
      <InkOverlay ink={ink} reference={reference} flagged={flagged} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <p className="font-bold">
          <span lang="zh" className="hanzi text-lg">
            {evaluation.hanzi}
          </span>{" "}
          · {evaluation.strokeCount.actual} of {evaluation.strokeCount.expected} strokes
        </p>
        <p className={evaluation.identity.verified ? "text-primary" : "text-danger"}>
          {evaluation.identity.verified
            ? `Recognised as ${evaluation.hanzi}`
            : `Not recognised as ${evaluation.hanzi}`}
          <span className="text-muted-foreground"> (compared with {candidateLabel})</span>
        </p>
        {dims.length > 0 ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5">
            {dims.map((d) => {
              const l = level(d.value);
              return (
                <div key={d.name} className="contents">
                  <dt className="text-muted-foreground">{d.name}</dt>
                  <dd className={cn("font-bold", l.className)}>{l.label}</dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        {techniqueNote(evaluation) ? (
          <p className="text-accent-foreground bg-accent rounded-lg px-2 py-1 font-semibold">
            {techniqueNote(evaluation)}
          </p>
        ) : null}
        {evaluation.feedback.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-5">
            {evaluation.feedback.map((f, i) => (
              <li key={i}>{f.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function WritingFeedback({
  evaluation,
  drawings,
  strokeData,
}: {
  evaluation: WordEvaluation;
  drawings: InkStroke[][];
  strokeData: Record<string, CharacterStrokeJson>;
}) {
  const count = evaluation.characters[0]?.identity.candidateCount ?? 0;
  const candidateLabel = `${count} HSK 1 character${count === 1 ? "" : "s"}`;
  return (
    <div className="flex flex-col gap-4">
      {evaluation.characters.map((c, i) => (
        <CharacterFeedback
          key={i}
          evaluation={c}
          ink={drawings[i] ?? []}
          reference={strokeData[c.hanzi]}
          candidateLabel={candidateLabel}
        />
      ))}
    </div>
  );
}
