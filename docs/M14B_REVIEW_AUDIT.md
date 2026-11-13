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
