"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Choice } from "@/components/ui/choice";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProgressBar } from "@/components/ui/progress-bar";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import {
  DAILY_GOAL_OPTIONS,
  EXPERIENCE_OPTIONS,
  OBJECTIVE_OPTIONS,
  type OnboardingInput,
} from "@/features/onboarding/schema";

type Draft = Omit<OnboardingInput, "experienceLevel" | "takePlacement"> & {
  experienceLevel?: OnboardingInput["experienceLevel"];
};

const STEPS = 5;

export function OnboardingFlow({ name }: { name: string }) {
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();
  const [draft, setDraft] = useState<Draft>({
    declaredHskLevel: 0,
    declaredLessonNote: "",
    learningObjectives: [],
    dailyGoalXp: 20,
    timezone: "UTC",
  });

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value, read once after mount
      if (tz) setDraft((d) => ({ ...d, timezone: tz }));
    } catch {
      // keep UTC
    }
  }, []);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const canContinue = step !== 0 || Boolean(draft.experienceLevel);

  const finish = (takePlacement: boolean) => {
    setError(undefined);
    startTransition(async () => {
      const result = await completeOnboardingAction({ ...draft, takePlacement });
      if (result?.error) setError(result.error);
    });
  };

  const titles = [
    `Nice to meet you${name ? `, ${name}` : ""}! How much Chinese do you know?`,
    "Have you studied for the HSK?",
    "What are you learning for?",
    "Pick a daily goal",
    "Want to skip what you already know?",
  ];

  return (
    <div className="flex flex-col gap-6 pt-2">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous question"
          disabled={step === 0 || pending}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <ProgressBar value={step + 1} max={STEPS} label="Onboarding progress" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={step}
          initial={reduceMotion ? false : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -24 }}
          transition={{ duration: 0.18 }}
          aria-labelledby="onboarding-title"
          className="flex flex-col gap-4"
        >
          <h1 id="onboarding-title" className="text-2xl font-black">
            {titles[step]}
          </h1>

          {step === 0 ? (
            <div
              role="radiogroup"
              aria-labelledby="onboarding-title"
              className="flex flex-col gap-2"
            >
              {EXPERIENCE_OPTIONS.map((o) => (
                <Choice
                  key={o.value}
                  label={o.label}
                  selected={draft.experienceLevel === o.value}
                  onSelect={() => update({ experienceLevel: o.value })}
                >
                  {o.label}
                </Choice>
              ))}
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <div
                role="radiogroup"
                aria-labelledby="onboarding-title"
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              >
                {[0, 1, 2, 3, 4, 5, 6].map((level) => (
                  <Choice
                    key={level}
                    label={level === 0 ? "Not yet / not sure" : `HSK ${level}`}
                    selected={draft.declaredHskLevel === level}
                    onSelect={() => update({ declaredHskLevel: level })}
                    className={level === 0 ? "col-span-2 sm:col-span-4" : undefined}
                  >
                    {level === 0 ? "Not yet / not sure" : `HSK ${level}`}
                  </Choice>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lesson-note">Current textbook or lesson (optional)</Label>
                <Input
                  id="lesson-note"
                  maxLength={120}
                  placeholder="e.g. HSK Standard Course 1, lesson 5"
                  value={draft.declaredLessonNote}
                  onChange={(e) => update({ declaredLessonNote: e.target.value })}
                />
              </div>
              <p className="text-muted-foreground text-sm">
                This helps us plan, but we&apos;ll still check what you know before skipping
                anything.
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-2" role="group" aria-labelledby="onboarding-title">
              {OBJECTIVE_OPTIONS.map((o) => {
                const selected = draft.learningObjectives.includes(o.value);
                return (
                  <Choice
                    key={o.value}
                    label={o.label}
                    role="checkbox"
                    selected={selected}
                    onSelect={() =>
                      update({
                        learningObjectives: selected
                          ? draft.learningObjectives.filter((v) => v !== o.value)
                          : [...draft.learningObjectives, o.value],
                      })
                    }
                  >
                    {o.label}
                  </Choice>
                );
              })}
            </div>
          ) : null}

          {step === 3 ? (
            <div
              role="radiogroup"
              aria-labelledby="onboarding-title"
              className="flex flex-col gap-2"
            >
              {DAILY_GOAL_OPTIONS.map((o) => (
                <Choice
                  key={o.value}
                  label={`${o.label}, ${o.value} XP, ${o.detail}`}
                  selected={draft.dailyGoalXp === o.value}
                  onSelect={() => update({ dailyGoalXp: o.value })}
                >
                  <span className="flex justify-between gap-2">
                    <span>{o.label}</span>
                    <span className="text-muted-foreground font-semibold">
                      {o.value} XP · {o.detail}
                    </span>
                  </span>
                </Choice>
              ))}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground">
                A two-minute placement check asks you to recognise a few characters from each HSK 1
                unit. Units you clearly know are marked as tested out, so you can start further
                along. Or start from the very first lesson.
              </p>
              {error ? <Alert variant="error">{error}</Alert> : null}
              <Button size="lg" disabled={pending} onClick={() => finish(true)}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Take the placement check
              </Button>
              <Button
                size="lg"
                variant="secondary"
                disabled={pending}
                onClick={() => finish(false)}
              >
                Start from the beginning
              </Button>
            </div>
          ) : null}
        </motion.section>
      </AnimatePresence>

      {step < STEPS - 1 ? (
        <Button size="lg" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>
          Continue
        </Button>
      ) : null}
    </div>
  );
}
