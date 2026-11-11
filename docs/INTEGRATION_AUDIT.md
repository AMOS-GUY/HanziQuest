# M6–M9 integration audit (2026-11-11)

Before anything else is merged, this audit checks that the four overnight milestones are present,
consistent and safe to merge into `main`. It also fixes the outstanding defects that could be
fixed without outside help. **Nothing was merged, deployed or published.** No PRs were opened
(this machine has no GitHub CLI or token), and no real users or handwriting samples are
involved.

## 1. Git history (verified)

`git fetch --all --prune` was run on 2026-11-11. The remote's PR refs (`git ls-remote origin
'refs/pull/*'`) show PRs **#1 to #5 only**, all already merged into `main`. **No PR exists for
M6, M7, M8 or M9**, and nothing new has been merged.

| Ref                                           | Commit                               | Parent           |
| --------------------------------------------- | ------------------------------------ | ---------------- |
| `main` (= `origin/main`)                      | `01d128e` Merge pull request #5 (M5) | —                |
| `feature/m6-quality`                          | `b2ee19c`                            | `main` `01d128e` |
| `feature/m7-curriculum`                       | `d53776c`                            | `b2ee19c`        |
| `feature/m8-experience`                       | `3bb55bb`, `505bc57`                 | `d53776c`        |
| `feature/m9-production`                       | `b53b11f`                            | `505bc57`        |
| `feature/integration-audit` (new, this audit) | `537b64f`, then a docs-only commit   | `b53b11f`        |

The history is linear: each branch contains the previous one (`git merge-base --is-ancestor`
holds for every step), and `main` hasn't moved since M6 branched. Local and remote branch heads
were identical before this audit. Nothing was rewritten or force-pushed.

## 2. Milestone verification

Each milestone was checked out on its own (a separate worktree at the exact commit), against its
own freshly created test database. Results:

| Check                                        | M6 `b2ee19c` | M7 `d53776c` | M8 `505bc57` | M9 `b53b11f` |
| -------------------------------------------- | ------------ | ------------ | ------------ | ------------ |
| Typecheck, lint (0 warnings), format         | pass         | pass         | pass         | pass         |
| Unit tests                                   | 126 / 126    | 144 / 144    | 144 / 144    | 150 / 150    |
| Integration tests (fresh database)           | 66 / 66      | 72 / 72      | 72 / 72      | 79 / 79      |
| Migrations applied to an empty database      | pass         | pass         | pass         | pass         |
| Schema vs migrations (`prisma migrate diff`) | no drift     | no drift     | no drift     | no drift     |
| Content validation                           | pass         | pass         | pass         | pass         |

Browser tests per milestone were run during the overnight session (PROGRESS.md). In this audit
they were run once more on the final branch (section 5).

**Diff review (each branch against its parent):**

- **M6** (22 files): quality fixes, the `attempt_session_index` migration, tests and the audit
  document. No unrelated changes.
- **M7** (28 files): curriculum tools, placement and level rules, and docs. No schema changes.
- **M8** (26 files): accessibility and handwriting changes, `@axe-core/playwright` (dev only),
  screenshots and docs. **No M9 changes leaked in.** The overnight accidental branch switch only
  committed M8's own PROGRESS section, which was checked line by line, and M8's schema is
  identical to M7's.
- **M9** (45 files): invites, migration safety, operations, CI and docs, plus two migrations.
- **Documentation lag (harmless):** the CLAUDE.md gotchas for M6's visibility rule and M7's
  provenance rule only arrive with M9. They are correct once all four are merged.
- **Docs vs code:** the M6–M9 documents match the implementation. Two statements are now
  superseded by this audit and were updated: the M7 and M9 notes on tested-out characters, and
  SECURITY.md limitation 2 (password reset).

**Secrets and personal data:** every line added in M6–M9 was scanned for keys, tokens, private
keys, connection strings and email addresses. Only test values were found: `example.com` and
`hanziquest.test` addresses, test passwords such as `password-1234`, and a fake connection
string inside the log-redaction test. No `.env` files, backups, database dumps or handwriting
samples are tracked. The screenshots show e2e test accounts only. GitHub links in RELEASE.md
name the repository, which was already the case on `main`.

**Migrations, in order** (all additive; the safety check passes against `origin/main`):

| #   | Migration                              | Branch            | Effect                                                         |
| --- | -------------------------------------- | ----------------- | -------------------------------------------------------------- |
| 1   | `20261110182108_attempt_session_index` | M6                | index on `ExerciseAttempt.sessionId`                           |
| 2   | `20261110192230_beta_invites`          | M9                | `BetaInvite` table, nullable `User.inviteId`                   |
| 3   | `20261110192315_beta_invites_acyclic`  | M9                | drops the creator FK so the FK graph stays acyclic for restore |
| 4   | `20261111012158_password_reset_tokens` | integration audit | `PasswordResetToken` table                                     |

## 3. Defects and risks

| ID    | Item                                                            | Severity          | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IA-01 | Tested-out characters never reached writing review              | Medium            | **Fixed (D-044).** They appear in Review as one-time "placement checks" after scheduled reviews, until written. Nothing writes schedules directly: writing one creates its schedule through the normal replay. The placement result and Review pages say so. Test: `placement.test.ts` "puts tested-out characters into Review…" (confirmed to fail without the fix).                                                                                                                      |
| IA-02 | Home's due count and the forecast ignored curriculum visibility | Low               | **Fixed.** Found while fixing IA-01: they counted schedules for characters whose only lessons are in an unpublished curriculum, so Home could say "3 to review" while Review said nothing was due. Counts, queue and forecast now share `LEARNER_REVIEWABLE_CHARACTER`.                                                                                                                                                                                                                    |
| IA-03 | Admin area had no accessibility coverage                        | Medium            | **Fixed.** The axe audit now covers 23 admin pages (lists, editors, previews, invites, operations), light and dark, desktop and phone. It found 1 rule on phones: 9 sideways-scrolling tables couldn't be reached by keyboard (`scrollable-region-focusable`). They are now focusable, labelled regions. Desktop had no findings.                                                                                                                                                          |
| IA-04 | No password recovery                                            | High for a beta   | **Fixed without email (D-045):** staff-issued, single-use, 24-hour reset links (hash-only storage, atomic consumption, signs out all sessions, audited, Super Admin only for staff accounts, 10 per hour per IP). Login page says how to get one. Integration tests (5, including a concurrency test) and an e2e test. **Still blocked:** emailed resets and email verification need an email provider. The identity-check procedure in SECURITY.md is a **draft the owner must approve**. |
| IA-05 | CSP allows inline scripts                                       | Medium (accepted) | **Kept, with the mitigation now enforced (D-046).** A nonce-based CSP requires per-request rendering of every page and changes offline caching, which needs its own measured release. ESLint now fails on `dangerouslySetInnerHTML`, `innerHTML`/`outerHTML` assignments and created `script` elements (one harmless `innerHTML = ""` was replaced). The nonce plan is in D-046.                                                                                                           |
| IA-06 | Firefox and real devices untested                               | Medium            | **Partly addressed.** Firefox still can't start here: `firefox.exe` fails with a Windows "side-by-side configuration is incorrect" error, which usually means a missing Visual C++ runtime or a damaged browser download. Installing system software is outside this session's permissions. **CI now runs the e2e suite in Firefox on Linux** as an advisory step. Physical devices, styluses and screen readers still need people.                                                        |
| IA-07 | Retention                                                       | Low               | `ops:prune` also removes expired or used reset links (always safe).                                                                                                                                                                                                                                                                                                                                                                                                                        |

No other open high-severity issue was found. The remaining accepted risks are unchanged:

- guided practice reports its mistake count from the browser (R-01);
- free practice of locked lessons' characters (R-02);
- registration limit per IP for classrooms behind one network address (R-04);
- staff 2FA (SECURITY.md limitation 3);
- handwriting accuracy on real learners is unmeasured.

## 4. Integration sequence

Merge **in this order, with merge commits** (no squash, no rebase), each after its CI is green.
Open each PR against `main` only after the previous one is merged. GitHub then shows just that
milestone's changes.

| PR  | Base   | Compare                     | New migrations                         | Main conflict risk                                                                     |
| --- | ------ | --------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `main` | `feature/m6-quality`        | `attempt_session_index`                | None while `main` stays at `01d128e`.                                                  |
| 2   | `main` | `feature/m7-curriculum`     | none                                   | None after PR 1.                                                                       |
| 3   | `main` | `feature/m8-experience`     | none (adds a dev dependency)           | `package-lock.json` if Dependabot or anyone else changes dependencies on `main` first. |
| 4   | `main` | `feature/m9-production`     | `beta_invites`, `beta_invites_acyclic` | `.github/workflows/ci.yml`, `package.json`, docs.                                      |
| 5   | `main` | `feature/integration-audit` | `password_reset_tokens`                | `docs/PROGRESS.md` (every PR appends to it).                                           |

Each later branch already contains the earlier ones, so with an unchanged `main` every PR merges
cleanly. If something lands on `main` in between (Dependabot will start opening PRs once M9 is
merged), merge `main` into the next branch and push. Don't rebase.

**Required CI checks for every PR** (the `CI` workflow):

- **`verify`**: format, lint, typecheck, unit, integration and the migration safety check.
  From M9 on it also runs the production dependency audit. Then the backup-and-restore drill,
  the production build, Chromium e2e and the smoke test. From PR 5 on, there is also an
  advisory Firefox e2e step.
- **`docker`**: the production image builds.

Recommended: make `verify` and `docker` required status checks on `main`. Make the Firefox step
blocking once it has passed (remove `continue-on-error` in `ci.yml`).

**Rollback:**

- **Code:** revert the PR's merge commit (`git revert -m 1 <merge>`) and redeploy. All
  migrations are additive, so older code runs against the newer schema; never roll back by
  editing or deleting migrations.
- **Reverting M9 also removes invite-only registration.** The older code has open sign-up. In
  production, revert M9 only with the app in maintenance or after an emergency fix that keeps
  registration closed.
- **Reverting the audit PR** removes reset links and placement checks. The
  `PasswordResetToken` table stays unused, and no learner data is lost (placement checks are
  computed, not stored).
- **Database:** for a failed migration follow DEPLOYMENT.md, "Rollback". Take a backup
  (`db:backup`) before the first deploy that applies migrations 1–4.

## 5. Results after the audit fixes (`feature/integration-audit`)

| Check                                                      | Result                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| Format, lint (0 warnings), typecheck                       | pass                                                     |
| Unit tests                                                 | 150 / 150                                                |
| Integration tests                                          | 85 / 85 (79 before; +1 placement checks, +5 reset links) |
| Migration safety check against `origin/main`; schema drift | pass (11 migrations); no drift                           |
| Content validation; production build                       | pass                                                     |
| Playwright Chromium (desktop and Pixel 7 emulation)        | 36 passed, 18 skipped, 0 failed                          |
| Playwright WebKit (desktop Safari and iPhone 14 emulation) | 40 passed, 14 skipped, 0 failed                          |
| Smoke test against a local production server               | 8 / 8                                                    |
| Local backup → restore → verify drill (development data)   | every table matched; 70 FKs checked, 0 orphaned rows     |

Skipped browser tests are phone copies of desktop-only flows and the opt-in screenshot runs.
GitHub CI, Firefox, physical devices, real screen readers and real learners were **not** part
of any of these results.

## 6. Owner actions

1. Open PR 1 (`main` ← `feature/m6-quality`), check CI, merge with a merge commit. Repeat for
   PRs 2–5 in order.
2. Approve or change the password-reset identity check (SECURITY.md) before staff use reset
   links with real learners.
3. On a Windows machine where Firefox fails the same way: install the Microsoft Visual C++
   Redistributable, then run `npx playwright install firefox --force` and
   `E2E_ALL_BROWSERS=1 npx playwright test --project=firefox`. Otherwise rely on the CI step.
4. Everything in `docs/M9_PRODUCTION_READINESS.md` (hosting, secrets, legal review, the pilot,
   device testing) still applies.
