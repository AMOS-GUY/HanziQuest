import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpenCheck,
  Flame,
  Lock,
  PenLine,
  Sparkles,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/database/prisma";
import { getProgressDetails } from "@/features/progress/queries";
import { cn } from "@/lib/utilities/cn";

export const metadata: Metadata = { title: "Progress" };

const ICONS: Record<string, LucideIcon> = {
  "pen-line": PenLine,
  "book-open-check": BookOpenCheck,
  sparkles: Sparkles,
  flame: Flame,
};

const LEVEL_COPY = {
  NEW: { label: "New", className: "bg-surface-muted text-muted-foreground" },
  LEARNING: {
    label: "Learning",
    className: "bg-[#fff1d6] text-[#7a4b00] dark:bg-[#3d2e10] dark:text-[#ffd58a]",
  },
  FAMILIAR: { label: "Familiar", className: "bg-accent text-accent-foreground" },
  MASTERED: { label: "Mastered", className: "bg-primary text-primary-foreground" },
} as const;

function weekday(day: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export default async function ProgressPage() {
  const user = await requireUser();
  const { summary, recent, achievements, characters } = await getProgressDetails(prisma, user.id);
  const maxXp = Math.max(summary.today.goal, ...recent.map((d) => d.xp));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-black">Your progress</h1>

      <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <Zap className="text-primary size-5" aria-hidden />
          <p className="mt-1 text-2xl font-black">{summary.xpTotal}</p>
          <p className="text-muted-foreground text-sm">Total XP</p>
        </Card>
        <Card className="p-4">
          <Flame className="size-5 text-[#d9480f]" aria-hidden />
          <p className="mt-1 text-2xl font-black">{summary.streak.current}</p>
          <p className="text-muted-foreground text-sm">
            Day streak · best {summary.streak.longest}
          </p>
        </Card>
        <Card className="p-4">
          <Sparkles className="text-primary size-5" aria-hidden />
          <p className="mt-1 text-2xl font-black">
            {summary.mastery.FAMILIAR + summary.mastery.MASTERED}
          </p>
          <p className="text-muted-foreground text-sm">Characters learned</p>
        </Card>
        <Card className="p-4">
          <Trophy className="text-primary size-5" aria-hidden />
          <p className="mt-1 text-2xl font-black">
            {achievements.filter((a) => a.earnedAt).length}/{achievements.length}
          </p>
          <p className="text-muted-foreground text-sm">Achievements</p>
        </Card>
      </section>

      <Card className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <CardTitle className="text-base">Today</CardTitle>
          <span className="text-sm font-bold">
            {summary.today.xp}/{summary.today.goal} XP
          </span>
        </div>
        <ProgressBar value={summary.today.xp} max={summary.today.goal} label="Daily goal" />
        <CardDescription>
          {summary.today.goalMet
            ? "Daily goal reached. Nice work!"
            : "Earn XP by writing characters."}
        </CardDescription>
      </Card>

      <section aria-labelledby="last-14">
        <h2 id="last-14" className="mb-3 text-xl font-extrabold">
          Last 14 days
        </h2>
        <Card>
          <ol className="flex h-32 items-end gap-1.5" aria-label="XP per day">
            {recent.map((d) => (
              <li
                key={d.day}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="sr-only">
                  {d.day}: {d.xp} XP{d.goalMet ? ", goal met" : ""}
                </span>
                <div
                  aria-hidden
                  className={cn(
                    "w-full rounded-t-md",
                    d.goalMet ? "bg-primary" : d.xp > 0 ? "bg-primary/50" : "bg-surface-muted",
                  )}
                  style={{ height: `${Math.max(4, Math.round((d.xp / maxXp) * 100))}%` }}
                />
                <span aria-hidden className="text-muted-foreground text-[10px] font-bold">
                  {weekday(d.day)}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </section>

      <section aria-labelledby="characters">
        <h2 id="characters" className="mb-1 text-xl font-extrabold">
          Characters
        </h2>
        <p className="text-muted-foreground mb-3 text-sm">
          A character becomes familiar after you write it from memory on two spaced reviews. It
          becomes mastered after four, once your last two were written with the correct stroke order
          and direction. Traced or hinted practice helps you learn but doesn&apos;t count towards
          mastery.
        </p>
        <ul className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Mastery counts">
          {(["LEARNING", "FAMILIAR", "MASTERED"] as const).map((l) => (
            <li
              key={l}
              className={cn("rounded-full px-2.5 py-0.5 font-bold", LEVEL_COPY[l].className)}
            >
              {LEVEL_COPY[l].label}: {summary.mastery[l]}
            </li>
          ))}
        </ul>
        {characters.length === 0 ? (
          <Card>
            <CardDescription>
              Characters you practise appear here.{" "}
              <Link href="/learn" className="text-primary font-bold underline">
                Start a lesson
              </Link>
            </CardDescription>
          </Card>
        ) : (
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {characters.map((c) => (
              <li key={c.hanzi}>
                <Link
                  href={`/characters/${encodeURIComponent(c.hanzi)}`}
                  className={cn(
                    "flex flex-col items-center rounded-xl p-2 transition-opacity hover:opacity-85",
                    LEVEL_COPY[c.level].className,
                  )}
                >
                  <span lang="zh" className="hanzi text-3xl">
                    {c.hanzi}
                  </span>
                  <span className="text-[11px] font-bold">{LEVEL_COPY[c.level].label}</span>
                  {c.techniqueNeedsWork ? (
                    <span className="text-[10px] font-semibold">Check strokes</span>
                  ) : null}
                  <span className="sr-only">
                    {c.pinyin}, {c.meaning}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="achievements">
        <h2 id="achievements" className="mb-3 text-xl font-extrabold">
          Achievements
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {achievements.map((a) => {
            const Icon = a.earnedAt ? (ICONS[a.icon] ?? Trophy) : Lock;
            return (
              <li key={a.key}>
                <Card className={cn("flex items-center gap-3 p-4", !a.earnedAt && "opacity-70")}>
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full",
                      a.earnedAt
                        ? "bg-accent text-primary"
                        : "bg-surface-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div>
                    <p className="font-bold">
                      {a.name}
                      <span className="sr-only">
                        {a.earnedAt ? " (earned)" : " (not yet earned)"}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-sm">{a.description}</p>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
