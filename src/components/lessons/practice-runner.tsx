"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Eraser, Lightbulb, Loader2, RotateCcw, SkipForward, Undo2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { HandwritingCanvas } from "@/components/handwriting/handwriting-canvas";
import { GuidedStrokeQuiz } from "@/components/handwriting/guided-stroke-quiz";
import { BAND_COPY, BandBanner, WritingFeedback } from "@/components/feedback/writing-feedback";
import { evaluateWord } from "@/features/handwriting/evaluate";
import { fromMakeMeAHanzi } from "@/features/handwriting/reference";
import type { EvaluationBand, InkStroke, WordEvaluation } from "@/features/handwriting/types";
import type { ExerciseDTO, PracticePayload } from "@/features/exercises/dto";
import { ApiRequestError, learningApi, withRetry } from "@/features/exercises/client-api";
import { cn } from "@/lib/utilities/cn";

type SaveState = "saving" | "saved" | "failed";
type Outcome =
  | { kind: "writing"; band: EvaluationBand; evaluation: WordEvaluation; eventId: string }
  | { kind: "guided"; band: EvaluationBand; mistakes: number; eventId: string };

const PROMPT_LABEL: Record<ExerciseDTO["type"], string> = {
  PINYIN_TO_HANZI: "Write it in characters",
  MEANING_TO_HANZI: "Write the Chinese for",
  GUIDED_STROKE: "Trace each stroke in order",
  FREEHAND_WRITING: "Write from memory",
  CHARACTER_RECONSTRUCTION: "Rebuild the character",
  LISTENING_TO_WRITING: "Write what you hear",
};

function guidedBand(mistakes: number, strokeCount: number): EvaluationBand {
  if (mistakes === 0) return "EXCELLENT";
  if (mistakes <= Math.max(1, Math.floor(strokeCount / 3))) return "GOOD";
  if (mistakes <= strokeCount) return "NEEDS_IMPROVEMENT";
  return "TRY_AGAIN";
}

function Prompt({ exercise }: { exercise: ExerciseDTO }) {
  const p = exercise.prompt;
  return (
    <div className="text-center">
      <p className="text-primary text-sm font-extrabold tracking-wide uppercase">
        {PROMPT_LABEL[exercise.type]}
      </p>
      {exercise.type === "PINYIN_TO_HANZI" ? (
        <p className="mt-1 text-3xl font-black">{p.pinyin}</p>
      ) : null}
      {exercise.type === "MEANING_TO_HANZI" ? (
        <p className="mt-1 text-3xl font-black">“{p.meaning}”</p>
      ) : null}
      {exercise.type === "FREEHAND_WRITING" ? (
        <p className="mt-1 text-2xl font-black">
          {p.pinyin} <span className="text-muted-foreground font-semibold">· {p.meaning}</span>
        </p>
      ) : null}
      {exercise.type === "GUIDED_STROKE" ? (
        <p className="mt-1 text-2xl font-black">
          <span lang="zh" className="hanzi">
            {p.hanzi}
          </span>{" "}
          {p.pinyin} <span className="text-muted-foreground font-semibold">· {p.meaning}</span>
        </p>
      ) : null}
    </div>
  );
}

export function PracticeRunner({
  payload,
  lessonId,
  exitHref,
}: {
  payload: PracticePayload;
  lessonId?: string;
  exitHref: string;
}) {
  const { exercises, strokeData, candidates } = payload;
  const reduceMotion = useReducedMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string>();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"answer" | "feedback" | "done">("answer");
  const [drawings, setDrawings] = useState<InkStroke[][]>(
    () => exercises[0]?.characters.map(() => []) ?? [],
  );
  const [active, setActive] = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>();
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [results, setResults] = useState<Record<string, EvaluationBand | "SKIPPED">>({});
  const [completion, setCompletion] = useState<{ nextLessonId: string | null }>();
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string>();
  const [quizKey, setQuizKey] = useState(0);
  const startedAt = useRef(Date.now());
  const payloads = useRef(new Map<string, Record<string, unknown>>());
  const savedExercises = useRef(new Set<string>());

  const exercise = exercises[index];

  useEffect(() => {
    if (!lessonId) return;
    let cancelled = false;
    learningApi
      .startSession(lessonId)
      .then((r) => !cancelled && setSessionId(r.sessionId))
      .catch(
        (e: unknown) =>
          !cancelled &&
          setSessionError(e instanceof ApiRequestError ? e.message : "Could not start the lesson."),
      );
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const references = useMemo(() => {
    const byHanzi = new Map(candidates.map((c) => [c.hanzi, c]));
    return (hanzi: string) =>
      byHanzi.get(hanzi) ?? fromMakeMeAHanzi(hanzi, strokeData[hanzi]?.medians ?? []);
  }, [candidates, strokeData]);

  const resetFor = (i: number) => {
    setDrawings(exercises[i]?.characters.map(() => []) ?? []);
    setActive(0);
    setHintLevel(0);
    setOutcome(undefined);
    setQuizKey((k) => k + 1);
    startedAt.current = Date.now();
    setPhase("answer");
  };

  const save = useCallback(async (eventId: string, exerciseId: string) => {
    const body = payloads.current.get(eventId);
    if (!body) return;
    setSaves((s) => ({ ...s, [eventId]: "saving" }));
    try {
      const response = await withRetry(() => learningApi.submitAttempt(body));
      setSaves((s) => ({ ...s, [eventId]: "saved" }));
      savedExercises.current.add(exerciseId);
      // The server re-evaluates handwriting; its result is authoritative.
      const ev = response.evaluation as WordEvaluation | undefined;
      if (ev && Array.isArray(ev.characters)) {
        setOutcome((o) =>
          o && o.eventId === eventId && o.kind === "writing"
            ? { ...o, band: ev.band, evaluation: ev }
            : o,
        );
        setResults((r) => ({ ...r, [exerciseId]: ev.band }));
      }
    } catch {
      setSaves((s) => ({ ...s, [eventId]: "failed" }));
    }
  }, []);

  const submit = (body: Record<string, unknown>) => {
    if (!exercise) return "";
    const eventId = crypto.randomUUID();
    payloads.current.set(eventId, {
      clientEventId: eventId,
      exerciseId: exercise.id,
      ...(sessionId ? { sessionId } : {}),
      occurredAt: new Date().toISOString(),
      durationMs: Math.min(3_600_000, Date.now() - startedAt.current),
      hintsUsed: hintLevel,
      ...body,
    });
    void save(eventId, exercise.id);
    return eventId;
  };

  const check = () => {
    if (!exercise) return;
    const refs = exercise.characters.map(references);
    const evaluation = evaluateWord(drawings, refs, { candidates });
    const eventId = submit({ kind: "writing", drawings });
    setOutcome({ kind: "writing", band: evaluation.band, evaluation, eventId });
    setResults((r) => ({ ...r, [exercise.id]: evaluation.band }));
    setPhase("feedback");
  };

  const guidedDone = ({ mistakes }: { mistakes: number }) => {
    if (!exercise) return;
    const strokes = strokeData[exercise.characters[0]!]?.strokes.length ?? 1;
    const band = guidedBand(mistakes, strokes);
    const eventId = submit({ kind: "guided", mistakes });
    setOutcome({ kind: "guided", band, mistakes, eventId });
    setResults((r) => ({ ...r, [exercise.id]: band }));
    setPhase("feedback");
  };

  const skip = () => {
    if (!exercise) return;
    submit({ kind: "skip" });
    const latest = { ...results, [exercise.id]: "SKIPPED" as const };
    setResults(latest);
    next(latest);
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(undefined);
    try {
      if (lessonId && sessionId) {
        const r = await withRetry(() => learningApi.completeSession(sessionId));
        setCompletion({ nextLessonId: r.nextLessonId });
      } else {
        setCompletion({ nextLessonId: null });
      }
      setPhase("done");
    } catch (e) {
      setFinishError(
        e instanceof ApiRequestError
          ? e.message
          : "Could not save your progress. Check your connection and try again.",
      );
    } finally {
      setFinishing(false);
    }
  };

  /** Moves to the next exercise not yet done (or skipped); finishes when none is left. */
  function next(latest: Record<string, EvaluationBand | "SKIPPED"> = results) {
    const pendingIndex = exercises.findIndex(
      (e, i) => i > index && (!latest[e.id] || latest[e.id] === "SKIPPED"),
    );
    if (pendingIndex >= 0) {
      setIndex(pendingIndex);
      resetFor(pendingIndex);
    } else {
      void finish();
    }
  }

  const failedSaves = Object.entries(saves).filter(([, s]) => s === "failed");
  const retryFailed = () => {
    for (const [eventId] of failedSaves) {
      const body = payloads.current.get(eventId);
      if (body) void save(eventId, String(body.exerciseId));
    }
  };

  if (sessionError) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 py-10">
        <Alert variant="error">{sessionError}</Alert>
        <Button asChild>
          <Link href={exitHref}>Back</Link>
        </Button>
      </div>
    );
  }

  if (exercises.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">This lesson has no exercises yet.</p>
        <Button asChild className="mt-4">
          <Link href={exitHref}>Back</Link>
        </Button>
      </div>
    );
  }

  if (phase === "done") {
    const values = Object.values(results);
    const count = (b: string) => values.filter((v) => v === b).length;
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 py-10 text-center">
        <h1 className="text-3xl font-black">
          {lessonId ? "Lesson complete!" : "Practice complete!"}
        </h1>
        <Card className="grid grid-cols-2 gap-3 text-left">
          {(["EXCELLENT", "GOOD", "NEEDS_IMPROVEMENT", "TRY_AGAIN", "SKIPPED"] as const).map(
            (b) => (
              <div key={b}>
                <p className="text-2xl font-black">{count(b)}</p>
                <p className="text-muted-foreground text-sm">
                  {BAND_COPY[b].title.replace("!", "")}
                </p>
              </div>
            ),
          )}
        </Card>
        {completion?.nextLessonId ? (
          <Button asChild size="lg">
            <Link href={`/learn/${completion.nextLessonId}`}>Next lesson</Link>
          </Button>
        ) : null}
        <Button asChild size="lg" variant={completion?.nextLessonId ? "secondary" : "primary"}>
          <Link href={lessonId ? "/learn" : exitHref}>
            {lessonId ? "Back to learning path" : "Done"}
          </Link>
        </Button>
      </div>
    );
  }

  if (!exercise) return null;
  const firstSkipped = exercises.findIndex((e) => results[e.id] === "SKIPPED");
  const isWriting = exercise.type !== "GUIDED_STROKE";
  const allDrawn = drawings.every((d) => d.length > 0);
  const currentSave = outcome ? saves[outcome.eventId] : undefined;
  const activeHanzi = exercise.characters[active]!;
  const textHint =
    exercise.type === "MEANING_TO_HANZI" || exercise.type === "PINYIN_TO_HANZI"
      ? exercise.hint
      : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 py-2">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Exit practice">
          <Link href={exitHref}>
            <X className="size-5" />
          </Link>
        </Button>
        <ProgressBar
          value={index + (phase === "feedback" ? 1 : 0)}
          max={exercises.length}
          label="Exercise progress"
        />
        <span className="text-muted-foreground text-sm font-bold whitespace-nowrap">
          {index + 1}/{exercises.length}
        </span>
      </div>

      {finishError ? (
        <Alert variant="error" className="flex flex-col gap-2">
          <span>{finishError}</span>
          {firstSkipped >= 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => {
                setFinishError(undefined);
                setIndex(firstSkipped);
                resetFor(firstSkipped);
              }}
            >
              Go to skipped exercises
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <Prompt exercise={exercise} />

      <AnimatePresence mode="wait" initial={false}>
        {phase === "answer" ? (
          <motion.div
            key={`answer-${index}-${quizKey}`}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col gap-3"
          >
            {isWriting ? (
              <>
                {exercise.characters.length > 1 ? (
                  <div
                    className="flex justify-center gap-2"
                    role="tablist"
                    aria-label="Characters to write"
                  >
                    {exercise.characters.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        role="tab"
                        aria-selected={i === active}
                        onClick={() => setActive(i)}
                        className={cn(
                          "border-border rounded-full border-2 px-4 py-1 text-sm font-bold",
                          i === active && "border-primary bg-accent text-accent-foreground",
                          drawings[i]!.length > 0 && i !== active && "border-primary/50",
                        )}
                      >
                        Character {i + 1}
                        {drawings[i]!.length > 0 ? " ✓" : ""}
                      </button>
                    ))}
                  </div>
                ) : null}
                <HandwritingCanvas
                  key={`${index}-${active}-${quizKey}`}
                  strokes={drawings[active]!}
                  onChange={(s) => setDrawings((d) => d.map((v, i) => (i === active ? s : v)))}
                  ghost={hintLevel >= (textHint ? 2 : 1) ? activeHanzi : null}
                  label={`Writing area for character ${active + 1} of ${exercise.characters.length}`}
                />
                {textHint && hintLevel >= 1 ? (
                  <p className="text-muted-foreground text-center text-sm font-bold">
                    Hint: {textHint}
                  </p>
                ) : null}
                <div className="grid grid-cols-4 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={drawings[active]!.length === 0}
                    onClick={() =>
                      setDrawings((d) => d.map((v, i) => (i === active ? v.slice(0, -1) : v)))
                    }
                  >
                    <Undo2 aria-hidden /> Undo
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={drawings[active]!.length === 0}
                    onClick={() => setDrawings((d) => d.map((v, i) => (i === active ? [] : v)))}
                  >
                    <Eraser aria-hidden /> Clear
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={hintLevel >= (textHint ? 2 : 1)}
                    onClick={() => setHintLevel((h) => h + 1)}
                  >
                    <Lightbulb aria-hidden /> Hint
                  </Button>
                  <Button variant="ghost" size="sm" onClick={skip}>
                    <SkipForward aria-hidden /> Skip
                  </Button>
                </div>
                {exercise.characters.length > 1 &&
                active < exercise.characters.length - 1 &&
                !allDrawn ? (
                  <Button
                    size="lg"
                    disabled={drawings[active]!.length === 0}
                    onClick={() => setActive(active + 1)}
                  >
                    Next character
                  </Button>
                ) : (
                  <Button size="lg" disabled={!allDrawn} onClick={check}>
                    Check
                  </Button>
                )}
                {hintLevel > 0 ? (
                  <p className="text-muted-foreground text-center text-xs">
                    Using a hint makes this guided practice rather than recall.
                  </p>
                ) : null}
              </>
            ) : strokeData[activeHanzi] ? (
              <>
                <GuidedStrokeQuiz
                  key={quizKey}
                  hanzi={activeHanzi}
                  data={strokeData[activeHanzi]!}
                  onComplete={guidedDone}
                />
                <Button variant="ghost" size="sm" onClick={skip} className="self-center">
                  <SkipForward aria-hidden /> Skip
                </Button>
              </>
            ) : (
              <Alert variant="error">Stroke data for this character is missing.</Alert>
            )}
          </motion.div>
        ) : (
          <motion.div
            key={`feedback-${index}-${quizKey}`}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-4"
          >
            {outcome?.kind === "writing" ? (
              <>
                <BandBanner band={outcome.band} />
                <WritingFeedback
                  evaluation={outcome.evaluation}
                  drawings={drawings}
                  strokeData={strokeData}
                />
              </>
            ) : outcome?.kind === "guided" ? (
              <BandBanner
                band={outcome.band}
                detail={
                  outcome.mistakes === 0
                    ? "Every stroke traced in order on the first try."
                    : `Traced with ${outcome.mistakes} mistake${outcome.mistakes === 1 ? "" : "s"}.`
                }
              />
            ) : null}

            <p
              className="text-muted-foreground text-center text-xs font-semibold"
              aria-live="polite"
            >
              {currentSave === "saving"
                ? "Saving…"
                : currentSave === "saved"
                  ? "Saved"
                  : currentSave === "failed"
                    ? "Not saved yet."
                    : ""}
              {currentSave === "failed" ? (
                <button
                  type="button"
                  className="text-primary ml-1 font-bold underline"
                  onClick={retryFailed}
                >
                  Retry
                </button>
              ) : null}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" onClick={() => resetFor(index)}>
                <RotateCcw aria-hidden /> Retry
              </Button>
              <Button
                size="lg"
                disabled={finishing || currentSave === "saving"}
                onClick={() => next()}
              >
                {finishing ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {index + 1 < exercises.length ? "Continue" : "Finish"}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
