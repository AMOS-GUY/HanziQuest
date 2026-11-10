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

## Not built yet

The handwriting engine, exercise runner, progression (mastery, spaced repetition, XP, streaks),
offline storage and sync, and the service worker are planned for milestones M2–M3. Their
database tables already exist; see `docs/PROGRESS.md` for status. This document is updated as
each one ships.
