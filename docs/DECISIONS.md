# Engineering decisions

Newest first. Each entry: decision, why, consequences.

## 2026-11-10 — M0/M1 foundation

**D-011 · Integration tests don't wipe the database.** Prisma blocks `migrate reset` when an AI
agent runs it unless the user explicitly consents. Integration tests instead run
`migrate deploy` (non-destructive) and isolate themselves with unique per-run identifiers. The
test database grows slowly; drop and recreate it by hand when needed.

**D-010 · No Dockerfile yet.** Docker isn't available on the development machine, so a
Dockerfile couldn't be tested, and Vercel doesn't need one. CI uses a Postgres service
container. If a self-hosted target is chosen, add one in M4.

**D-009 · Local PostgreSQL via `embedded-postgres`.** There is no Docker or system Postgres on
the dev machine. `npm run db:local` runs real PostgreSQL 18 binaries from npm, so dev matches
production behaviour (unlike SQLite or PGlite). The cluster must be created with
`--encoding=UTF8`; the Windows default, WIN1252, can't store Hanzi.

**D-008 · Exercises are generated at import time.** The importer creates exercises from lesson
words using stable keys (`word:你好:nǐ hǎo:pinyin-to-hanzi`). Exercises are database rows, never
hardcoded in the frontend, and re-imports update them in place.

**D-007 · Characters and words are global; exercises are per curriculum version.** A character's
identity doesn't change between HSK versions, but lessons and exercises do. This keeps mastery
history valid across curriculum upgrades.

**D-006 · The starter curriculum is labelled PROVISIONAL.** The word selection follows the
public HSK 2.0 Level 1 list, but glosses and pinyin were written by HanziQuest and haven't been
reviewed by a teacher. The UI shows a "Provisional content" badge until verification is set to
VERIFIED.

**D-005 · JWT sessions, but roles are checked against the database on every request.**
Credentials sign-in requires the JWT strategy in Auth.js. Putting roles in the token would let
revoked roles survive until the token expires, so the token carries only the user id.

**D-004 · Unauthorized admin pages return 404, not 403.** This avoids confirming to learners
which admin URLs exist. Server actions return 401/403 because they are called by our own UI.

**D-003 · Version pins.** Next 16.4.6, React 19.3.1, Prisma 7.10.1 (8.0 is RC only), Auth.js
`next-auth@5.0.0-beta.32` (v5 is the only line supporting the App Router well, and it officially
supports Next 16), Tailwind 4.3, Zod 4.6. TypeScript is pinned to 5.9.3 rather than the new
native TypeScript 7, so editor and ESLint tooling stay compatible. ESLint stays on 9.x because
`eslint-config-next` plugins aren't verified on 10 yet.

**D-002 · shadcn-style primitives written in the repo.** We use the same pattern as shadcn/ui
(Radix + `cva` + `tailwind-merge`, in `src/components/ui`) without the CLI, which needs network
prompts and would scaffold unused components. More components can be added the same way.

**D-001 · Logo usage.** The `_wBG` variants are the complete artwork (the plain variants have
transparent cut-outs). The Emerald `_wBG` file is the primary logo, copied unchanged to
`public/branding`. See `docs/BRANDING.md`.
