"use client";

import { useEffect, useRef, useState } from "react";
// Static import so the library ships with the page and works in offline practice.
import HanziWriter from "hanzi-writer";
import type { CharacterStrokeJson } from "@/features/handwriting/reference-store";
import { GridLines } from "@/components/characters/stroke-order-player";

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Guided stroke practice using Hanzi Writer's quiz mode: the learner traces each stroke in order
 * over the outline; wrong strokes are rejected and hinted after repeated misses. This is GUIDED
 * practice — Hanzi Writer checks one stroke at a time, it is not free handwriting recognition.
 */
export function GuidedStrokeQuiz({
  hanzi,
  data,
  onComplete,
}: {
  hanzi: string;
  data: CharacterStrokeJson;
  onComplete: (summary: { mistakes: number }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState({ done: 0, mistakes: 0 });
  const [loadError, setLoadError] = useState(false);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let writer: { cancelQuiz: () => void } | null = null;

    Promise.resolve()
      .then(() => {
        if (cancelled) return;
        const size = Math.round(host.getBoundingClientRect().width);
        const instance = HanziWriter.create(host, hanzi, {
          width: size,
          height: size,
          padding: Math.round(size * 0.06),
          showCharacter: false,
          showOutline: true,
          strokeColor: cssVar("--foreground", "#18332f"),
          outlineColor: cssVar("--surface-muted", "#f4efe2"),
          drawingColor: cssVar("--primary", "#087f70"),
          highlightColor: cssVar("--brand-mint", "#55cdb5"),
          drawingWidth: Math.max(12, Math.round(size * 0.05)),
          charDataLoader: () => data,
          onLoadCharDataError: () => setLoadError(true),
        });
        writer = instance;
        void instance.quiz({
          showHintAfterMisses: 2,
          onMistake: (s) => setProgress({ done: s.strokeNum, mistakes: s.totalMistakes }),
          onCorrectStroke: (s) => setProgress({ done: s.strokeNum + 1, mistakes: s.totalMistakes }),
          onComplete: (summary) => onCompleteRef.current({ mistakes: summary.totalMistakes }),
        });
      })
      .catch(() => setLoadError(true));

    return () => {
      cancelled = true;
      writer?.cancelQuiz();
      host.innerHTML = "";
    };
  }, [hanzi, data]);

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div className="border-border bg-surface relative aspect-square w-full rounded-3xl border-2">
        <GridLines />
        <div
          ref={hostRef}
          className="absolute inset-0 touch-none"
          role="application"
          aria-label={`Trace each stroke of ${hanzi} in order`}
        />
      </div>
      <p className="text-muted-foreground text-sm font-bold" aria-live="polite">
        {loadError
          ? "Stroke data could not be loaded."
          : `Stroke ${Math.min(progress.done + 1, data.strokes.length)} of ${data.strokes.length}` +
            (progress.mistakes > 0
              ? ` · ${progress.mistakes} mistake${progress.mistakes === 1 ? "" : "s"}`
              : "")}
      </p>
    </div>
  );
}
