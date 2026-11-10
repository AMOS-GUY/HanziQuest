/**
 * Content quality report over the live database (M7): what is missing, inconsistent or still
 * unverified. Read-only. Shown at /admin/content-quality and by `npm run content:report`.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { checkWordReadings } from "./readings";

export interface QualityFinding {
  severity: "error" | "warning" | "info";
  area: "curriculum" | "lesson" | "character" | "word" | "exercise";
  key: string;
  message: string;
  href?: string;
}

export interface ContentQualityReport {
  generatedAt: string;
  curricula: {
    id: string;
    name: string;
    status: string;
    verification: string;
    licenseStatus: string;
    publishedLessons: number;
    draftLessons: number;
  }[];
  totals: {
    characters: number;
    charactersByVerification: Record<string, number>;
    words: number;
    wordsByVerification: Record<string, number>;
    wordsWithoutExample: number;
    wordsWithoutAudio: number;
    publishedExercises: number;
  };
  findings: QualityFinding[];
}

const LIMIT = 200;

export async function contentQualityReport(prisma: PrismaClient): Promise<ContentQualityReport> {
  const findings: QualityFinding[] = [];

  const curricula = await prisma.curriculum.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      verification: true,
      licenseStatus: true,
      levels: {
        select: {
          units: {
            select: {
              lessons: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  exercises: {
                    where: { exercise: { status: "PUBLISHED" } },
                    select: { exercise: { select: { type: true } } },
                  },
                  characters: { where: { isNew: true }, select: { characterId: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const curriculumRows = curricula.map((c) => {
    const lessons = c.levels.flatMap((l) => l.units.flatMap((u) => u.lessons));
    if (c.status === "PUBLISHED" && c.licenseStatus === "UNKNOWN") {
      findings.push({
        severity: "error",
        area: "curriculum",
        key: c.name,
        message: "Published with an UNKNOWN licence. Confirm the right to use it.",
        href: `/admin/curricula/${c.id}`,
      });
    }
    if (c.status === "PUBLISHED" && c.verification !== "VERIFIED") {
      findings.push({
        severity: "info",
        area: "curriculum",
        key: c.name,
        message: `Published as ${c.verification}: learners see a "Provisional content" notice until a qualified teacher verifies it.`,
        href: `/admin/curricula/${c.id}`,
      });
    }
    for (const lesson of lessons) {
      if (lesson.status !== "PUBLISHED") continue;
      if (lesson.exercises.length === 0) {
        findings.push({
          severity: "error",
          area: "lesson",
          key: `${c.name} › ${lesson.title}`,
          message: "Published lesson has no published exercises (it can never be completed).",
          href: `/admin/lessons/${lesson.id}`,
        });
      } else if (
        lesson.characters.length > 0 &&
        !lesson.exercises.some((e) => e.exercise.type === "FREEHAND_WRITING")
      ) {
        findings.push({
          severity: "warning",
          area: "lesson",
          key: `${c.name} › ${lesson.title}`,
          message:
            "Introduces characters but has no free-writing exercise, so they never enter review.",
          href: `/admin/lessons/${lesson.id}`,
        });
      }
    }
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      verification: c.verification,
      licenseStatus: c.licenseStatus,
      publishedLessons: lessons.filter((l) => l.status === "PUBLISHED").length,
      draftLessons: lessons.filter((l) => l.status !== "PUBLISHED").length,
    };
  });

  // Characters: stroke data present and consistent.
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      hanzi: true,
      pinyin: true,
      pinyinAlternatives: true,
      meaning: true,
      strokeCount: true,
      hasStrokeData: true,
      verification: true,
      _count: { select: { strokes: true, lessons: true } },
    },
  });
  const charactersByVerification: Record<string, number> = {};
  for (const ch of characters) {
    charactersByVerification[ch.verification] =
      (charactersByVerification[ch.verification] ?? 0) + 1;
    const used = ch._count.lessons > 0;
    if (used && !ch.hasStrokeData) {
      findings.push({
        severity: "warning",
        area: "character",
        key: ch.hanzi,
        message: "Taught in a lesson but has no stroke data, so it gets no writing exercises.",
        href: `/admin/characters/${ch.id}`,
      });
    }
    if (ch.hasStrokeData && ch._count.strokes !== (ch.strokeCount ?? -1)) {
      findings.push({
        severity: "error",
        area: "character",
        key: ch.hanzi,
        message: `Stroke count ${ch.strokeCount ?? "missing"} doesn't match ${ch._count.strokes} stored strokes.`,
        href: `/admin/characters/${ch.id}`,
      });
    }
    if (!ch.meaning.trim() || !ch.pinyin.trim()) {
      findings.push({
        severity: "error",
        area: "character",
        key: ch.hanzi,
        message: "Missing pinyin or meaning.",
        href: `/admin/characters/${ch.id}`,
      });
    }
  }
  const readingsOf = new Map(characters.map((c) => [c.hanzi, [c.pinyin, ...c.pinyinAlternatives]]));

  // Words: readings consistent with their characters; examples and audio.
  const words = await prisma.vocabulary.findMany({
    select: {
      id: true,
      simplified: true,
      pinyin: true,
      meaning: true,
      exampleZh: true,
      audioUrl: true,
      verification: true,
      _count: { select: { lessons: true } },
    },
  });
  const wordsByVerification: Record<string, number> = {};
  let wordsWithoutExample = 0;
  let wordsWithoutAudio = 0;
  for (const w of words) {
    wordsByVerification[w.verification] = (wordsByVerification[w.verification] ?? 0) + 1;
    if (!w.exampleZh) wordsWithoutExample += 1;
    if (!w.audioUrl) wordsWithoutAudio += 1;
    for (const issue of checkWordReadings(w.simplified, w.pinyin, (h) => readingsOf.get(h))) {
      findings.push({
        severity: "warning",
        area: "word",
        key: `${w.simplified} (${w.pinyin})`,
        message: issue.message,
        href: `/admin/vocabulary/${w.id}`,
      });
    }
  }

  // Exercises whose expected answer contains characters without stroke data.
  const noStrokes = new Set(characters.filter((c) => !c.hasStrokeData).map((c) => c.hanzi));
  const exercises = await prisma.exercise.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, key: true, expectedAnswer: true },
  });
  for (const e of exercises) {
    const missing = [...e.expectedAnswer].filter((ch) => noStrokes.has(ch));
    if (missing.length > 0) {
      findings.push({
        severity: "error",
        area: "exercise",
        key: e.key,
        message: `Expects ${missing.join("")}, which has no stroke data, so it can't be graded.`,
        href: `/admin/exercises/${e.id}`,
      });
    }
  }

  const order = { error: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.key.localeCompare(b.key));
  return {
    generatedAt: new Date().toISOString(),
    curricula: curriculumRows,
    totals: {
      characters: characters.length,
      charactersByVerification,
      words: words.length,
      wordsByVerification,
      wordsWithoutExample,
      wordsWithoutAudio,
      publishedExercises: exercises.length,
    },
    findings: findings.slice(0, LIMIT),
  };
}
