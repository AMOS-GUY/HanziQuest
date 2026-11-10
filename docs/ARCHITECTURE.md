# Architecture

HanziQuest is a **modular monolith**: one Next.js (App Router) application containing the
learner app, the admin app and the API, backed by one PostgreSQL database. There are no
microservices.

```
Browser (React, PWA) ──► Next.js server ──► application services ──► Prisma ──► PostgreSQL
                          │  pages (RSC)     src/features/*            src/generated/prisma
                          │  server actions
                          │  route handlers
                          └► Auth.js (JWT session cookie)
```

## Layers

| Layer                | Location                    | Responsibility                                                                                                                                            |
| -------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes / pages       | `src/app/**`                | Render UI, read search params, call `requireUser` / `requirePagePermission`. No business rules.                                                           |
| Server actions       | `src/features/*/actions.ts` | Entry points for mutations: validate input (Zod), check permissions with `assertPermission`, rate limit, call a service, revalidate.                      |
| Application services | `src/features/*/*.ts`       | Business rules (registration, role changes, publishing, curriculum import). Take a `PrismaClient` argument so they can be tested against a real database. |
| Shared libraries     | `src/lib/**`                | Auth, permissions, validation schemas, rate limiting, audit logging, database client, utilities.                                                          |
| UI components        | `src/components/**`         | Presentational components and shadcn-style primitives (`components/ui`).                                                                                  |
| Content              | `content/*.json`            | Curriculum source files, validated and imported by `scripts/content.ts`.                                                                                  |

Route groups:

- `(auth)` holds `/login` and `/register`. It redirects signed-in users to `/home`.
- `(learner)` holds `/home`, `/learn` and `/profile`. It requires sign-in and has a sidebar on
  desktop and a bottom nav on mobile.
- `admin` holds `/admin/**`. It requires `admin:access`, and each page checks its own
  permission.

## Authentication and authorization

- Auth.js v5 with the Credentials provider (email + bcrypt password). The session strategy is
  JWT, which Auth.js requires for credentials. The JWT holds only the user id.
- Every server-side check (`getCurrentUser`) reloads the user, status and roles from the
  database, so suspensions and role changes take effect on the next request.
- Permissions are defined in `src/lib/permissions/permissions.ts` (role → permission map). Pages
  call `requirePagePermission(p)`, which returns 404 for users without permission. Actions and
  route handlers call `assertPermission(p)`, which throws 401/403.
- Navigation hides links the user can't use, but that is only cosmetic. Every protected action
  checks permissions on the server.

## Data access

- Prisma 7 with the `prisma-client` generator (output `src/generated/prisma`, git-ignored) and
  the `@prisma/adapter-pg` driver adapter.
- `src/lib/database/prisma.ts` is the shared server client (`server-only`).
  `src/lib/database/client.ts` creates clients for scripts and tests.
- Multi-step writes (registration, publishing, role changes, imports) run in transactions, with
  the audit-log write in the same transaction.

## Learning flow (M2)

```
/onboarding ─► /placement (optional) ─► /home ─► /learn ─► /learn/:lessonId ─► /practice/lesson/:lessonId
                                                    │            ├─ /vocabulary/:id
                                                    │            └─ /characters/:hanzi ─► /practice/character/:hanzi
```

- Route groups: `(onboarding)` (no nav), `(learner)` (nav, onboarding required), `(practice)`
  (focused full-screen runner).
- **Progression** (`features/progression/lesson-states.ts`): lesson state is derived from
  `LessonProgress` rows in curriculum order. The first lesson is available; each lesson unlocks
  when the previous one is COMPLETED or TESTED_OUT. The server enforces this when starting a
  session.
- **Practice runner** (`components/lessons/practice-runner.tsx`): one client component drives
  every exercise type. It evaluates handwriting locally for instant feedback, posts each attempt
  to `/api/attempts` (with retries) and shows the server's authoritative result.
- **Handwriting engine:** see `docs/HANDWRITING.md`.

## Progress (M3)

- `features/progress/mastery.ts`, `xp-rules.ts` and `calendar.ts` are pure rule modules, unit
  tested without a database.
- `features/progress/record.ts` applies the effects of an attempt or lesson completion inside
  the same transaction that stores it: per-character results, mastery and review replay, XP,
  daily activity and goal, streak, achievements. It runs under a per-learner advisory lock.
- Screens: `/review` (due list and 7-day forecast; `/practice/review` runs a round of up to 10
  due characters), `/progress` (XP, streak, 14-day chart, mastery grid, achievements) and the
  Home cards.

## Offline (M3)

```
lesson page ──"Download for offline"──► POST /api/lessons/:id/download ──► IndexedDB (Dexie) packages
offline:  any navigation ──SW──► /offline (cached) ──► /offline/practice?lesson=… (PracticeRunner)
attempt save fails on network ──► IndexedDB outbox ──(online / every 60 s)──► POST /api/sync
```

- `public/sw.js`: precaches `/offline` and `/offline/practice` and the build assets they
  reference. `/_next/static` is cache-first; navigations are network-first with the offline
  page as fallback; `/api/*` is never cached.
- `features/offline/client/` holds the Dexie database (`outbox`, `packages`, `meta`) and the
  sync client. `components/offline/sync-manager.tsx` registers the worker, uploads the outbox
  and shows a status pill.
- The practice runner treats network failures as offline: attempts and lesson completion go to
  the outbox, and the learner sees "Saved on this device".

## Not built yet

Admin curriculum editing and import UI, analytics, moderation, a shared rate-limit store,
nonce-based CSP and Sentry are planned for M4. See `docs/PROGRESS.md`.
