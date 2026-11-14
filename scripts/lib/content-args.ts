/**
 * Arguments of the content CLI (`scripts/content.ts`). Strict on purpose: an unknown option or a
 * second file is an error, so a command never silently acts on a different file than the one
 * named. (An earlier version ignored a file given first and used the default file instead.)
 */
export const CONTENT_COMMANDS = ["validate", "import", "preview", "coverage"] as const;
export type ContentCommand = (typeof CONTENT_COMMANDS)[number];
export const DEFAULT_CONTENT_FILE = "content/hsk1-starter.json";

export type ContentArgs =
  | { ok: true; command: ContentCommand; file: string; draft: boolean; listFile?: string }
  | { ok: false; error: string };

export function parseContentArgs(argv: readonly string[]): ContentArgs {
  const [command, ...rest] = argv;
  if (!CONTENT_COMMANDS.includes(command as ContentCommand))
    return { ok: false, error: `Unknown command "${command ?? ""}".` };
  let draft = false;
  let listFile: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i]!;
    if (a === "--draft") draft = true;
    else if (a === "--list") {
      listFile = rest[i + 1];
      if (!listFile || listFile.startsWith("--"))
        return { ok: false, error: "--list needs a file." };
      i += 1;
    } else if (a.startsWith("--")) return { ok: false, error: `Unknown option "${a}".` };
    else files.push(a);
  }
  if (files.length > 1)
    return { ok: false, error: `One content file at a time (got ${files.join(", ")}).` };
  if (draft && command !== "import") return { ok: false, error: "--draft is for import only." };
  if (listFile && command !== "coverage")
    return { ok: false, error: "--list is for coverage only." };
  return {
    ok: true,
    command: command as ContentCommand,
    file: files[0] ?? DEFAULT_CONTENT_FILE,
    draft,
    ...(listFile && { listFile }),
  };
}
