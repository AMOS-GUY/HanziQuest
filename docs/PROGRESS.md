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
- [x] Clear offline data on sign-out; offline-data controls in Profile (done in M4)

### M4 — Stabilisation (11-30 → 12-06) and release (12-07 → 12-08)

- [x] Admin curriculum management: curricula, levels, units, lessons, characters, words, exercises; import UI with validation; learner preview; publish/unpublish; revisions and audit
- [x] Admin overview with 7-day aggregate analytics; moderation (suspend/reactivate)
- [x] Handwriting validation tooling: lab, consent, metrics (FAR/FRR by category, device, size), export, report script, synthetic baseline, procedure
- [ ] **Real handwriting samples collected and analysed** (needs testers; thresholds unchanged until then)
- [x] Offline account isolation, sign-out clearing, owner-bound queue, interrupted-sync resume (tested in a real browser)
- [x] Security audit and fixes (see SECURITY.md); shared PostgreSQL rate limiter; error reporting (Sentry-compatible, optional DSN)
- [ ] Nonce-based CSP (deferred: would make the cached offline pages dynamic; see SECURITY.md)
- [x] Profile settings, password change with session revocation, account deletion
- [x] UI review of every learner and admin screen, light and dark, mobile; error boundaries and loading states
- [x] Deployment preparation: env check, health endpoint, smoke test, Dockerfile, CI (format, smoke, docker), deployment/backup/rollback docs, release notes, PR package
- [ ] **Deployed to production** (owner: choose host and database, set secrets; see DEPLOYMENT.md)
- [ ] Recovery drill against a real provider backup (needs the production database)
- [ ] Branches merged to `main` in order (owner: open PRs; see RELEASE.md)

### M5 — Release integration and beta launch preparation

- [x] M1–M4 integrated into `main` in order, with merge commits and full history (PRs #1–#4, merged by the owner)
- [x] M5 merged into `main` by the owner (PR #5)
- [ ] **CI confirmed green on GitHub** (private repo; no CLI or token available to this session, so the owner must check)
- [x] Recall vs technique mastery policy implemented, tested and documented (D-033)
- [x] Handwriting pilot kit: five-tester plan, spoken instructions, consent script, anonymous IDs, device facts, test-sample exclusion
- [ ] **Human pilot run and analysed** (needs five real testers; no samples collected)
- [x] Hosting and database options researched with sources (HOSTING.md); recommendation documented
- [ ] **Production deployment** (owner accounts and secrets)
- [x] Portable backup/restore/verify tools; local recovery drill passed; drill added to CI
- [ ] **Production recovery drill** (needs the production database)
- [x] Landing page beta section, terms acceptance at sign-up and for existing users, draft privacy notice, draft terms, beta guide, in-app feedback with triage, bug-reporting process, GitHub issue templates, release notes
- [ ] **Legal review of the drafts** (owner; see LEGAL_REVIEW.md)
- [x] QA: Chromium desktop and Android emulation, WebKit desktop and iPhone emulation (all e2e flows)
- [ ] Firefox (Playwright's Firefox can't start on this machine: `spawn UNKNOWN`) and **real physical devices** (owner/testers)
- [ ] **Verification of the deployed production app** (after deployment: smoke test plus a manual pass)

### M6 — Quality and reliability (2026-11-11, `feature/m6-quality`)

- [x] Server-boundary audit of every route handler, server action and admin page (`docs/M6_QUALITY_AUDIT.md`)
- [x] Defects fixed:
  - M6-01: draft or archived curricula were reachable
  - M6-02: concurrent sync uploads returned a 500
  - M6-03: unthrottled learner actions
  - M6-04: missing index
  - M6-05: no way to publish a curriculum
- [x] Regression tests: 11 integration, 12 unit, 3 e2e (session revocation, suspension, API refusals)
- [x] Prioritised defect register and accepted risks

### M7 — Curriculum and learning intelligence (2026-11-11, `feature/m7-curriculum`)

- [x] Reviewed shared content protected from less verified imports; import changes revisioned (D-038)
- [x] Import audit written inside the import transaction
- [x] Read-only import preview (CLI and admin Validate)
- [x] Validator: per-syllable reading and tone checks, licence and verification consistency, duplicate glosses, lesson size, traditional forms
- [x] Word-list coverage tool for owner-supplied lists (HSK 2/3 pathway documented)
- [x] Content quality report (`content:report`, `/admin/content-quality`, `docs/CURRICULUM_QUALITY_REPORT.md`)
- [x] Levels unlock in order (D-039); placement: 3 questions per unit and a 24 h retake cooldown (D-040)
- [x] Recall, technique and guided measures per character and in total (`skillTotals`)
- [ ] **HSK 1 remaining 70 words, HSK 2 and 3 content, examples, audio, teacher review** (needs licensed sources and a reviewer)

### M8 — Learner experience and accessibility (2026-11-11, `feature/m8-experience`)

- [x] Automated accessibility audit (axe-core, WCAG A/AA) of 20 pages in light and dark, desktop and mobile; 4 violations found and fixed; now 0
- [x] Handwriting: palm rejection, cancelled gestures discarded, canvas fits landscape phones, stroke counter, hint notice before use
- [x] Keyboard and screen-reader focus management in the practice flow; honest semantics for the character switcher
- [x] Progress: "How you write" (recall, technique and guided practice measured separately)
- [x] Practice loading state; Learn heading structure
- [x] Screenshots from the production build (`docs/screenshots/`)
- [ ] **Physical devices and styluses, Firefox, manual screen-reader pass** (owner/testers)

### M9 — Production and beta readiness (2026-11-11, `feature/m9-production`)

- [x] Invite-only registration (production default), admin invites, atomic redemption (D-041)
- [x] Migration safety check in CI (expand, then contract), dependency audit in CI, Dependabot (D-042)
- [x] Health reports migration state; structured, redacted request logs (D-043); Admin → Operations
- [x] Retention tool (`ops:prune`, dry run by default); COOP and CORP headers; public-route rate limit
- [x] Local recovery drill repeated after the new migrations; an FK cycle caught and removed
- [x] `docs/M9_PRODUCTION_READINESS.md`: checklist and the owner's external actions
- [ ] **Deployment, production drill, production verification** (owner accounts and secrets)

### Integration audit (2026-11-11, `feature/integration-audit`)

- [x] Git history verified: linear stack on `main` `01d128e`; no PRs or merges for M6–M9 yet
- [x] Each milestone re-verified on its own commit and a fresh database (types, lint, unit, integration, schema drift, content)
- [x] Secrets and personal-data scan of every line added in M6–M9: test values only
- [x] Tested-out characters reach Review as one-time writing checks (D-044); Home's count respects curriculum visibility
- [x] Admin accessibility: 23 admin pages audited; table regions keyboard-reachable on phones
- [x] Password recovery without email: staff-issued single-use reset links (D-045)
- [x] CSP mitigation enforced by lint (D-046); advisory Firefox e2e in CI
- [x] `docs/INTEGRATION_AUDIT.md`: verification, merge plan, rollback, owner actions
- [x] Merged into `main` by the owner through PR #6 (`925969a`); this brought in M6–M9 too
- [ ] **Owner:** approve the reset procedure; GitHub CI results; Firefox; devices

### Reset security review and GitHub integration (2026-11-11, `feature/reset-security-review`)

- [x] Verified on GitHub: PR #6 merged all of M6–M9 and the audit into `main`; per-milestone PRs would duplicate it, so they weren't opened
- [x] Password reset review: policy re-checked at use, links discarded on promotion and suspension, token removed from the address bar (D-047)
- [x] `PASSWORD_RESET_LINKS` off by default in production until the owner approves
- [x] Migrations apply in sequence on an empty database; local `verify` equivalent passes
- [ ] **Not observed:** GitHub Actions results (private repo, no CLI or sign-in here), Docker build, Firefox
- [x] Merged by the owner as PR #14 (`main` = `7e1f43b`)
- [x] Second review of the merged code: RS-07 (parallel link creation) fixed on the same branch; procedure in SECURITY.md made explicit (still a draft)
- [ ] **Owner:** open a follow-up PR for the RS-07 commit, check CI, merge; review Dependabot PRs #7–#13; approve or change the reset procedure

### M10 — Production infrastructure (2026-11-11, `feature/m10-production-infrastructure`)

- [x] Infrastructure audit before implementation (`docs/M10_INFRASTRUCTURE_AUDIT.md`)
- [x] Hosting comparison with official prices; recommendation Render + Neon Launch, about $14–28/month (`docs/DEPLOYMENT_ARCHITECTURE.md`, D-051)
- [x] Liveness and readiness split; readiness detects unapplied migrations (D-048)
- [x] Fatal configuration now exits the server (M10-12, D-049); stricter production env checks; pool settings
- [x] Manual, owner-approved `deploy.yml`; `render.yaml` with auto-deploy off (D-050)
- [x] Off-site `backup.yml` with restore verification and `age` encryption; `db:verify --backup` (D-052)
- [x] CI docker job start-up test (written; not yet run on GitHub)
- [x] Runbooks: DEPLOYMENT, ROLLBACK, DATABASE_BACKUP, PRODUCTION_OPERATIONS
- [x] Invite-only and `PASSWORD_RESET_LINKS` off preserved; the reset procedure still a draft
- [ ] **Not observed:** GitHub Actions (including the new docker start-up test), Docker locally, Firefox
- [ ] **Owner:** review and merge the M10 PR; accounts, environment, secrets and first deployment (DEPLOYMENT.md)

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

### 2026-11-10 — Session 4 (M4: beta readiness)

**Branch:** `feature/m4-beta`, created from `feature/m3-progress-offline` (not from `main`,
which only has the initial commit). Two migrations: `beta_quality` (`HandwritingSample`,
`RateLimitBucket`) and `credentials_changed_at`. Both are additive.

**Completed:**

- **Curriculum management:** create and edit curricula, levels, units, lessons, characters,
  words and exercises. Lesson word lists regenerate characters and exercises through the
  importer's shared builder (`buildLessonContent`); hand-written exercises are kept. Import UI
  (validate, import as drafts). Learner preview (nothing saved). Revision history on every
  editor page. Every operation is checked on the server (`curriculum:write`,
  `content:import`, `handwriting:validate`) and audited in the same transaction.
- **Handwriting validation:** Admin → Handwriting lab collects consented, pseudonymous,
  labelled samples. Metrics are false rejection, structural false acceptance, technique
  errors accepted and error named, with breakdowns by device, size and participant. Exports,
  `npm run handwriting:report`, `docs/HANDWRITING_VALIDATION.md`, and a synthetic baseline:
  0 % false rejection (306), 0 % structural false acceptance (305), and 85 % of technique
  errors graded Good by design (flagged as a policy question). **No thresholds changed; no
  real samples collected yet.**
- **Offline security:** downloads are bound to an account and deleted at sign-out or account
  switch. Queued results stay with their owner and are never uploaded by another account.
  Keep or delete when offline at sign-out. Adaptive batches on 413. Resume after interruption.
- **Security** (details in SECURITY.md): trusted-proxy client IP (spoofing fix), per-email
  login limit, shared PostgreSQL rate limiter, session revocation on password change, admin
  gate in `proxy.ts` (no title leak), body size limits, cross-site origin check, start-up
  configuration check, structured error reporting with redaction, moderation, password change,
  account deletion.
- **UI:** profile settings, offline-data card, admin overview analytics, error and loading
  states, welcome and login notices, shorter goal labels; light and dark, desktop and mobile
  reviewed in the browser.
- **Deployment preparation:** `/api/health`, `npm run smoke`, `Dockerfile` and
  `.dockerignore`, CI (format check, smoke test, Docker build), `DEPLOYMENT.md` (hosting
  options, env, first deploy, release, rollback, backups, recovery drill, monitoring, PWA
  checklist), `OFFLINE.md`, `RELEASE.md` (merge order, PR texts, release notes).

**Bugs found and fixed during testing:**

- Learners were given Draft or Archived exercises the server refused, so such lessons could
  never be completed.
- Stroke data failed to load inside the production server bundle (`require.resolve` returns a
  module id there). This broke admin imports and character creation in production builds.
- React 19 reset admin and profile forms after every submission, wiping input after
  validation errors (and emptying the import box before "Import" could use it).
- The shared rate limiter compared a UTC timestamp with the database session's `now()`, so on
  a non-UTC server it never limited anything.
- Error reports could include secrets from the stack trace (the message is repeated there).

**Tests run (all passing):**

- `npm run lint`, `npm run typecheck`, `npm run format:check`: clean
- `npm test`: **106** unit tests (13 new: validation metrics, env check, Sentry DSN and
  envelope redaction, proxy-aware IP, body limit)
- `npm run test:integration`: **51** tests against PostgreSQL (12 new: curriculum editing
  incl. revisions, audit, regeneration, custom exercises, prompt propagation, published-only
  completion; account: profile, password change, deletion, last Super Admin, moderation
  guards; shared rate limiter across instances; interrupted sync without duplicate XP)
- `npm run content:validate`: passed
- `npm run build`: succeeded
- `npx playwright test`: **15 passed**, 5 skipped (desktop-only flows not repeated on mobile).
  New: editor builds, previews and publishes a lesson, imports content and records a
  handwriting sample; learners get a bare 404 on admin URLs and 403 on the admin API; offline
  account isolation across sign-out, account switching and a blocked sync endpoint, with XP
  counted once after the owner returns.
- `npm run smoke -- http://localhost:3200` against a local production server: 8/8 checks.
- `npm run handwriting:report -- --synthetic`: baseline regenerated (908 samples).

**Not done / needs the owner:**

- No real handwriting samples yet. Accuracy with real learners is **unknown**.
- Not deployed: host, database, domain and secrets are owner decisions.
- The recovery drill needs a real backup; `pg_dump` isn't available on this machine.
- The Docker image hasn't been built locally (no Docker); the CI job builds it.
- CI has never run on GitHub; the branches aren't merged and no PRs are open (no `gh` CLI).
- Nonce-based CSP, email (verification, reset, reminders) and 2FA are post-beta.
- The SRS and XP numbers are initial values, to be tuned with usage data.

### 2026-11-10 — Session 5 (M5: release integration and launch preparation)

**Git:** you merged M1–M4 into `main` as PRs #1–#4 (merge commits, history preserved) while
this session was preparing the same merge. My local duplicate merge was discarded unpushed,
and nothing was force-pushed. Before that, a Docker build fix (placeholder `DATABASE_URL` for
`prisma generate` during `npm ci`) went to `feature/m4-beta` and is included in PR #4. M5 work
is on `feature/m5-launch`, branched from the new `main`. Migrations: `technique_mastery`
(with backfill from stored evaluations) and `beta_launch` (feedback, terms acceptance, sample
device info). Both are additive.

**Completed:**

- **Mastery policy:** technique (stroke order and direction) is judged separately from recall
  on independent writing. Faulty technique: XP capped at 5, shorter next interval, no MASTERED
  until two clean recalls in a row; feedback note and "Check strokes" on Progress. A wrong
  character never advances anything; guided practice never counts. The engine is unchanged.
  `npm run progress:rebuild` applied it to existing data.
- **Pilot kit:** P01–P05 pilot plan (36 prompts each: 12 characters × 2 correct + 1 rotated
  deliberate error), spoken instructions in the recorder, coarse device facts recorded
  automatically, consent script and session procedure (HANDWRITING_PILOT.md). Automated-test
  samples use `TEST-` codes and are excluded. The two synthetic samples earlier e2e runs had
  recorded as "P99" in the dev database were relabelled as test samples.
- **Launch content:** landing page beta section and footer; terms acceptance at sign-up
  (enforced in the server action) and an in-app prompt for existing accounts; draft privacy
  notice, terms and beta guide; feedback page, "Grading looks wrong? Tell us", admin triage
  inbox (`feedback:manage`); BUG_REPORTING.md and GitHub issue templates; LEGAL_REVIEW.md.
- **Recovery:** `db:backup`, `db:restore` and `db:verify`. The local drill passed (details in
  DEPLOYMENT.md) and is now in CI. The drill found and fixed a hang in the restore tool
  (readline created before an awaited connect lost the input).
- **Hosting:** HOSTING.md compares Render, Railway, Fly.io and Vercel with Neon, Render
  Postgres, Supabase and Fly MPG. Prices are marked official or third-party, with sources.
  Recommended: Render Starter + Neon Launch, roughly $10–30/month (verify).

**Tests (all passing):**

- lint, typecheck, format check: clean
- unit **114** (8 new: technique policy and verdicts)
- integration **55** (6 new: technique fault recorded with capped XP; wrong character never
  advances; guided excluded; terms acceptance; feedback storage and triage audit)
- content validation, production build
- Playwright Chromium: **18 passed**, 6 skipped (mobile copies of desktop-only flows). New:
  public pages and draft notices; learner feedback → staff triage, with contact hidden; terms
  required at sign-up.
- Playwright WebKit (desktop Safari and iPhone 14 emulation): **18 passed**, 6 skipped, including
  the full lesson, offline practice with the service worker and sync, and admin. The
  account-isolation test is Chromium-only: it needs request routing for service-worker pages.
  In WebKit the block didn't apply and the result synced to its owner (checked in the
  database; nothing lost).
- Firefox: **not run**. The downloaded browser can't start on this machine.
- Smoke test 8/8 against the production build running on the restored database.

**Not done (needs people, accounts or authorisation):**

- No real handwriting samples. **No accuracy claim can be made for real learners.**
- Not deployed; the production recovery drill and production verification are pending.
- GitHub CI results not visible to this session.
- Legal drafts not reviewed; placeholders unfilled. Keep the beta invite-only until done.
- No testing on real phones or tablets yet (emulation only).

### 2026-11-11 — Session 6 (M6–M9, overnight)

**Starting point:** you merged M5 into `main` (PR #5, `01d128e`). M6 branches from there.

**M6 (quality):** five defects found and fixed, each with a regression test that fails
without the fix (checked by reverting the fix for M6-01 and M6-02). See
`docs/M6_QUALITY_AUDIT.md`.

- One migration: `attempt_session_index` (additive).
- Checks: format, lint, typecheck clean; unit **126**; integration **66**; content validation;
  production build.
- Playwright Chromium (desktop and Pixel 7 emulation): **22 passed, 8 skipped**. The skipped
  ones are mobile copies of desktop-only flows.
- WebKit and Firefox were not run for M6.

**M7 (curriculum):** see `docs/M7_CURRICULUM_AND_LEARNING.md`. No content was invented.

- Defects found and fixed: M7-01 (a provisional import could overwrite verified glosses),
  M7-02 (import audit outside the transaction), M7-03 (levels unlocked independently) and
  M7-04 (placement guessable and retakeable).
- The e2e import fixture was overwriting the starter's 人 gloss and part of speech in the dev
  database on every run. It now matches the starter, and the dev data was restored with
  `content:import`.
- No migrations.
- Checks: format, lint, typecheck clean; unit **144**; integration **72**; content
  validation; production build.
- Playwright Chromium: **22 passed, 8 skipped**.

**M8 (experience):** see `docs/M8_UX_AND_ACCESSIBILITY.md`.

- New dev dependency: `@axe-core/playwright` 4.14.0.
- No migrations.
- Checks: format, lint, typecheck clean; unit **144**; production build.
- Playwright Chromium: **30 passed, 16 skipped**. The skips are mobile copies of desktop-only
  flows, plus the 4 opt-in screenshot runs. New: 4 accessibility runs and 4 writing-experience
  tests.
- Playwright WebKit (desktop Safari and iPhone 14 emulation, `E2E_ALL_BROWSERS=1`): **32
  passed, 14 skipped, 0 failed**.
- Firefox: not run (it can't start on this machine).

**M9 (production readiness):** see `docs/M9_PRODUCTION_READINESS.md`.

- Migrations: `beta_invites` and `beta_invites_acyclic`. The second drops the creator foreign
  key that would have created an FK cycle and broken restores. Both are additive in effect;
  the first was already applied locally, so it was not edited.
- Checks: format, lint, typecheck clean; unit **150**; integration **79**; migration check
  (against `origin/main`); content validation; production build.
- Playwright Chromium: **31 passed, 17 skipped**, with two servers (open, and invite-only).
- Playwright WebKit (desktop Safari and iPhone 14 emulation): **34 passed, 14 skipped, 0
  failed**. Firefox not run.
- Smoke test **8/8** against a local production server. A production start without
  `REGISTRATION_MODE` was confirmed to be invite-only.
- Local backup, restore and verify drill: every table matched; 69 FKs checked, 0 orphans.

**Session 6 summary:**

- Four stacked branches, each pushed: `feature/m6-quality` → `feature/m7-curriculum` →
  `feature/m8-experience` → `feature/m9-production`.
- Nothing was deployed, purchased or published. No real users or samples are involved.

### 2026-11-11 — Session 7 (M6–M9 integration audit)

See `docs/INTEGRATION_AUDIT.md`.

- Verified: linear history on `main` `01d128e` (PRs #1–#5 merged; **no PR exists for M6–M9**).
  Each milestone re-checked at its own commit on a fresh database: M6 126/66, M7 144/72,
  M8 144/72, M9 150/79 (unit/integration), no schema drift, content valid. No secrets or
  personal data in the M6–M9 diffs.
- Fixed on `feature/integration-audit` (built on M9):
  - placement checks in Review (D-044);
  - due counts respect curriculum visibility;
  - admin accessibility (23 pages; phone table regions);
  - staff-issued password reset links (D-045, migration `password_reset_tokens`);
  - lint-enforced CSP mitigation (D-046);
  - advisory Firefox e2e in CI;
  - reset links pruned by `ops:prune`.
- Checks: format, lint, typecheck clean; unit **150**; integration **85**; migration check;
  production build; smoke **8/8**; drill: 70 FKs, 0 orphans.
- Playwright Chromium: **36 passed, 18 skipped**. WebKit: **40 passed, 14 skipped, 0 failed**.
- Not done: GitHub CI, Firefox (fails to start locally with a Windows side-by-side error),
  physical devices, screen readers. Nothing merged or deployed.

### 2026-11-11 — Session 8 (GitHub integration and reset security review)

See `docs/INTEGRATION_AUDIT.md` section 7 and SECURITY.md.

- GitHub: `feature/integration-audit` was already pushed at `39188bf`. The owner merged it as
  PR #6 (`main` = `925969a`), which brought M6–M9 into `main`. No per-milestone PRs were
  opened, because they would duplicate it. Dependabot opened PR #7 (`actions/checkout` 4 → 7).
  It is not merged.
- Reset review fixes on `feature/reset-security-review` (built on `main`):
  - RS-01: policy re-checked at use
  - RS-02: a suspended or demoted issuer's links die
  - RS-03: suspension discards links
  - RS-04: the token is removed from the address bar
  - RS-05: `PASSWORD_RESET_LINKS` off in production

  There are 6 new integration tests and 1 unit test. The 5 policy tests were confirmed to fail
  without the fix.

- Checks: format, lint, typecheck; unit **151**; integration **91**. Migrations applied in
  order to an empty database with no drift. Migration check and build pass. Chromium e2e
  **36 passed, 18 skipped, 0 failed**. WebKit reset flow 2/2, WebKit accessibility pass.
- Not done: GitHub Actions results (not visible from here), Docker build, Firefox, devices.
  Nothing deployed.

### 2026-11-11 — Session 9 (security PR follow-up)

- Found on GitHub: PR #14 (`feature/reset-security-review` at `2b61811`) is already merged, so
  `main` = `7e1f43b`. Dependabot PRs #7–#13 are open. No duplicate PR was created.
- Reviewed the merged reset code again:
  - session revocation is sound (`issuedAt` is fixed at sign-in; roles are read from the
    database)
  - **RS-07:** six parallel link creations left six live links. Fixed by locking the account
    row during creation. A new integration test fails without the fix.
- SECURITY.md procedure rewritten with explicit sections:
  - who may create links
  - verifying the recipient
  - delivery
  - expiry
  - after the change
  - without email

  It is still marked not approved.

- `PASSWORD_RESET_LINKS` is unchanged: off by default in production.
- GitHub Actions results are still not observed (no CLI or sign-in). Not merged, not deployed;
  M10 not started.

### 2026-11-11 — Session 10 (M10 production infrastructure)

See `docs/M10_INFRASTRUCTURE_AUDIT.md`.

- Started from `main` `9b83917` (all milestones and PRs #14 and #15 present). Baseline: unit
  151, integration 92, Chromium e2e 36/18/0.
- The audit was written first. Then:
  - liveness and readiness probes
  - pending-migration readiness
  - Node as PID 1
  - pool settings and a stricter env check
  - **M10-12: the start-up check didn't stop the server; it now exits**
  - release id
  - `MIGRATE_DATABASE_URL`
  - backup checksums and `db:verify --backup`
  - `deploy.yml`, `backup.yml`, `render.yaml`
  - the CI start-up test
  - architecture and runbook docs
- Checks:
  - format, lint, typecheck pass
  - unit **158**, integration **93**
  - migration check and build pass (no warnings)
  - Chromium e2e **36 passed, 18 skipped, 0 failed**; WebKit subset 8/1/0
  - smoke **9/9**; placeholder-secret refusal exits 1
  - backup drill: 70 FKs, 0 orphans; tamper detected
- Not done: GitHub Actions, Docker, Firefox, any real host. Nothing purchased, connected or
  deployed. Invite-only and reset links off are unchanged.
