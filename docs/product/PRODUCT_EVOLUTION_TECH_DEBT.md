# Product evolution: technical debt (2026-11-27)

Found during the product-evolution audit. Only one item was fixed in this mission: it blocked an
improvement, and the fix was narrow. The rest are deferred, with evidence.

## High

### H1. `main` CI is red, and nothing stops a red merge

- **Problem:** `verify` fails at the production audit, from the `effect` advisory through
  Prisma. There's no branch protection.
- **Impact:** every PR shows a red check, so "red but probably unrelated" becomes normal. #35 was
  merged on red and broke the build.
- **Evidence:** GitHub check runs on `d3042e8`; `branches/main` reports `protected: false`.
- **Fix:** merge `fix/eslint-9-peer-range`, then activate the rulesets from
  `docs/governance-update`. Ready; owner action.
- **Risk:** low. **Priority:** do first.

## Medium

### M1. No word-list page

- **Problem:** `/vocabulary/[id]` exists, but there's no `/vocabulary` index. The "Vocabulary"
  destination the product brief asks for doesn't exist.
- **Impact:** learners only reach words through lesson pages.
- **Evidence:** the route tree; the 60-page link crawl on 2026-11-26.
- **Proposed solution:** a server page listing words from lessons the learner has reached (any
  `LessonProgress` row), grouped by lesson, through `LEARNER_VISIBLE_LESSON`, so locked lessons'
  words don't leak ahead of progression. A new read-only query and an integration test.
- **Risk:** low, but it touches progression visibility, so it should be reviewed. **Priority:**
  next milestone.

### M2. Admin 404 rewrite follows `AUTH_URL`, not the request host

- **Problem:** `src/proxy.ts` rewrites to `new URL("/not-found-404", request.nextUrl)`. Inside
  `auth()`, `nextUrl` carries `AUTH_URL`'s origin.
- **Impact:** when `AUTH_URL` differs from the serving host, the rewrite proxies to another
  origin. Locally it returned 500 for a learner opening `/admin`. With matching URLs (CI e2e)
  it's correct.
- **Evidence:** the dev server on :3001 with `AUTH_URL` set to :3000 gave `ECONNREFUSED :3000`
  (2026-11-26).
- **Proposed solution:** rewrite against the incoming request's own origin, with an e2e test.
- **Risk:** it's an auth and admin file, so **owner approval is needed**. **Priority:** before
  staging.

### M3. Not-found pages return HTTP 200 while showing the 404 page

- **Problem:** `notFound()` runs after `(learner)/loading.tsx` has started streaming.
- **Impact:** crawlers and monitoring see 200. Pages have `noindex`, and learners are
  unaffected.
- **Proposed solution:** check existence before the streaming boundary, or accept as a Next.js
  limitation.
- **Risk:** low. **Priority:** low–medium.

## Low

- **L1:** schema exercise types (`CHARACTER_RECONSTRUCTION`, `LISTENING_TO_WRITING`) that no
  content generates. Keep, but don't build UI until content and audio exist.
- **L2:** the persistent local `hanziquest_test` database accumulates open disputes, so one
  disputes test fails locally. Fresh databases pass. Document it in LOCAL_CI, or reset the test
  database in global setup.
- **L3:** `.claude/launch.json` is tracked, so a second dev-server configuration changes a
  tracked file. Consider ignoring it, or documenting a second entry.
- **L4:** Dependabot backlog (#7–#12, #36–#38). Triage after the dependency fix: #12 is
  superseded, #11 (TypeScript 7) and #10 (`@types/node` 26) should be held.

## Fixed in this mission

**Practice hub unreachable** (blocked the navigation improvement). The hub moved into the learner
layout and got a nav tab (`feature/learner-navigation`).
