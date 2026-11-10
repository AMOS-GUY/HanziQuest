"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Choice } from "@/components/ui/choice";
import { ProgressBar } from "@/components/ui/progress-bar";
import { submitPlacementAction } from "@/features/onboarding/actions";
import type { PlacementSummary, PublicPlacementQuestion } from "@/features/assessment/placement";

export function PlacementQuiz({
  assessmentId,
  questions,
}: {
  assessmentId: string;
  questions: PublicPlacementQuestion[];
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null | undefined)[]>(() =>
    questions.map(() => undefined),
  );
  const [summary, setSummary] = useState<PlacementSummary>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  if (questions.length === 0) {
    return (
      <Card>
        <p>No placement questions are available right now.</p>
        <Button asChild className="mt-4">
          <Link href="/home">Continue</Link>
        </Button>
      </Card>
    );
  }

  if (summary) {
    return (
      <div className="flex flex-col gap-4 pt-4">
        <h1 className="text-3xl font-black">Placement complete</h1>
        <Card>
          <p className="text-lg font-bold">
            You recognised {summary.correct} of {summary.total} characters.
          </p>
          <p className="text-muted-foreground mt-2">
            {summary.lessonsTestedOut > 0
              ? `${summary.unitsTestedOut} unit${summary.unitsTestedOut === 1 ? "" : "s"} (${summary.lessonsTestedOut} lessons) marked as tested out. You can still open them any time.`
              : "We'll start you at the first lesson so nothing is skipped."}
          </p>
        </Card>
        <Button asChild size="lg">
          <Link href="/home">Start learning</Link>
        </Button>
      </div>
    );
  }

  const question = questions[index]!;
  const chosen = answers[index];
  const choose = (value: number | null) =>
    setAnswers((a) => a.map((v, i) => (i === index ? value : v)));
  const isLast = index === questions.length - 1;

  const next = () => {
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await submitPlacementAction({
        assessmentId,
        answers: answers.map((a) => a ?? null),
      });
      if (result.error) setError(result.error);
      else setSummary(result.summary);
    });
  };

  return (
    <div className="flex flex-col gap-5 pt-2">
      <ProgressBar value={index + 1} max={questions.length} label="Placement progress" />
      <p className="text-muted-foreground text-sm font-bold">
        Question {index + 1} of {questions.length}
      </p>
      <h1 id="placement-q" className="text-2xl font-black">
        What does this character mean?
      </h1>
      <div
        lang="zh"
        className="hanzi border-border bg-surface mx-auto rounded-3xl border-2 px-10 py-4 text-8xl"
      >
        {question.hanzi}
      </div>
      <div role="radiogroup" aria-labelledby="placement-q" className="flex flex-col gap-2">
        {question.options.map((option, i) => (
          <Choice
            key={`${index}-${i}`}
            label={option}
            selected={chosen === i}
            onSelect={() => choose(i)}
          >
            {option}
          </Choice>
        ))}
        <Choice
          label="I don't know"
          selected={chosen === null}
          onSelect={() => choose(null)}
          className="text-muted-foreground"
        >
          I don&apos;t know
        </Choice>
      </div>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Button size="lg" disabled={chosen === undefined || pending} onClick={next}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {isLast ? "Finish" : "Next"}
      </Button>
    </div>
  );
}
