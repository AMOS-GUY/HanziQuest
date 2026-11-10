# HanziQuest

A Chinese character handwriting and learning platform, built as a Progressive Web App. Learners
practise HSK vocabulary, learn stroke order, write characters by hand and review them with
spaced repetition.

**Status:** pre-beta, in development. See [docs/PROGRESS.md](docs/PROGRESS.md) for what works
today.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Auth.js v5 ·
PostgreSQL + Prisma 7 · Zod · Vitest · Playwright

## Getting started

Requirements: Node.js 20.19+ (24 recommended). Docker is not needed.

```bash
npm install
cp .env.example .env              # then set AUTH_SECRET (npx auth secret)
npm run db:local                  # terminal 1: local PostgreSQL on :5433 (keep it running)
npm run db:deploy                 # terminal 2: apply migrations
npm run db:seed                   # roles, achievements, HSK 1 starter content
npm run dev                       # http://localhost:3000
```

To create an admin, set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` (12+ characters) in `.env`
and run `npm run db:seed` again.

## Scripts

| Script                                               | Purpose                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `dev` / `build` / `start`                            | Next.js                                                             |
| `lint`, `typecheck`, `format`                        | Code quality                                                        |
| `test`                                               | Unit tests (Vitest)                                                 |
| `test:integration`                                   | Integration tests against `TEST_DATABASE_URL`                       |
| `test:e2e`                                           | Playwright against a production build (run `build` first)           |
| `db:local`                                           | Local PostgreSQL without Docker                                     |
| `db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Prisma                                                              |
| `content:validate` / `content:import`                | Curriculum content pipeline                                         |
| `progress:rebuild`                                   | Recompute mastery and review schedules from attempt history         |
| `handwriting:report` (`-- --synthetic`)              | Handwriting validation report (real samples / synthetic baseline)   |
| `smoke -- <url>`                                     | Read-only post-deployment smoke test                                |
| `db:backup` / `db:restore` / `db:verify`             | Portable logical backup, restore into an empty DB, and verification |
| `brand:icons`                                        | Copy the approved logos and generate PWA icons                      |

## Repository layout

```
content/            curriculum source files (JSON)
docs/               architecture, database, branding, curriculum, security, decisions, progress
icon design/        original approved logo artwork (never modified)
prisma/             schema, migrations, seed
public/             branding copies, PWA icons
scripts/            local database, content CLI, icon generation
src/app/            routes: (auth), (learner), admin, api
src/components/     UI primitives, navigation, brand
src/features/       application services and server actions by domain
src/lib/            auth, permissions, validation, security, database
tests/              unit, integration, e2e
```

## Content and licences

The starter curriculum follows the HSK 2.0 Level 1 word list. Its glosses and pinyin are
**provisional** until reviewed by a teacher (see [docs/CURRICULUM.md](docs/CURRICULUM.md)).
Stroke data comes from [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)
(Make Me a Hanzi, Arphic Public License).
