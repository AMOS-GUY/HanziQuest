# Progress

Target public beta: **2026-12-08**.

## Milestone checklist

### M0 — Inspection and architecture (2026-11-10) ✅

- [x] Repository and environment inspected (Node 24, npm 11; no Docker, Postgres or gh CLI)
- [x] All 25 logo files inspected and rendered; usage documented in `docs/BRANDING.md`
- [x] Architecture, database and decisions documented
- [ ] UI mockup: none supplied (the PNG in `icon design/` is the logo sheet). The UI follows the written spec.

### M1 — Foundation (2026-11-10 → 11-15)

- [x] Next.js 16 App Router, TypeScript strict, Tailwind 4, ESLint, Prettier
- [x] Design tokens (brand palette, light and dark), fonts (Nunito + Noto Sans SC), UI primitives
- [x] Official logo integrated: welcome, auth, learner nav, admin, favicon, PWA icons, manifest
- [x] PostgreSQL + Prisma schema for every domain (auth, curriculum, learning, gamification, offline, admin, monetization) and the initial migration
- [x] Seed: roles, achievements, HSK 1 starter curriculum, optional first Super Admin
- [x] Reusable content validator and idempotent importer (`npm run content:validate|import`)
- [x] Auth.js credentials auth: register, login, logout, rate limiting, audit
- [x] Role-based permissions enforced on the server
- [x] Admin: overview counts, lessons (publish/unpublish with revision and audit), characters list, users list/search/detail, role assignment, audit log
- [x] Learner shell: home, learning path (real data), profile
- [x] Tests: unit, integration (real Postgres) and Playwright e2e
- [x] GitHub Actions CI workflow (not yet run on GitHub; see Issues)
- [ ] Onboarding flow (moved to early M2)
- [ ] Admin editing of curriculum records and the import UI (M4)

### M2 — Learning and handwriting (11-16 → 11-22)

- [ ] Onboarding + placement assessment
- [ ] Lesson screen, vocabulary screen, stroke-order player (Hanzi Writer)
- [ ] Handwriting canvas (Pointer Events, normalised strokes)
- [ ] Evaluation engine and feedback; validated test dataset
- [ ] Exercise runner; attempt persistence (`/api/attempts`)

### M3 — Progress and offline (11-23 → 11-29)

- [ ] Mastery, spaced repetition, XP ledger, streaks, daily goals, achievements
- [ ] Review and Progress screens
- [ ] Service worker, IndexedDB (Dexie), lesson downloads, idempotent sync

### M4 — Stabilisation (11-30 → 12-06) and release (12-07 → 12-08)

- [ ] Admin editing, import UI, analytics, moderation
- [ ] Shared rate-limit store, nonce CSP, Sentry
- [ ] Deployment, backups, smoke tests, release notes

## Session log

### 2026-11-10 — Session 1 (M0 + M1)

**Completed:** everything checked under M0 and M1 above.

**Tests run (all passing):**

- `npm run lint`: clean
- `npm run typecheck`: clean
- `npm test`: 50 unit tests passed
- `npm run test:integration`: 14 tests passed against PostgreSQL 18 (run twice to confirm re-runs work)
- `npm run build`: production build succeeded
- `npx playwright test`: 6 passed (register → learn → admin denied (404) → logout → bad password → login → reload, on desktop and Pixel 7; security headers; manifest)
- Manual browser check: welcome (dark), register validation, home, learn (mobile, light), admin lessons publish/unpublish, audit log

**GitHub:** branch `feature/m1-foundation`, pushed. The CI workflow has not run on GitHub yet.

**Issues / blockers:**

- The content's pinyin and glosses need review by a Chinese teacher before they can be labelled VERIFIED.
- No email provider, so no email verification or password reset yet.
- The rate limiter is per instance (see `docs/SECURITY.md`).
- `gh` CLI not installed, so no pull request could be opened from this machine.

**Next actions:** onboarding, lesson and vocabulary screens, Hanzi Writer stroke player, handwriting canvas and evaluation engine (M2).
