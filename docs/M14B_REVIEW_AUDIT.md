# M14-b review workflow audit (2026-11-13)

> **Update (owner decisions D-074 and D-075):**
>
> - **Content files:** they can no longer declare REVIEWED or VERIFIED. The schema and the
>   importer both refuse it, on every route.
> - **VERIFIED:** it needs two independent reviewers, and no role is exempt.
> - **Bugs found by the new tests:**
>   - The self-review window let an author verify their own version after someone else
>     reviewed it.
>   - `scripts/content.ts` ignored a file path given first.
>
> Both are fixed. See "Status injection and independent verification" below.

What was checked after PR #25's first CI run, what was fixed and what remains. Decisions:
D-070 to D-073.

## CI failure on PR #25 (run 43408471025, `ad031ae`)

- **Failing step:** `verify` → "Backup and restore drill". `docker` passed.
- **Cause:** a genuine regression. An earlier commit inserted the `CONTENT_REVIEWER` role row in
  a migration. `prisma migrate deploy` into the empty restore database therefore created a
  `Role` row, and `db:restore` refuses a non-empty target. The local equivalent (step 13c)
  failed the same way: "Target is not empty (Role)".
- **Fix (`4c8be63`):** the data migration was removed. Role rows come from the seed, or are
  created on grant.
- **Next failure:** local CI on `4c8be63` then found a second regression, which GitHub would
  have hit in its e2e step. The new Review progress table made an existing Content quality
  locator ambiguous. Fixed in `3b6c582` by scoping the assertion to each table. It now asserts
  both tables.

## Scope check (end to end)

| Requirement                             | Status                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| Edition labels for learners             | Done (Learn, lesson, admin preview; e2e `auth-journey`)                          |
| REVIEWED distinct from VERIFIED         | Done (labels; queue levels; curriculum needs items at its level)                 |
| `CONTENT_REVIEWER`, `curriculum:review` | Done; least privilege checked page by page and action by action (below)          |
| Queue for characters, words, examples   | Done. Examples are part of a word's version. HSK 1 Starter has no examples today |
| Approve / request changes               | Done; notes required for changes; repeated approvals refused (new)               |
| History and audit                       | Done; rows never updated or deleted; invalidations audited                       |
| Source provenance                       | Done; plus withdrawn source approvals (new, `--reconcile`)                       |
| Progress on Content quality             | Done; also on the queue and in the CLI                                           |
| Exact version; invalidation on change   | Done; imports now reconcile shared items in other curricula too (new)            |
| No self-review                          | Done (conservative: any audited action by the reviewer since the last approval)  |
| Concurrency                             | Hardened and tested (D-073)                                                      |

## Authorization and security

- **Pages:** every admin page calls `requirePagePermission`. A Content reviewer reaches the
  `curriculum:read` pages and Review only. Edit, import, users, audit, invites, feedback,
  handwriting and operations pages are refused.
- **Server actions:**
  - All 16 curriculum mutations require `curriculum:write` server-side, and imports require
    `content:import`.
  - Review decisions require `curriculum:review` in the action and again in the service.
- **Direct requests:**
  - **Revocation:** a form left open after the role is revoked is refused by the action.
  - **Suspension:** a form left open after suspension is refused by the proxy, before any
    action runs.
  - **Coverage:** both cases are in e2e, and both check that nothing was recorded.
- **Sessions:** roles and status are reloaded on every request, so there are no stale
  privileges.
- **Deleted reviewers:** `ContentReview.reviewerId` is set to null, and the reviewer's role and
  the decision are kept.
- **CSRF:** server actions are same-origin only (Next.js checks Origin against Host), and the
  CSP has `form-action 'self'`. No new route handlers.
- **Fixed: recorded role.** Decisions recorded the reviewer's first admin role, so an editor
  who is also a reviewer showed as "curriculum editor". They now record the role that grants
  review (`reviewerRoleOf`, unit tested).
- **Errors:** refusals explain the reason without exposing other records. Unexpected errors show
  a generic message, and the details are logged server-side.
- **Soft 404 (LOW, kept):** see D-073. Non-staff and suspended accounts get a real 404, and
  staff without one specific permission get the not-found page with status 200. No content is
  sent.
- **Fixed (pre-existing, LOW):** `importContentAction` returned validation messages before its
  permission check. They described only the caller's own file (2 MB cap), and the proxy blocks
  non-staff, so nothing leaked. The permission is now checked first, as `validateImportAction`
  already did.

## Status injection and independent verification (D-074, D-075)

| Route that writes a status        | REVIEWED or VERIFIED possible?                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Admin validate and import actions | No: the schema rejects it, and the importer refuses again (e2e)                      |
| `content:validate` and `:import`  | No: the same validator, then the importer (integration runs the CLI)                 |
| Seed                              | No: validator, then importer, on `content/hsk1-starter.json` (PROVISIONAL)           |
| Direct `importCurriculumContent`  | No: `ContentStatusError` before the transaction (integration)                        |
| Create and edit forms             | No: creation forces PROVISIONAL; edits refuse changes (integration)                  |
| Reconciliation                    | Only lowers to PROVISIONAL                                                           |
| `recordReview`                    | The only way up: version-bound, independent, source rules                            |
| Backup restore                    | Restores existing rows exactly. Not an ingestion path; guarded by the restore checks |

## Accessibility

- **Automated:** `/admin/review` is in the axe spec (WCAG A/AA, light and dark, desktop and
  mobile).
- **Fixed: named review cards.** Each card was a `<div aria-labelledby>`, but ARIA doesn't allow
  naming a generic element. It's now an `<article>` named by the item's heading. That groups
  each item's identical "Record decision" button with its item for screen readers.
- **Fixed: detail labels.** Labels show "Part of speech", "Fingerprint" and so on, not raw keys.
- **Already in place:**
  - Statuses are given in text, not only by colour.
  - Filters and the curriculum switcher are navigations with `aria-current`.
  - The item count is a status message.
  - Chinese text uses `lang="zh"`.
  - Every field is labelled, and errors are announced through the form's alert.
  - Layouts wrap at phone width, and keyboard order follows reading order.

## Concurrency

The strategy and its rationale are in D-073. Results with `REVIEW_RACE_ROUNDS=50`, run locally:

| Race                                      | Rounds | Approval committed first / refused |
| ----------------------------------------- | ------ | ---------------------------------- |
| Approval vs edit (word)                   | 50     | 24 / 26                            |
| Approval vs import (changes the item)     | 50     | 25 / 25                            |
| Curriculum approval vs structure edit     | 50     | 32 / 18                            |
| Edit vs edit (same item)                  | 50     | both applied, 2 revisions          |
| Reviewer vs reviewer (same version)       | 50     | exactly 1 approval each round      |
| Approve vs request changes (same version) | 50     | both recorded; status = later one  |
| Edit vs import (same items)               | 50     | both succeeded                     |

- **No deadlocks.** No race in any round deadlocked, and the invariant held after every round.
- **Single-case tests:** repeated approvals, source withdrawal (preview, then apply) and
  rollback (a failed import keeps its approvals; a refused approval writes nothing).
- **Import lock experiment:** with the exclusive import lock made shared, the import races
  failed in round 0, so the exclusive lock stays.

## Performance

These figures are for the HSK 1 Starter queue on the local test database: 184 items, 7 runs.

| Measure                       | Before | After |
| ----------------------------- | ------ | ----- |
| Queries per queue computation | 32     | 22    |
| Median time                   | 30 ms  | 28 ms |

- **What changed:** each item's fingerprint is now computed once (the curriculum version used
  to recompute all of them).
- **Shape:** there's no N+1 pattern, and the query count is fixed whatever the curriculum's
  size.
- **Pagination:** it's in memory, 20 per page, which is fine at this size.
- **Indexes:** `ContentReview(entityType, entityId, createdAt)` serves history lookups.
- **Import lock duration:** an HSK 1 Starter import holds the exclusive lock for 0.9–1.6 s.

## Curriculum audit (read-only, `content/hsk1-starter.json`)

| Check                     | Result                                                                                                                                             | Severity |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Validator                 | Passes. The 3 known warnings: two lessons with 9 new characters, and 朋 and 友 both glossed "friend". Not resolved: gated on teacher review        | LOW      |
| Duplicates                | None: no repeated word (simplified + pinyin), and no simplified form listed twice                                                                  | —        |
| Characters ↔ words        | Every character is in a word, and every word's characters are defined (102 / 81)                                                                   | —        |
| Pinyin letters            | Every word's letters match its characters' readings                                                                                                | —        |
| Tones                     | Differences only where dictionaries use the neutral tone (xièxie, bàba, péngyou…) and for 不 sandhi (bú kèqi). Conventional. Teacher to confirm    | INFO     |
| Lesson mapping            | The database matches the file (import preview: 0 changes). The local dev database's curriculum source text is older: it updates on the next import | INFO     |
| Sources                   | Items cite no own sources; the curriculum default `hanziquest-authored` applies, and it awaits the owner's approval                                | Owner    |
| Examples                  | None in the file; nothing to trace yet                                                                                                             | —        |
| Edition tags              | None (needs owner approval, D-060). Labels say "HSK 2.0 edition" and "not official HSK material"                                                   | —        |
| Review queue completeness | 183 items plus the curriculum. 0 approved, 183 blocked by sources (correct)                                                                        | —        |

No content was changed, and no source was approved.

## Independent audit, round 2 (2026-11-14)

The review system was audited again from the code, not from the earlier tests. Decisions:
D-076 to D-078.

### Findings

| #   | Finding                                                                                                    | Severity | Status                     |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| 1   | Backups could duplicate or skip rows in tables paged by a repeating first column (pre-existing since M10)  | HIGH     | Fixed (D-078), drill added |
| 2   | Re-importing a curriculum silently demoted an approved curriculum, with no audit entry                     | MEDIUM   | Fixed (D-077), test        |
| 3   | Fingerprint v1 missed stroke outlines, stroke-data asset provenance and word audio                         | MEDIUM   | Fixed (v2, D-076), test    |
| 4   | After an approval, the item left the "Open" list with its own confirmation, and focus was lost             | MEDIUM   | Fixed (D-077), e2e         |
| 5   | Learner status descriptions claimed review "by a qualified teacher", which the system can't know           | LOW      | Fixed (D-077)              |
| 6   | "Changed since approval" reported nested objects (examples, assets) as changed because jsonb reorders keys | LOW      | Fixed (D-077)              |
| 7   | A double-submitted request for changes recorded two decisions and two audit entries                        | LOW      | Fixed (D-077), test        |
| 8   | The content CLI ignored unknown options and extra files                                                    | LOW      | Fixed (D-077), unit tests  |
| 9   | CLI and seed imports have no actor, so self-review can't attribute them                                    | LOW      | Kept, documented           |
| 10  | The terms page says content will be "checked by a qualified teacher" (a plan, not a status claim)          | INFO     | Left: legal text, owner    |

### Content ingestion

| Route                                | REVIEWED, VERIFIED or example status in a file                             |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Admin validate                       | Refused by the schema (e2e)                                                |
| Admin import                         | Refused by the schema, then by the importer (e2e)                          |
| `content:validate`, `content:import` | Same; the CLI now names the file it uses (integration, unit)               |
| Seed                                 | Validator, then importer                                                   |
| `importCurriculumContent` directly   | `ContentStatusError` before the transaction; nothing written (integration) |
| Admin create and edit                | PROVISIONAL on create; changes refused (integration)                       |

Every database writer of `verification` is listed in DECISIONS.md under "Review status". An
invalid import writes nothing: validation fails before the transaction, and a failure inside it
rolls back, including any invalidation (integration).

### Two-reviewer state machine

Tested in `content-status.test.ts`:

- **Refusals:**
  - Skipping REVIEWED.
  - Verifying your own review, Super Admin included.
  - The author or importer approving.
  - A stale fingerprint.
  - An unknown licence.
- **Independent success:** two separate audit entries.
- **Invalidation:** by content change, by provenance change and by source withdrawal.
- **Concurrency and repeats:**
  - Repeated and concurrent requests.
  - Concurrent second reviewers (exactly one VERIFIED).
  - First review racing the second, with both orders observed.
- **Accounts:**
  - Deleted reviewers: history keeps the role and decision.
  - Suspended or demoted reviewers: refused (e2e).
- **Attribution:** with several roles, the recorded role is the one that grants review (unit).

### Database and recovery

- **Foreign keys:** `ContentReview.reviewerId` is set to null on account deletion, and the
  decision, level, fingerprint, role and snapshot are kept. Audit entries keep their review id.
- **Restore drill:** run on the local test database, which holds review history (852 reviews,
  one with a deleted reviewer). The steps: backup, a fresh migrated database, restore, then
  `db:verify`. Review tables were identical by digest, and fingerprints recomputed after the
  restore were identical. Before D-078 the same drill failed (a duplicate `UserRole` row).
- **Full drill:** `npm run drill:backup` passes. The `age` encryption part is skipped here
  because the tool isn't installed; CI installs it.
- **Roles:** `CONTENT_REVIEWER` has no dependency on seeded rows. The seed creates every role,
  and granting a role creates a missing row (integration).

### Performance (synthetic, measured)

Local test database on PostgreSQL 18 (Intel i7-10870H, 16 cores, 34 GB). Synthetic curricula
use CJK Extension A characters with 10 synthetic strokes each, plus one word per character.
This isn't real content. The script is `.local/bench-review.ts` (not committed).

| Review items | Import (exclusive lock) | Identical re-import | Queue queries | Queue median | Queue heap | All fingerprints | Item approval | Curriculum approval check |
| ------------ | ----------------------- | ------------------- | ------------- | ------------ | ---------- | ---------------- | ------------- | ------------------------- |
| 184          | 1.4 s                   | 0.8 s               | 23            | 29 ms        | 10 MB      | 17 ms            | 41 ms         | 71 ms                     |
| 600          | 3.2 s                   | 2.3 s               | 23            | 48 ms        | 24 MB      | 31 ms            | 16 ms         | 140 ms                    |
| 1,500        | 7.6 s                   | 5.9 s               | 23            | 120 ms       | 17 MB      | 88 ms            | 35 ms         | 347 ms                    |
| 3,000        | 15.3 s                  | 11.4 s              | 23            | 210 ms       | 31 MB      | 162 ms           | 19 ms         | 634 ms                    |

- **Queue:** constant query count (no N+1), and time grows linearly. The page renders 20 items
  at a time.
- **Limit (estimate, not measured):** the import holds the exclusive review lock. Approvals and
  edits wait for it, with a 30 s transaction limit. By extrapolation, an import of about 6,000
  items would make a waiting approval time out; it would fail with nothing written.
- **Cause:** the cost is the importer's per-item upserts (M7). Batching them is a contained
  follow-up. The lock stays exclusive (D-073).

### Accessibility (automated)

- **axe:** `/admin/review` is clean (WCAG A/AA, light and dark, desktop and mobile).
- **New e2e:**
  - A keyboard-only decision, with focus landing on the confirmation.
  - No sideways scrolling at phone width.
- **Changes:**
  - An empty-result message.
  - Each review card is an `<article>` named by its heading.
  - Chinese text is marked `lang="zh"`.
- **Not tested:** a manual screen-reader pass (NOT RUN).

### Curriculum (read-only, `content/hsk1-starter.json`)

The earlier findings stand: no duplicates, consistent pinyin, standard neutral tones and 不
sandhi, and the 3 known warnings. Additional findings, in priority order:

1. **Owner:** sources await approval, so all 183 items are blocked from review (correct).
2. **Teacher:** confirm the neutral-tone conventions, plus the 3 warnings.
3. **INFO: simplified only.** No traditional forms are recorded (0 of 102 characters, 0 of 81
   words), and no radicals. The app doesn't claim traditional support.
4. **INFO: reuse.** 17 characters appear in more than one word, and 7 span lessons. Every word
   has a part of speech. The reading alternatives (谁 shuí, 子 zi, 兴 xīng) are standard.
