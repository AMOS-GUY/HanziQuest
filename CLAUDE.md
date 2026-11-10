# CLAUDE.md

Guidance for AI agents working in this repository.

## Project

HanziQuest is a Chinese character handwriting and learning PWA. It is a modular monolith on
Next.js 16 App Router + Prisma 7 + PostgreSQL. The product requirements are the owner's master
prompt. Status and the milestone checklist are in `docs/PROGRESS.md`. Record significant
decisions in `docs/DECISIONS.md`.

## Commands

```bash
npm run db:local            # local Postgres on :5433 (background it; needed for dev/tests)
npm run dev
npm run lint && npm run typecheck && npm test
npm run test:integration    # needs db:local running
npm run build && npx playwright test
npm run content:validate
```

## Rules

- **Logos:** never modify anything in `icon design/`. The app uses copies made by
  `npm run brand:icons`. See `docs/BRANDING.md`.
- **Business rules go in `src/features/*` services** that take a `PrismaClient`. Pages, actions
  and route handlers only validate, authorize and delegate.
- **Authorization is server-side.** Pages call `requirePagePermission`. Server actions and route
  handlers call `assertPermission`. Never rely on hidden UI.
- **Never trust client values** for XP, mastery, roles or entitlements.
- **Curriculum is data.** Never hardcode lessons or exercises in the frontend. Change
  `content/*.json` and re-import.
- **Don't label content official/verified** unless its `verification` is `VERIFIED`.
- **Migrations:** create them with `prisma migrate dev`. Never edit applied migrations. Never run
  `migrate reset` or `db push` against shared or production databases.
- Every protected mutation writes an audit log entry in the same transaction.
- Chinese text: add `lang="zh"` or the `.hanzi` class so the CJK font stack applies.
- Respect `prefers-reduced-motion`. Keep components accessible (labels, focus, contrast).
- Report status honestly. Don't mark features done that are only UI.

## Gotchas

- The Prisma client is generated into `src/generated/prisma` (git-ignored). `npm install` runs
  `prisma generate`.
- The local Postgres cluster must be UTF-8 (`scripts/local-postgres.ts` handles it).
- Next 16: `params`/`searchParams` are Promises, and middleware is called `proxy.ts`.
- `hanzi-writer-data` coordinates use a 1024 grid with the y axis pointing up (top edge y = 900).
