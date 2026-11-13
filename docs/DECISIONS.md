# Engineering decisions

Newest first. Each entry: decision, why, consequences.

## 2026-11-13 — M14-b review workflow

**D-070 · Learners see the edition and an honest status.** The Learn page, the lesson page and
the admin preview name the edition ("HSK 2.0 edition", "HSK 3.0 (2021) edition", "HanziQuest
course") and always say "not official HSK material". The status comes from `verificationLabel`:
REVIEWED shows as "Reviewed (not yet verified)", distinct from VERIFIED. Before this, anything
not VERIFIED showed "Provisional content", so reviewed content would have been mislabelled.

**D-071 · Verification is changed only by reviewers, through the review queue.**

- **Role:** a new least-privilege role, `CONTENT_REVIEWER`, holds `admin:access`,
  `curriculum:read` and the new `curriculum:review`. It can't edit, publish or import.
- **Permission:** `curriculum:review` belongs to Super Admins and Content reviewers only;
  curriculum editors don't get it.
- **Edits:** verification isn't a form field. Server-side, new content starts PROVISIONAL and
  edits can't change verification, whoever the actor is.
- **Migrations:** the role row is inserted by a migration, because existing databases aren't
  re-seeded.

**D-072 · An approval covers one exact version.**

- **History:** `ContentReview` keeps every decision with a fingerprint of the reviewed version:
  canonical JSON of the content and provenance, SHA-256. Character fingerprints include stroke
  data; word fingerprints include their composition and example; curriculum fingerprints include
  the structure and every item's fingerprint.
- **Submitting:** the reviewer submits the fingerprint they saw. A different current version is
  refused.
- **Self-review:** refused. That means any audited change, structure change or import of the
  version by the reviewer since the last approval.
- **Sources:** approval follows the import source rules (registered, owner-approved sources that
  may supply readings or glosses; VERIFIED needs known licences).
- **Curricula:** a curriculum needs every item approved at its level.
- **Invalidation:** every edit path and the importer call `reconcileReviews`, which returns
  approved items whose version changed to PROVISIONAL, with an audit entry.
- **No deletion:** review rows are never updated or deleted. They have no foreign key to the
  item, so the history outlives edits.
- **Lock order:** approvals and edits take a shared global review lock, then per-item locks
  (items before curricula, sorted), _before_ writing rows. Imports take the global lock
  exclusively. Without this, an approval racing an edit could deadlock, or leave an approval on
  changed content. A test races them five times.

**Open (owner):**

- **Imports declaring a status:** content files may still declare REVIEWED or VERIFIED. They're
  gated by the same source rules (no source is approved today, so it can't happen yet), but they
  bypass the version-bound review. The recommendation is to allow only PROVISIONAL in files.

## 2026-11-13 — M13 handwriting diagnostics

**D-066 · Handwriting diagnostics are read-only and never change grading.** The confusable suite,
the import diagnostics and the replay harness use the unchanged engine. They don't touch
thresholds, identity rules, candidate sets, XP, mastery or SRS. Replay goes through a client
that refuses every write. Findings are recorded (F1–F8) for an owner decision rather than fixed,
because each remedy changes how learners are graded.

**D-067 · Confusable pairs carry their provenance; results carry `source: "synthetic"`.** There
is no universal look-alike list. Groups are tagged roadmap-m13, m12-pilot-lookalike or
engineering-screen (not teacher-reviewed). Every result records the engine version and a
configuration fingerprint, and is labelled synthetic, so it can't be mistaken for human
evidence.

**D-068 · Import diagnostics are advisory.** The confusable check is shown in the import preview
and the content CLI, and never blocks or alters an import. The candidate set is the file's
characters, matching what learners at that level are checked against.

**D-069 · Lab-sample held-out split is by participant.** `sha256(code)` decides it, so no writer
is in both sets. Reports carry counts, never participant codes. With fewer than the validation
minimums, the report says it isn't sufficient rather than producing an estimate.

## 2026-11-12 — Erasure ledger safeguards, feedback, public repository

**D-062 · Restored databases are gated until the signed erasure ledger is applied.**
`db:restore` commits a pending `ErasureLedgerGate` row before loading any data, so an
interrupted or failed restore stays blocked. Readiness returns 503 while any gate is pending,
and deploys and monitors already depend on readiness. The ledger is canonical, counted,
checksummed and HMAC-signed with an owner-held `ERASURE_LEDGER_KEY`. The key lives in the
owner's password manager, with a sealed paper copy stored apart from the ledger. It is never in
Git, the database, backups, the platform or logs. The ledger is verified before any write and
applied in one transaction that clears the gate. **There is no unsigned path:** a gate clears
only through a verified ledger. An earlier draft's audited "clear without a ledger" command was
removed before release; its unused columns await a contract migration. Exports merge, never
shrink or move dates later, and keep the previous file. A lost ledger is rebuilt, signed, from
the live database, later backups or the paper record. Re-applying is idempotent and keeps the
first erasure date.

**D-065 · Restore verification uses its own disposable database.** `backup.yml` restored into
the database it also used as `DATABASE_URL`, which `db:restore` refuses, so it would have failed
on its first run. It now restores into a separate `hq_restore_verify` database on the runner,
after `db:check-restore-target` has refused any target that could be the backup source, the
app database or a hosted database. Owner-authorised, narrowly scoped: triggers, environment
protection and secrets are unchanged.

**D-063 · Pilot feedback stays on paper.** Feedback isn't linked to participants, and pattern
matching can neither find every identifying entry nor safely delete matches. Erasure only
counts entries that contain the code, and that count isn't described as erasure. In-app pilot
feedback needs a participant-linked model first.

**D-064 · Commits use the GitHub noreply address.** The repository is public. Earlier commits
expose the owner's personal email in author metadata. History isn't rewritten without the
owner's approval (it changes every SHA and breaks PR links). This repository's git config now
uses the noreply address.

## 2026-11-12 — Public repository, CI restored, erasure review

**D-061 · Erasure is re-applied after restores from an erasure ledger.** Backups taken before an
erasure still hold the samples, and the drill proved a restore brings them back. Erased codes
(code, reason, date; no handwriting) are exported to a ledger kept outside the repository and
re-applied to any restored database before it serves traffic, through the same erasure code
path. The tool refuses to write the ledger inside the public repository except under ignored
folders. Feedback is never erased by pattern (it could match unrelated learner text); erasure
reports matching entries for review instead. Erasure isn't described as complete until the
checklist in M12_ERASURE_REVIEW.md is done.

## 2026-11-12 — M12 pilot privacy and M14 provenance infrastructure

**D-057 · Pilot consent is a versioned record, and the form's approval is a code gate.**
`PilotParticipant` (code and status only) and `PilotConsent` (form version, signing time,
recording staff account, revocation). Samples link to both and are recorded only under an
unrevoked acceptance of the current version, checked inside the recording transaction under a
row lock. While `ownerApproved` is false for the current form
(`features/handwriting/consent.ts`), only `TEST…` codes can be given consent, so real
handwriting can't be collected until the owner approves the form through a reviewed change.

**D-058 · Erasure deletes handwriting, redacts audit content and keeps a tombstone.** Erasing a
code (withdrawal or end of retention, `handwriting:erase`, Super Admin only) deletes all its
samples, including pre-M12 rows matched by code, replaces the content of their audit entries
with a redaction marker, revokes consent and blocks the code for good. The code, status and
consent rows stay as the record of consent and withdrawal; they hold no handwriting. Exports,
backups, feedback entries and the paper key are outside the app's reach and are handled by
procedure (M12_PILOT_PROTOCOL.md section 8).

**D-059 · Free text is removed from the lab.** Observations and styles are fixed lists, and the
recording schema is strict, so an unknown field (including `notes`) is rejected. The `notes`
column stays for pre-M12 rows (expand, then contract) and is erased with the participant.

**D-060 · Curriculum sources are registered; edition tags need an approved official list.**
`content/sources.json`, bundled at build time, records each source's licence, what it may
supply and the owner's approval. Content files cite ids; validation rejects unknown ids and
fields a source may not supply. PENDING sources may back PROVISIONAL content only. HSK level
tags are nullable (null means no claim) and need an approved `OFFICIAL_LIST` entry, so none
exist yet. Review metadata stores a role, never a name.

## 2026-11-11 — M11 staging preparation

**D-053 · Every deployment names itself (`APP_ENV`).** `staging` or `production`, fatal if
missing or invalid on Render (`RENDER=true`). Local production builds (e2e, smoke) may leave it
unset. It drives the health `environment`, `env` in every log line, a runtime "Staging"
banner (read from `/api/health/live`, because the image is built once) and the database check.
Staging with `REGISTRATION_MODE=open` is fatal. Values still holding `REPLACE_ME` are fatal.

**D-054 · The database carries its environment (`DeploymentMarker`).** A single row, written once
by `db:environment --mark` on a new, empty database during its first deploy. It is never
changed by tooling. Readiness returns 503 when the marker is missing or differs from
`APP_ENV`. The deploy and backup workflows check it before touching the database. This catches
a mis-pasted URL (staging ↔ production) and production data restored into staging, because
the backup carries the "production" marker. An additive migration with no FKs.

**D-055 · One reviewed deploy workflow for both environments; staging before production.**
`_deploy.yml` is called by `deploy-staging.yml` and `deploy.yml`. Each GitHub environment
holds its own secrets under the same names, so a job only ever sees its own. The preflight
checks:

- the commit is on `main`
- `verify` and `docker` are green for that SHA
- for production, a successful staging deployment of the same SHA

Migrations run from the workflow (direct URL) before the Render hook, which deploys the exact
SHA (`?ref=`). Render's pre-deploy step isn't used: it isn't available on free instances, and
one migration path is simpler. Readiness still blocks code on an old schema, as with a manual
Render deploy.

**D-056 · Staging is free and synthetic.** Render Free with Neon Free, $0
(M11_STAGING_ARCHITECTURE.md). The accepted limits are cold starts, 6-hour history and 100
CU-hours, which suspends compute rather than billing. Only synthetic accounts
(`@example.test`) and the seeded staging admin exist there. The acceptance suite is HTTP-only
and refuses a server reporting `production`. Restores now also compare per-table checksums
before committing, so a tampered backup is rejected, not restored.

## 2026-11-11 — M10 production infrastructure

**D-048 · Liveness and readiness are separate probes.** `/api/health/live` never touches the
database and is the container HEALTHCHECK, so a database outage doesn't get healthy instances
restarted. `/api/health` is readiness: it returns 503 while any migration shipped with the
build is unapplied, unfinished or failed. The platform's deploy check uses it, so new code
never serves on an old schema. A database ahead of the code, as after a rollback, stays ready
(migrations are additive).

**D-049 · A fatal configuration exits the process.** A throwing `register()` is only logged by
Next.js ("Failed to prepare server") and the process keeps running. The check now lives in
`instrumentation-node.ts` and calls `process.exit(1)`. New fatal checks in production:

- a placeholder `AUTH_SECRET`
- `AUTH_TRUST_HOST` not `true`
- a non-PostgreSQL `DATABASE_URL`
- an out-of-range `TRUSTED_PROXY_HOPS` or `DATABASE_POOL_MAX`

Security impact: stricter only; no authentication policy changed.

**D-050 · Deploys are manual and owner-approved; verification and deployment are separate.**
CI (`verify`, `docker`) never deploys. `deploy.yml` runs only on manual dispatch:

1. A preflight checks the confirmation phrase, that the SHA is `main`'s head, and that
   `verify` and `docker` are green for that SHA.
2. The owner approves the protected `production` environment.
3. An encrypted pre-migration backup is taken.
4. The Render deploy hook is called (auto-deploy is off in `render.yaml`).
5. The workflow waits for readiness on the new release, then runs the read-only smoke test.

Migrations run in Render's pre-deploy step with `MIGRATE_DATABASE_URL` (direct). Nothing is
connected until the owner creates the accounts, the environment and its secrets.

**D-051 · Hosting recommendation: Render web service with Neon Launch.** It is the only compared
option with 7-day PITR under $30/month, at an estimated $14–28/month
(DEPLOYMENT_ARCHITECTURE.md). Render Postgres on Hobby has a 3-day PITR window. Fly Managed
Postgres starts at $38/month. Not purchased.

**D-052 · Off-site backups are verified and encrypted before they're kept.** `backup.yml`
restores every backup into a disposable database, verifies it against the backup's own row
counts and per-table checksums (`db:verify --backup`), then encrypts it with the owner's `age`
public key and keeps it for 30 days. The private key never enters GitHub. Provider PITR stays
the primary recovery path.

## 2026-11-11 — Password reset security review

**D-047 · Reset links are re-checked when used, and off in production until approved.** The
review found that the D-045 policy was only checked when a link was created. A moderator's link
for a learner stayed usable after that learner was promoted to staff, and links outlived a
suspended or demoted issuer. Now the atomic use (and the page's check) share one SQL condition:
the account is active, the issuer is still an active moderator, and the issuer is a Super Admin
if the account holds a staff role today. Granting a staff role or suspending the account also
discards unused links, in the same transaction. The reset page removes the token from the
address bar once it has loaded. `PASSWORD_RESET_LINKS` defaults to off in production
(`on` enables it, `off` disables it anywhere), so a deploy of `main` can't start real-user
recovery before the owner approves the procedure in SECURITY.md. Accepted limitation: whoever
creates a link could use it. Without email, only the audit trail and the "signed out
everywhere" effect reveal that.

## 2026-11-11 — Integration audit (M6–M9)

**D-046 · The CSP keeps `'unsafe-inline'` scripts for the beta, and lint enforces the
mitigation.** A nonce-based policy needs every page rendered per request (Next.js reads the
nonce from the request), which removes static rendering and changes what the service worker
caches for offline use. That is a performance and offline-behaviour change that needs its own
measured release, not an audit fix. Instead, ESLint now fails on `dangerouslySetInnerHTML`,
on `innerHTML`/`outerHTML` assignments and on creating `script` elements, so the claim "the app
never injects HTML or scripts" is checked on every commit. Plan for later: nonce in `proxy.ts`,
`'strict-dynamic'`, then measure page timings and offline flows before enabling it.

**D-045 · Password recovery without email: staff-issued reset links.** A moderator (a Super
Admin for staff accounts) creates a single-use link that expires after 24 hours. Only its
SHA-256 hash is stored, it is consumed by a guarded `UPDATE` in the reset transaction (safe
under concurrency), a new link discards older ones, and using it signs out every session.
Creation and use are both audited. The identity check is a draft for the owner to approve
(SECURITY.md): send the link only to the account's own email address. When an email provider
is configured, the same tokens can be emailed directly; email verification still needs one.

**D-044 · Tested-out characters are confirmed by writing, not given a schedule.** Placement
only checks recognition (meaning), so it can't create mastery or a spaced-repetition schedule.
The new characters of tested-out lessons now appear in Review as "placement checks", due now,
after any scheduled reviews and in curriculum order. Writing one creates its schedule through
the normal replay of attempts, which removes it from the list. Nothing writes `ReviewSchedule`
or `CharacterMastery` directly. Home's count, Review and the review session use the same rules,
including curriculum visibility (`LEARNER_REVIEWABLE_CHARACTER`).

## 2026-11-11 — M9 production readiness

**D-043 · Structured logs carry no personal data.** Route handlers log method, path (no
query), status and duration only. Values that look like emails, tokens or URL credentials are
masked, and fields named like credentials are dropped. Errors keep going through
`monitoring/report.ts` (stdout plus optional Sentry/GlitchTip).

**D-042 · Migrations are expand, then contract, and checked in CI.** `db:check-migrations`
refuses destructive or rollout-breaking SQL unless the migration carries
`-- migration-safety: allow <rule> <reason>`. It also refuses edits to migrations already on
the base branch. The foreign-key graph stays acyclic, because the backup and restore tools
insert tables in dependency order. This is why `BetaInvite.createdById` is a plain column
(the follow-up migration `beta_invites_acyclic` dropped the constraint; the earlier migration
was already applied and is not edited).

**D-041 · The beta is invite-only by default.** `REGISTRATION_MODE` defaults to `invite` in
production and `open` elsewhere. Invite codes are 50-bit random codes and only their SHA-256
hash is stored. A code is redeemed by a guarded `UPDATE` inside the registration transaction,
so it can't be over-used under concurrency, and a failed sign-up doesn't consume it. Only
Super Admins (`invites:manage`) create and revoke invites, and each change is audited.

## 2026-11-11 — M6 and M7

**D-040 · Placement: 3 questions per unit and a 24-hour retake cooldown.** This cuts the chance
of guessing a unit from 1/16 to 1/64 and stops repeated guessing. Testing out only opens
lessons; it never creates mastery or review history.

**D-039 · Levels are sequential.** A level's first lesson unlocks when the last
learner-visible lesson of the closest lower level is COMPLETED or TESTED_OUT. The first level
is always open. Lessons with progress stay open.

**D-038 · Reviewed shared content is protected.** Characters and words are shared between
curricula. An import may change a record's reading or gloss only if its verification level is
at least the record's (`curriculum/provenance.ts`). Otherwise the existing values are kept and
reported (`protectedKept`). Every import change writes a ContentRevision with the old values.
The import preview shows the same decisions before anything is written.

**D-037 · A curriculum is the unit of release (M6).** Learners see a lesson only if both the
lesson and its curriculum are PUBLISHED (`curriculum/visibility.ts`). This applies everywhere,
including direct links, downloads, attempts and reviews. Admins publish, unpublish or archive
a curriculum with a revision and an audit entry. Publishing needs at least one published
lesson. Withdrawing a curriculum never deletes learner history.

## 2026-11-10 — M5 release integration

**D-036 · Logical backup tool in addition to provider PITR.** `db:backup`, `db:restore` and
`db:verify` use `pg` from Node (no `pg_dump`), stream gzip NDJSON, restore into an empty
migrated database in foreign-key order with constraints enforced, and verify by per-table
content checksums, explicit foreign-key re-checks and app-level reads. Dates are copied as
raw text (node-postgres would otherwise shift timestamps without time zone into local time).
CI runs the drill on every push.

**D-035 · Beta terms are required at sign-up, enforced on the server.** The action rejects
sign-ups without acceptance. Existing accounts see an in-app prompt. Acceptance stores
`termsVersion` and is audited. The documents are drafts pending legal review (LEGAL_REVIEW.md).

**D-034 · Feedback stores the browser family, not the user agent; contact is opt-in.** This
minimises personal data. Staff see a reporter's email only if they opted in. Query strings are
stripped from page paths.

**D-033 · Recall and technique are separate.** See HANDWRITING.md "Mastery policy". A wrong
character never advances anything. Order or direction faults still count as remembering
(the learner did recall the character), but earn capped XP (5), shorten the next interval and
block MASTERED until two consecutive clean recalls. This replaces the M4 behaviour where a
GOOD with a technique fault counted fully. No engine thresholds changed.

## 2026-11-10 — M4 beta readiness

**D-032 · Admin gate in `proxy.ts`.** Next 16 runs `proxy.ts` on Node.js, so it can check the
session and the user's roles in the database before any admin page or metadata renders.
Non-staff get a bare 404, which closes the title leak from M1. Pages and actions still check
their own permissions (defence in depth).

**D-031 · No SDK for error reporting.** Errors are written as JSON lines and, when
`SENTRY_DSN` is set, posted to the Sentry envelope API with `fetch`. This avoids a large
dependency and its build integration, works with self-hosted GlitchTip, and keeps us in
control of what is sent (no user ids; secrets redacted).

**D-030 · Rate limits in PostgreSQL, not Redis.** The beta already has PostgreSQL. One atomic
upsert per check is cheap at beta traffic and needs no new service or account. Swap the store
if traffic grows.

**D-029 · Handwriting acceptance metrics separate structural from technique errors.** The
synthetic baseline showed that a single false-acceptance figure (42 %) mostly reflects the
design choice that direction, order and proportion faults are capped at Good. The headline
measures are false rejection, structural false acceptance (wrong character, missing or extra
stroke: 0 %) and technique errors accepted (85 %, by design). Whether technique errors should
block a recall is left to real-data evidence. **No thresholds were changed in M4.**

**D-028 · Curriculum editing goes through the importer's lesson builder.** Admins edit a
lesson's ordered word list; `buildLessonContent` (shared with `content:import`) regenerates
characters and exercises with the same rules. Hand-written exercises (`custom:` keys) survive
rebuilds. A word's written form and pinyin are immutable because exercises are keyed on them,
so create a new word instead. Every edit bumps `contentVersion` where learners see the change,
so offline downloads show "Update offline copy".

**D-027 · Imports never publish.** Lessons created by the admin import arrive as drafts, to be
previewed (`/admin/lessons/:id/preview`, nothing saved) and published separately. The CLI
seed keeps publishing the starter curriculum.

**D-026 · Offline data is bound to an account, and queued results survive sign-out.** Downloads
are deleted at sign-out or account switch. Unsynced results stay tagged with their owner,
because deleting them would lose real practice. They are never shown to or uploaded by
another account. Offline at sign-out, the learner chooses keep or delete.

## 2026-11-10 — M3 progress and offline

**D-025 · Offline means "downloaded lessons", not the whole app.** The service worker caches
only the static `/offline` pages and hashed build assets. Signed-in HTML is never cached, so a
shared device doesn't keep someone's pages. Without a connection, any navigation shows the
offline page, which lists the lessons downloaded on this device. Queued events and packages are
tagged with the user id, and only the owner's events are uploaded. The service worker is
registered in production builds only, so dev never serves stale code.

**D-024 · Offline answers are checked twice.** The browser grades offline handwriting with the
same engine for instant feedback. On sync the server re-evaluates the raw strokes, and only its
result counts for XP and mastery. A lesson finished offline is queued as a `lesson.complete`
event. The server then attaches that run's session-less attempts to a new session and applies
the normal completion rules, including locks and the skip ratio.

**D-023 · Per-learner advisory lock for progress writes.** Every attempt and lesson completion
runs in one transaction that first takes `pg_advisory_xact_lock(hashtext(userId))`. That
serialises read-modify-write work (XP caps, daily totals, streaks, achievements) per learner
without blocking anyone else. XP rows also have unique idempotency keys (`attempt:<id>`,
`lesson:<user>:<lesson>`, `goal:<user>:<day>`, `achievement:<user>:<key>`).

**D-022 · Mastery and review schedules are replayed from history.** `AttemptCharacterResult`
stores one row per character per attempt. A word attempt therefore credits each character with
its own band. After every attempt, that character's whole history is replayed in `occurredAt`
order (`features/progress/mastery.ts`), so offline attempts that arrive late or out of order
give the same result as if they had arrived on time. `npm run progress:rebuild` recomputes
everything. The migration backfilled single-character attempts made before M3. Word attempts
from M2 have no per-character rows.

**D-021 · XP rules (server only).** Excellent 10, Good 8, Needs improvement 4, Try again 1,
skip 0. Guided (traced or hinted) practice earns half, rounded up. Only the first 3 attempts at
the same exercise per local day earn XP. Exercise XP is capped at 300 per day. A lesson's first
completion earns 20, and replays earn nothing. The daily goal earns a one-off 10 bonus, and
achievements earn their listed reward once. Days, streaks and goals use the learner's own time
zone. Streaks are recomputed from `DailyActivity` rows, so offline days count where they
happened.

**D-020 · Spaced-repetition model.** A simplified SM-2. Only independent recall moves the
schedule: intervals of 1 day, then 3 days, then the previous interval times the ease (1.3–3.0),
up to 365 days. A success counts only when the review is due (up to 15 % of the interval early)
or while the character is still new, so writing it ten times in one sitting doesn't inflate
intervals. A failure (Needs improvement / Try again) halves the repetition count, lowers ease
and brings the review back in 10 minutes. Guided practice never advances the schedule. A
character first seen only in guided practice is due 4 hours later. Levels: LEARNING; FAMILIAR
after 2 spaced successful recalls; MASTERED after 4, provided the latest independent attempt
succeeded. These numbers are initial choices and should be tuned with real usage data.

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
