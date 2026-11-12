/**
 * The curriculum source register (M14, docs/CURRICULUM_PROVENANCE_PLAN.md).
 *
 * Every external input to curriculum content (a word list, a dictionary, stroke data, an
 * example-sentence source) is an entry in `content/sources.json`, with its licence and the
 * kinds of field it may supply. Content files cite entries by id; the validator refuses
 * unknown ids, fields a source may not supply, edition (HSK level) tags from a source that
 * isn't approved for membership, and REVIEWED/VERIFIED items resting on unapproved or
 * unknown-licence sources. Pure functions: the register is passed in.
 */
import { z } from "zod";
import registerJson from "../../../content/sources.json";
import type { CurriculumContent } from "./content-schema";
import type { ContentIssue } from "./validate-content";

export const SOURCE_KINDS = ["AUTHORED", "OFFICIAL_LIST", "DATASET", "REFERENCE"] as const;

/** What a source may supply. */
export const SOURCE_PROVIDES = [
  "membership",
  "reading",
  "gloss",
  "example",
  "structure",
  "exercises",
  "strokes",
  "audio",
] as const;
export type SourceProvides = (typeof SOURCE_PROVIDES)[number];

export const sourceIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9.-]{1,63}$/,
    "Source ids use lowercase letters, digits, dots and hyphens",
  );

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const sourceEntrySchema = z.strictObject({
  id: sourceIdSchema,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(SOURCE_KINDS),
  publisher: z.string().trim().min(1).max(200),
  edition: z.string().trim().max(100).optional(),
  url: z.url().optional(),
  isbn: z.string().trim().max(20).optional(),
  obtainedOn: isoDate.optional(),
  licenseStatus: z.enum(["UNKNOWN", "OPEN_LICENSE", "LICENSED", "ORIGINAL", "PUBLIC_FACT"]),
  /** The exact licence, e.g. "Arphic Public License" or "CC BY-SA 4.0". */
  license: z.string().trim().min(1).max(200),
  /** What using it obliges us to do (attribution, share-alike, ...). */
  obligations: z.array(z.string().trim().min(1).max(300)).max(10),
  provides: z.array(z.enum(SOURCE_PROVIDES)).min(1),
  /** Owner approval of using this source. PENDING sources may back PROVISIONAL items only. */
  approval: z.strictObject({
    status: z.enum(["APPROVED", "PENDING"]),
    /** A role, never a name. */
    approverRole: z.string().trim().max(60).optional(),
    approvedOn: isoDate.optional(),
  }),
  notes: z.string().trim().max(1000).optional(),
});
export type SourceEntry = z.infer<typeof sourceEntrySchema>;

export const sourceRegisterSchema = z
  .strictObject({
    $comment: z.string().optional(),
    sources: z.array(sourceEntrySchema),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.sources.forEach((s, i) => {
      if (seen.has(s.id))
        ctx.addIssue({
          code: "custom",
          path: ["sources", i, "id"],
          message: `Duplicate id ${s.id}`,
        });
      seen.add(s.id);
      if (s.approval.status === "APPROVED" && (!s.approval.approverRole || !s.approval.approvedOn))
        ctx.addIssue({
          code: "custom",
          path: ["sources", i, "approval"],
          message: "An approved source records the approver's role and the date",
        });
      if (s.provides.includes("membership") && s.kind !== "OFFICIAL_LIST")
        ctx.addIssue({
          code: "custom",
          path: ["sources", i, "provides"],
          message: "Only an OFFICIAL_LIST source may supply level membership",
        });
    });
  });
export type SourceRegister = z.infer<typeof sourceRegisterSchema>;

export const DEFAULT_SOURCE_REGISTER = "content/sources.json";

export function parseSourceRegister(input: unknown): SourceRegister {
  return sourceRegisterSchema.parse(input);
}

/** The repository's register, bundled at build time (content/ isn't in the server image). */
export function sourceRegister(): SourceRegister {
  return parseSourceRegister(registerJson);
}

type Verification = "PROVISIONAL" | "REVIEWED" | "VERIFIED";

/** Checks every source reference in a content file against the register. */
export function checkSources(content: CurriculumContent, register: SourceRegister): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const byId = new Map(register.sources.map((s) => [s.id, s]));
  const error = (p: string, message: string) =>
    issues.push({ severity: "error", path: p, message });

  /** Resolves refs, checking each supplies `need` (any one of) and suits `verification`. */
  const check = (
    p: string,
    refs: readonly string[] | undefined,
    need: readonly SourceProvides[],
    verification: Verification,
  ) => {
    for (const ref of refs ?? []) {
      const src = byId.get(ref);
      if (!src) {
        error(p, `Source "${ref}" is not in the source register (${DEFAULT_SOURCE_REGISTER})`);
        continue;
      }
      if (need.length && !need.some((n) => src.provides.includes(n)))
        error(p, `Source "${ref}" may not supply ${need.join(" or ")}`);
      if (verification !== "PROVISIONAL" && src.approval.status !== "APPROVED")
        error(p, `${verification} content can't rest on "${ref}", which isn't approved yet`);
      if (verification === "VERIFIED" && src.licenseStatus === "UNKNOWN")
        error(p, `VERIFIED content can't rest on "${ref}", whose licence is unknown`);
    }
  };

  const c = content.curriculum;
  if (!c.sourceRefs?.length)
    error("curriculum.sourceRefs", "Cite at least one registered source for the curriculum");
  check("curriculum.sourceRefs", c.sourceRefs, [], c.verification);

  const editionCheck = (
    p: string,
    editions: { sourceRef: string; hsk20Level?: number; hsk30Level?: number } | undefined,
  ) => {
    if (!editions) return;
    const src = byId.get(editions.sourceRef);
    if (!src) {
      error(`${p}.editions`, `Source "${editions.sourceRef}" is not in the source register`);
      return;
    }
    if (!src.provides.includes("membership") || src.approval.status !== "APPROVED")
      error(`${p}.editions`, `HSK level tags need an approved list source; "${src.id}" isn't one`);
    // Never mix editions: an HSK 2.0 curriculum may not carry items tagged only for HSK 3.0.
    if (c.framework === "HSK_2_0" && editions.hsk20Level === undefined)
      error(`${p}.editions`, "Item in an HSK 2.0 curriculum has no HSK 2.0 level tag");
    if (c.framework === "HSK_3_0" && editions.hsk30Level === undefined)
      error(`${p}.editions`, "Item in an HSK 3.0 curriculum has no HSK 3.0 level tag");
  };

  for (const [hanzi, def] of Object.entries(content.characters)) {
    check(`characters.${hanzi}.sourceRefs`, def.sourceRefs, ["reading", "gloss"], c.verification);
    editionCheck(`characters.${hanzi}`, def.editions);
  }
  content.units.forEach((unit, u) =>
    unit.lessons.forEach((lesson, l) =>
      lesson.words.forEach((word, w) => {
        const p = `units.${u}.lessons.${l}.words.${w}`;
        check(`${p}.sourceRefs`, word.sourceRefs, ["reading", "gloss"], c.verification);
        editionCheck(p, word.editions);
        if (word.example) {
          check(`${p}.example`, [word.example.sourceRef], ["example"], word.example.verification);
          if (!word.example.zh.includes(word.simplified))
            error(`${p}.example.zh`, `The example doesn't contain ${word.simplified}`);
          if (word.example.verification !== "PROVISIONAL" && c.verification === "PROVISIONAL")
            error(
              `${p}.example.verification`,
              "An example can't be more verified than its curriculum",
            );
        }
      }),
    ),
  );
  return issues;
}

export interface ListComparison {
  onlyInA: string[];
  onlyInB: string[];
  inBoth: string[];
}

/**
 * Edition mapping (dry run): compares two word or character lists, e.g. HSK 2.0 Level 1 vs
 * HSK 3.0 Level 1. Takes plain arrays so it can be tested on synthetic fixtures until real,
 * registered lists are approved. Writes nothing.
 */
export function compareLists(a: readonly string[], b: readonly string[]): ListComparison {
  const setA = new Set(a);
  const setB = new Set(b);
  const sort = (xs: Iterable<string>) => [...xs].sort((x, y) => x.localeCompare(y, "zh"));
  return {
    onlyInA: sort([...setA].filter((x) => !setB.has(x))),
    onlyInB: sort([...setB].filter((x) => !setA.has(x))),
    inBoth: sort([...setA].filter((x) => setB.has(x))),
  };
}
