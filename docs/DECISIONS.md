# Engineering decisions

Newest first. Each entry: decision, why, consequences.

## 2026-11-10 — M2 learning and handwriting

**D-019 · A lesson completes only with real engagement.** Skip stays available (some learners
can't draw), but completion needs an attempt for every exercise and non-skipped attempts on at
least half of them (`MIN_ENGAGED_RATIO`). Otherwise a lesson could be "completed" by tapping
Skip repeatedly.

**D-018 · Placement tests out units, never single lessons, and only consecutively from the
start.** Two recognition questions per unit; every question in a unit must be correct. Gaps in
the path would confuse progression. The declared HSK level is stored but never used to skip
content.

**D-017 · Placement questions are derived from the assessment id.** The question plan is
regenerated from a seeded PRNG at grading time, so no answers reach the client and no extra
table is needed.

**D-016 · Our own SVG stroke-order player; Hanzi Writer for the guided quiz.** Hanzi Writer's
animation API doesn't support "show strokes 1..n and step back". The player renders the same
Make Me a Hanzi data and reveals each stroke by drawing its median through the stroke's
outline clip (the same technique Hanzi Writer uses). The guided quiz uses Hanzi Writer
unchanged.

**D-015 · Identity is verified against the level's characters, not recognised globally.**
Nearest-neighbour matching against the HSK level's character set (102 now) is reliable and
explainable, and its scope is stated in the UI ("compared with 102 HSK 1 characters"). A
model-based recogniser can replace this step later.

**D-014 · Evidence-based band caps on top of weighted scores.** The spec's weights
(35/25/15/25) let a recognised character with a badly drawn stroke still score about 92.
Caps, such as "a flagged stroke means at most Good", make bands match the feedback shown.
Weights stay configurable per exercise.

**D-013 · Same evaluator on client and server.** Pure TypeScript with no DOM or Node APIs. The
browser gives instant (and later offline) feedback; the server recomputes from raw strokes and
is authoritative.

**D-012 · Using a hint downgrades an attempt to GUIDED.** A hint shows the pinyin or meaning,
then the character, so the attempt is no longer independent recall.

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
