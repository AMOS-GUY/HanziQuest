# M19 validation

## Local `npm run ci:local` on `190e196` (all code)

**25 PASS, 4 BLOCKED, 2 NOT RUN, exit code 0.**

| Check                                                                      | Result                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install tree, audit, migration safety, lint, format, types, content        | PASS                                                                                                                                                                                                   |
| Unit                                                                       | **342 passed**, including 12 new: `choice` 5, `use-focus-on-change` 4, `form-field` 3                                                                                                                  |
| Integration (fresh test database)                                          | 222 passed                                                                                                                                                                                             |
| Migrate and seed, backup, restore and migration drills                     | PASS                                                                                                                                                                                                   |
| Production build, smoke test, local Docker-equivalent start-up and refusal | PASS                                                                                                                                                                                                   |
| Chromium e2e (desktop and mobile)                                          | **51 passed, 0 flaky, 29 skipped.** The skips are the existing run-once and phone-only tests plus the 4 new one-project tests. `disputes.spec.ts` passed on its first try; it flaked in both M18 runs. |
| Docker (3 steps), `age` encryption                                         | **BLOCKED:** not installed locally. GitHub CI runs them.                                                                                                                                               |
| Firefox e2e                                                                | **NOT RUN locally** (advisory). GitHub CI runs it, and `main` has 4 pre-existing Firefox failures there.                                                                                               |

## Before that, during the work

- **Targeted e2e on a production build:** `learner-polish`, `first-run`, `auth-journey` and
  `accessibility` (axe light and dark, learner, public and admin). 21 passed, 5 skipped.
- **Disputes flake:** `disputes.spec.ts --repeat-each=5` failed 4 of 5 before the fix and passed
  5 of 5 after, on the same long-lived local database.
- **Browser checks:** the before and after numbers are in `M19-findings.md`.
  - CTA bottom: 784 → 636 px at 375×667.
  - Danger contrast in dark mode: 2.28 → 7.48.
  - Header link: 20 → 44 px.
  - Radio tab stops: 4 → 1.

## Coverage gap

The final docs commit (this file and `M19-handover.md`) came after this run and changes no code.
Formatting was re-checked on it.
