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
- [x] Onboarding flow (done in M2)
- [ ] Admin editing of curriculum records and the import UI (M4)

### M2 — Learning and handwriting (11-16 → 11-22)

- [x] Onboarding (experience, declared HSK level, lesson note, goals, daily target, time zone)
- [x] Placement assessment: recognition check, server-graded, tests out consecutive units
- [x] Lesson progression: locked / available / in progress / completed / tested out, enforced on the server
- [x] Lesson overview, vocabulary and stroke-order screens (play, pause, previous, next, replay)
- [x] Handwriting canvas (Pointer Events, high-DPI, undo, clear, hints, grid, no scroll)
- [x] Guided stroke practice (Hanzi Writer quiz)
- [x] Evaluation engine and feedback: identity gate, stroke count, order, direction, shape (`docs/HANDWRITING.md`)
- [x] Synthetic validation dataset over all 102 characters
- [x] Practice runner for all four exercise types, with retry, skip and a summary
- [x] `/api/attempts` (server re-evaluation, idempotent) and `/api/sessions` (start/complete)
- [ ] **Validation on real learner handwriting** (needs testers, before beta)
- [ ] Listening-to-writing and character-reconstruction exercises (need verified audio / content)

### M3 — Progress and offline (11-23 → 11-29)

- [x] Mastery (guided vs independent), spaced repetition, XP ledger with anti-farming rules, streaks, daily goals, achievements
- [x] Review and Progress screens, Home cards, review rounds
- [x] Service worker, IndexedDB (Dexie), lesson downloads, offline practice, idempotent `/api/sync`
- [ ] Tune SRS/XP numbers with real usage data (after beta testers)
- [ ] Clear offline data on sign-out; offline-data controls in Profile

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

**Next actions:** done in session 2 (below).

### 2026-11-10 — Session 2 (M2)

**Completed:** everything checked under M2 above. Branch `feature/m2-learning`, which builds on
`feature/m1-foundation`.

**Tests run (all passing):**

- `npm run lint`, `npm run typecheck`: clean
- `npm test`: 76 unit tests, including an 18-test handwriting sweep over the 102 starter
  characters (correct, wrong character, similar pairs, missing/extra strokes, reversed
  direction, wrong order, distortion, size, speed, wobble)
- `npm run test:integration`: 29 tests against PostgreSQL (attempts incl. idempotency and
  ignored client scores, sessions incl. skip rules, placement, lesson states)
- `npm run build`: succeeded
- `npx playwright test`: 11 passed, 1 intentionally skipped (the full lesson runs once, on
  desktop). It covers onboarding, a full lesson written stroke by stroke (18 exercises, all
  Excellent/Good, saved by the server), next lesson unlocked, persistence after reload, a
  locked lesson refused, and the stroke-order controls.
- Manual browser checks (mobile, light): onboarding, placement (unit 1 tested out), learning
  path states, stroke animation, guided quiz, freehand Excellent, and a wrong character (他 vs
  她) correctly rejected with "looks more like 她".

**Fixed during testing:**

- Choice cards had no accessible names. Added labels.
- Auth.js redirected e2e runs to the dev server (`AUTH_URL`). The e2e server now sets its own.
- Registration rate limit blocked e2e. It is now configurable; the default stays at 5 per hour.
- A lesson could be completed by skipping everything. It now needs at least 50 % real
  attempts.

**Issues / risks:**

- Handwriting thresholds are calibrated on **synthetic** ink only. Real-tester validation is
  required before calling feedback reliable.
- Attempts made while offline are not queued yet. A failed save shows "Not saved yet" with
  Retry; the M3 offline queue fixes this properly.
- XP, mastery and review scheduling aren't computed yet. Attempts are stored, so M3 can derive
  them from history.

**Next actions (M3):** mastery from attempt history, spaced-repetition scheduler, XP ledger
with anti-farming rules, streaks and daily goals, Review and Progress screens, then the
service worker, Dexie storage, lesson downloads and idempotent `/api/sync`.

### 2026-11-10 — Session 3 (M3)

**Completed:** everything checked under M3 above. Branch `feature/m3-progress-offline`, which
builds on `feature/m2-learning`. One migration (`progress_offline`): `AttemptCharacterResult`
and `ExerciseAttempt.localDate`, with a backfill for earlier single-character attempts.

**Tests run (all passing):**

- `npm run lint`, `npm run typecheck`, `npm run format:check`: clean
- `npm test`: 93 unit tests (17 new: calendar and streaks, SRS intervals, anti-cramming, guided
  never masters, lapses, order independence, ease bounds, XP rules)
- `npm run test:integration`: 39 tests (10 new: server-only XP, per-exercise daily limit, skip
  and wrong-character XP, daily goal once, lesson XP once, per-character mastery for words,
  review due → review session → rescheduled, streak across 3 days in Asia/Shanghai with
  achievements, concurrent submissions, offline batch incl. `lesson.complete`, idempotent
  re-upload, rejections and another user's ids)
- `npm run build`: succeeded; `/offline` and `/offline/practice` are static
- `npx playwright test`: 12 passed, 2 intentionally skipped (desktop-only flows). New: download
  a lesson → go offline → the service worker serves the offline page → practise → "Saved on this
  device" → back online → outbox syncs → XP and 你 appear on Progress.
- Manual browser check: a review round for 他 graded Good, "+8 XP" from the server, the "First
  stroke" achievement, and Progress/Home updated (18 XP, 1-day streak); the 5-item mobile nav fits
  at 375 px.

**Fixed during testing:**

- Hanzi Writer was loaded with a dynamic `import()`, a chunk the offline page never referenced,
  so guided practice failed offline. It is now a static import.
- The e2e writing helper fetched stroke data from the API, which can't work offline. It now
  reads `hanzi-writer-data` in the test process.
- The sign-up wait in e2e was too short under parallel load (bcrypt cost 12). It is now 20 s.

**Issues / risks:**

- SRS and XP numbers (D-020, D-021) are initial choices. Tune them once there is real usage.
- Word attempts made before this migration have no per-character rows, so they don't count
  towards mastery. This is development data only.
- Offline data isn't cleared on sign-out (SECURITY.md limitation 7).
- Offline practice covers downloaded lessons only. Review rounds need a connection.
- Handwriting thresholds are still validated on synthetic ink only (carried over from M2).

**Next actions (M4):** admin curriculum editing and import UI, analytics, moderation, a shared
rate-limit store, nonce CSP, Sentry, clearing offline data on sign-out, then deployment, backups,
smoke tests and release notes.
