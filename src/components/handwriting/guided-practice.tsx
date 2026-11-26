"use client";

import { useState } from "react";
import { Eye, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StrokeOrderPlayer } from "@/components/characters/stroke-order-player";
import { GuidedStrokeQuiz } from "@/components/handwriting/guided-stroke-quiz";
import type { CharacterStrokeJson } from "@/features/handwriting/reference-store";

/**
 * Guided stroke practice with a "watch first" option: the learner can switch between watching
 * the stroke order (StrokeOrderPlayer) and tracing it (GuidedStrokeQuiz), as often as they like.
 * Idea from Anesu's Watch / Practice toggle (PR #35, feature/quiz-logic).
 *
 * Only for GUIDED_STROKE exercises. Guided attempts are always recorded as guided practice and
 * graded on tracing mistakes alone, so watching changes no grading rule. It isn't offered for
 * free writing, where showing the strokes would be an unrecorded hint.
 */
export function GuidedPractice({
  hanzi,
  data,
  onComplete,
}: {
  hanzi: string;
  data: CharacterStrokeJson;
  onComplete: (summary: { mistakes: number }) => void;
}) {
  const [watching, setWatching] = useState(false);
  // A fresh trace each time the learner comes back from watching.
  const [traceKey, setTraceKey] = useState(0);

  const trace = () => {
    if (!watching) return;
    setWatching(false);
    setTraceKey((k) => k + 1);
  };

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div role="group" aria-label="Practice mode" className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={watching ? "primary" : "secondary"}
          aria-pressed={watching}
          onClick={() => setWatching(true)}
        >
          <Eye aria-hidden /> Watch the strokes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={watching ? "secondary" : "primary"}
          aria-pressed={!watching}
          onClick={trace}
        >
          <PenLine aria-hidden /> Trace it
        </Button>
      </div>
      {watching ? (
        <div className="flex w-full flex-col items-center gap-3">
          <StrokeOrderPlayer hanzi={hanzi} data={data} />
          <Button type="button" size="lg" onClick={trace}>
            I&apos;m ready to trace
          </Button>
        </div>
      ) : (
        <GuidedStrokeQuiz key={traceKey} hanzi={hanzi} data={data} onComplete={onComplete} />
      )}
    </div>
  );
}
