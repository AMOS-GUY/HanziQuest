# Beta release package

## Status (2026-11-10, M5)

- `main` contains M1–M4 through merged PRs #1–#4, with full commit history.
- M5 is on `feature/m5-launch`. Open a PR into `main`
  (https://github.com/AMOS-GUY/HanziQuest/compare/main...feature/m5-launch?expand=1) and merge
  with a merge commit once CI is green.
- **CI status on GitHub couldn't be checked from here:** the repository is private and no
  GitHub CLI or token is available to this session. Check the Actions tab for PRs #1–#4 and
  the M5 PR.
- **Not deployed.** Hosting, database and secrets need the owner (see HOSTING.md and
  DEPLOYMENT.md).

## Launch checklist (owner)

1. Merge the M5 PR after CI passes.
2. Fill in the legal placeholders and get the documents reviewed (LEGAL_REVIEW.md).
3. Create Neon (Launch) and Render (Starter) accounts or an alternative; set the env vars;
   `npm run db:deploy`; `npm run db:seed`; deploy; `npm run smoke -- <url>`.
4. Run the recovery drill against production (DEPLOYMENT.md) and record the result.
5. Run the five-tester handwriting pilot (HANDWRITING_PILOT.md) and record the report.
6. Invite testers with the beta guide link; triage feedback daily (BUG_REPORTING.md).

## Branches and merge order

None of these branches is merged into `main`. The GitHub CLI isn't installed on the development
machine, so pull requests couldn't be opened from here. Each branch contains the previous one
(a linear history), so they must be merged **in this order**:

| #   | Branch                        | Head commit   | Builds on                     | Open the PR                                                                                               |
| --- | ----------------------------- | ------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `feature/m1-foundation`       | `52bd85e`     | `main`                        | https://github.com/AMOS-GUY/HanziQuest/compare/main...feature/m1-foundation?expand=1                      |
| 2   | `feature/m2-learning`         | `852666e`     | `feature/m1-foundation`       | https://github.com/AMOS-GUY/HanziQuest/compare/feature/m1-foundation...feature/m2-learning?expand=1       |
| 3   | `feature/m3-progress-offline` | `0066a56`     | `feature/m2-learning`         | https://github.com/AMOS-GUY/HanziQuest/compare/feature/m2-learning...feature/m3-progress-offline?expand=1 |
| 4   | `feature/m4-beta`             | see `git log` | `feature/m3-progress-offline` | https://github.com/AMOS-GUY/HanziQuest/compare/feature/m3-progress-offline...feature/m4-beta?expand=1     |

Because the history is linear, merging `feature/m4-beta` into `main` alone would bring in all
four milestones. Reviewing them as four PRs keeps each one readable. Use **merge commits or
rebase-merge, not squash**, so later PRs don't conflict with already-merged history. After PR
1 merges, retarget PR 2 to `main`, and so on. Run CI on each.

### Suggested PR descriptions

**M1: Foundation.** Next.js 16 app, PostgreSQL/Prisma schema for every domain, Auth.js
credentials auth, role-based permissions, the basic admin area (lessons publish, users, roles,
audit log), HSK 1 starter curriculum (provisional), CI workflow, unit, integration and e2e
tests.

**M2: Learning and handwriting.** Onboarding, placement check, lesson progression, stroke-order
player, guided tracing (Hanzi Writer), free writing with the HanziQuest evaluation engine
(re-evaluated on the server), practice runner, `/api/attempts` and `/api/sessions`.

**M3: Progress and offline.** Mastery replayed from history, spaced repetition, server-side XP
with anti-farming limits, streaks, daily goals, achievements, Review and Progress screens,
service worker, Dexie outbox, lesson downloads and idempotent `/api/sync`.

**M4: Beta readiness.** Curriculum editing (curricula, levels, units, lessons, characters,
words, exercises) with revisions, audit, import UI and learner preview. Handwriting
validation lab and procedure. Offline account isolation. Security audit fixes (proxy-aware IP,
shared rate limits, session revocation, admin gate, body limits, origin checks). Profile
settings, password change, account deletion, moderation. Error reporting, health endpoint,
smoke test, Dockerfile, deployment and recovery docs.

Each PR body should end with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Before inviting beta users (owner actions)

1. Merge the four PRs in order and confirm CI is green on GitHub. CI has never run there yet.
2. Choose and create the hosting and database accounts (see `docs/DEPLOYMENT.md`).
3. Set production secrets, deploy, run `npm run smoke -- <url>`, and run the recovery drill
   once.
4. Optionally create a Sentry or GlitchTip project and set `SENTRY_DSN`.
5. Collect real handwriting samples (`docs/HANDWRITING_VALIDATION.md`). At minimum, run a
   small pilot (5 testers) before a wider beta, because accuracy with real handwriting is
   unknown.
6. Decide how support will verify identity for manual password resets until email exists.

## Release notes: HanziQuest public beta (draft)

**What you can do**

- Create an account, tell us your level and goals, and optionally take a placement check.
- Follow the HSK 1 starter path (16 lessons, 102 characters). The content is provisional and
  hasn't been reviewed by a teacher yet.
- Watch stroke order, trace characters stroke by stroke, then write them from memory and get
  specific feedback (wrong character, missing or extra strokes, order, direction, shape).
- Review characters on a spaced schedule; earn XP, keep a streak, reach a daily goal and unlock
  achievements.
- Install HanziQuest like an app, download lessons, and practise them offline. Results sync
  when you're back online.
- Manage your profile, daily goal and time zone, change your password, and delete your account.

**Known limitations**

- Handwriting feedback is checked against the HSK 1 characters only. It isn't general
  handwriting recognition, and it hasn't yet been validated on a large set of real learners'
  writing.
- No email yet: no password-reset email, no reminders.
- Review rounds need a connection; offline practice covers downloaded lessons.

## Release notes: M5 additions (draft)

- **Fairer progress:** remembering a character and writing it with correct technique are now
  tracked separately. If you remember a character but draw a stroke backwards or in the wrong
  order, you get some XP and it counts as remembered, but it won't be marked mastered until you
  write it correctly twice in a row. Writing a different character never counts.
- **Feedback:** a Feedback page in the menu, and "Grading looks wrong? Tell us" after each
  writing exercise.
- **Beta terms and privacy notice:** you'll be asked to accept them once.
- Public beta guide, privacy notice and terms pages (drafts pending legal review).
