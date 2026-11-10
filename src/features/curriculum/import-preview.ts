/**
 * Read-only preview of what importing a validated content file would change (M7). Mirrors the
 * importer's rules (import-content.ts): upserts on stable keys, nothing deleted, contentVersion
 * bumped when a lesson's word list changes, reviewed records protected (provenance.ts).
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { CurriculumContent } from "./content-schema";
import { mayOverwrite } from "./provenance";

export interface FieldChange {
  field: string;
  from: string;
  to: string;
}

export interface RecordChange {
  key: string;
  changes: FieldChange[];
  /** Other curricula whose lessons use this shared record (they see the change too). */
  sharedWith: string[];
  /** The existing record is reviewed/verified and the import isn't: the change is skipped. */
  protected: boolean;
}

export interface ImportPreview {
  curriculum: { slug: string; exists: boolean; status: string | null; changes: FieldChange[] };
  characters: { added: string[]; changed: RecordChange[]; unchanged: number };
  words: { added: string[]; changed: RecordChange[]; unchanged: number };
  lessons: {
    added: string[];
    /** Word list changes: contentVersion bump, offline copies refresh. */
    wordListChanged: string[];
    unchanged: number;
    /** In the database but not in the file: kept, not deleted. */
    notInFile: string[];
  };
}

function diff(fields: Record<string, [string | null | undefined, string | null | undefined]>) {
  const out: FieldChange[] = [];
  for (const [field, [from, to]] of Object.entries(fields)) {
    if ((from ?? "") !== (to ?? "")) out.push({ field, from: from ?? "", to: to ?? "" });
  }
  return out;
}

export async function previewCurriculumImport(
  prisma: PrismaClient,
  content: CurriculumContent,
): Promise<ImportPreview> {
  const c = content.curriculum;
  const existing = await prisma.curriculum.findUnique({
    where: { slug: c.slug },
    select: {
      id: true,
      status: true,
      name: true,
      source: true,
      licenseStatus: true,
      verification: true,
      levels: {
        where: { level: content.level.level },
        select: {
          units: {
            select: {
              slug: true,
              lessons: {
                select: {
                  slug: true,
                  vocabulary: {
                    orderBy: { position: "asc" },
                    select: { vocabulary: { select: { simplified: true, pinyin: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // Characters
  const hanziList = Object.keys(content.characters);
  const chars = await prisma.character.findMany({
    where: { hanzi: { in: hanziList } },
    select: {
      hanzi: true,
      pinyin: true,
      pinyinAlternatives: true,
      meaning: true,
      verification: true,
      lessons: {
        select: {
          lesson: { select: { unit: { select: { level: { select: { curriculum: true } } } } } },
        },
      },
    },
  });
  const charBy = new Map(chars.map((ch) => [ch.hanzi, ch]));
  const characters: ImportPreview["characters"] = { added: [], changed: [], unchanged: 0 };
  for (const [hanzi, def] of Object.entries(content.characters)) {
    const row = charBy.get(hanzi);
    if (!row) {
      characters.added.push(hanzi);
      continue;
    }
    const changes = diff({
      pinyin: [row.pinyin, def.pinyin],
      alternatives: [row.pinyinAlternatives.join(", "), (def.alternatives ?? []).join(", ")],
      meaning: [row.meaning, def.meaning],
    });
    if (changes.length === 0) {
      characters.unchanged += 1;
      continue;
    }
    const sharedWith = [
      ...new Set(
        row.lessons
          .map((l) => l.lesson.unit.level.curriculum)
          .filter((cur) => cur.slug !== c.slug)
          .map((cur) => cur.name),
      ),
    ];
    characters.changed.push({
      key: hanzi,
      changes,
      sharedWith,
      protected: !mayOverwrite(row.verification, c.verification),
    });
  }

  // Words
  const fileWords = content.units.flatMap((u) => u.lessons.flatMap((l) => l.words));
  const vocab = await prisma.vocabulary.findMany({
    where: { OR: fileWords.map((w) => ({ simplified: w.simplified, pinyin: w.pinyin })) },
    select: {
      simplified: true,
      pinyin: true,
      meaning: true,
      partOfSpeech: true,
      verification: true,
      lessons: {
        select: {
          lesson: { select: { unit: { select: { level: { select: { curriculum: true } } } } } },
        },
      },
    },
  });
  const vocabBy = new Map(vocab.map((v) => [`${v.simplified}|${v.pinyin}`, v]));
  const words: ImportPreview["words"] = { added: [], changed: [], unchanged: 0 };
  for (const w of fileWords) {
    const row = vocabBy.get(`${w.simplified}|${w.pinyin}`);
    if (!row) {
      words.added.push(`${w.simplified} (${w.pinyin})`);
      continue;
    }
    const changes = diff({
      meaning: [row.meaning, w.meaning],
      partOfSpeech: [row.partOfSpeech, w.partOfSpeech],
    });
    if (changes.length === 0) {
      words.unchanged += 1;
      continue;
    }
    words.changed.push({
      key: `${w.simplified} (${w.pinyin})`,
      changes,
      sharedWith: [
        ...new Set(
          row.lessons
            .map((l) => l.lesson.unit.level.curriculum)
            .filter((cur) => cur.slug !== c.slug)
            .map((cur) => cur.name),
        ),
      ],
      protected: !mayOverwrite(row.verification, c.verification),
    });
  }

  // Lessons
  const dbLessons = new Map<string, string[]>();
  for (const unit of existing?.levels[0]?.units ?? []) {
    for (const lesson of unit.lessons) {
      dbLessons.set(
        `${unit.slug}/${lesson.slug}`,
        lesson.vocabulary.map((v) => `${v.vocabulary.simplified}|${v.vocabulary.pinyin}`),
      );
    }
  }
  const lessons: ImportPreview["lessons"] = {
    added: [],
    wordListChanged: [],
    unchanged: 0,
    notInFile: [],
  };
  const inFile = new Set<string>();
  for (const unit of content.units) {
    for (const lesson of unit.lessons) {
      const key = `${unit.slug}/${lesson.slug}`;
      inFile.add(key);
      const current = dbLessons.get(key);
      const next = lesson.words.map((w) => `${w.simplified}|${w.pinyin}`);
      if (!current) lessons.added.push(key);
      else if (current.join("\n") !== next.join("\n")) lessons.wordListChanged.push(key);
      else lessons.unchanged += 1;
    }
  }
  lessons.notInFile = [...dbLessons.keys()].filter((k) => !inFile.has(k));

  return {
    curriculum: {
      slug: c.slug,
      exists: existing !== null,
      status: existing?.status ?? null,
      changes: existing
        ? diff({
            name: [existing.name, c.name],
            source: [existing.source, c.source],
            licenseStatus: [existing.licenseStatus, c.licenseStatus],
            verification: [existing.verification, c.verification],
          })
        : [],
    },
    characters,
    words,
    lessons,
  };
}

/** Plain-text rendering for the CLI and the admin import page. */
export function formatImportPreview(p: ImportPreview): string[] {
  const lines: string[] = [];
  lines.push(
    p.curriculum.exists
      ? `Curriculum ${p.curriculum.slug} exists (${p.curriculum.status}).`
      : `Curriculum ${p.curriculum.slug} is new.`,
  );
  for (const ch of p.curriculum.changes) lines.push(`  ${ch.field}: ${ch.from} → ${ch.to}`);
  lines.push(
    `Characters: ${p.characters.added.length} new, ${p.characters.changed.length} changed, ${p.characters.unchanged} unchanged.`,
  );
  for (const r of p.characters.changed) lines.push(...recordLines(r));
  lines.push(
    `Words: ${p.words.added.length} new, ${p.words.changed.length} changed, ${p.words.unchanged} unchanged.`,
  );
  for (const r of p.words.changed) lines.push(...recordLines(r));
  lines.push(
    `Lessons: ${p.lessons.added.length} new, ${p.lessons.wordListChanged.length} with a changed word list (offline copies will refresh), ${p.lessons.unchanged} unchanged.`,
  );
  if (p.lessons.notInFile.length > 0)
    lines.push(`  Kept (not in this file, not deleted): ${p.lessons.notInFile.join(", ")}`);
  return lines;
}

function recordLines(r: RecordChange) {
  const what = r.changes.map((c) => `${c.field} "${c.from}" → "${c.to}"`).join("; ");
  const notes = [
    r.protected ? "SKIPPED: the existing record is reviewed and this import is not" : null,
    r.sharedWith.length > 0 ? `also used by ${r.sharedWith.join(", ")}` : null,
  ].filter(Boolean);
  return [`  ${r.key}: ${what}${notes.length ? ` (${notes.join("; ")})` : ""}`];
}
