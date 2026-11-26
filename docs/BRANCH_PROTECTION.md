# Protecting `main` (proposal, not active)

**Status (2026-11-26):** `main` has **no branch protection and no rulesets**, checked through
the GitHub API. Nothing in this document has been switched on. Only the owner changes repository
settings.

## Why

PR #35 was merged while both CI jobs were failing. The production build broke, and three guards
were switched off: practice sign-in, the admin gate and the hosted-database guard (restored in
#39). Required checks would have stopped it at the merge button.

## Recommended configuration

Two rulesets, so the owner can merge Claude-authored PRs, which GitHub shows as the owner's own,
without weakening the checks.

**Ruleset 1, "main: checks and PRs". No bypass, apart from the emergency rule below.**

| Setting                               | Value                                                           | Why                                                                          |
| ------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Target                                | default branch (`main`)                                         |                                                                              |
| Restrict deletions                    | on                                                              |                                                                              |
| Block force pushes                    | on                                                              | History is shared                                                            |
| Require a pull request before merging | on, **0** required approvals                                    | Every change goes through a PR. Approvals are in ruleset 2                   |
| Require status checks to pass         | `verify`, `docker`, from GitHub Actions (job names in `ci.yml`) | No merge on red                                                              |
| Require branches to be up to date     | off                                                             | Avoids a rebase treadmill for a small team; CI runs on the PR's merge commit |
| Require conversation resolution       | on                                                              |                                                                              |

**Ruleset 2, "main: review".**

| Setting                                     | Value                                             |
| ------------------------------------------- | ------------------------------------------------- |
| Require a pull request, with **1 approval** | on                                                |
| Dismiss stale approvals on new commits      | on                                                |
| Bypass list                                 | repository admin (Amos), "for pull requests only" |

**What that means:**

- **Anesu's PRs:** CI plus Amos's approval.
- **Claude's PRs** (from Amos's account): CI, then Amos merges with the bypass. GitHub records
  the bypass.
- **Nobody can push directly** or merge on red, the owner included, except in an emergency.

The files `.github/rulesets/main-checks.json` and `.github/rulesets/main-review.json` hold both
rulesets. To use them: Settings → Rules → Rulesets → New ruleset → **Import a ruleset**. They're
saved with enforcement **"disabled"**, so importing changes nothing until someone switches them
to **Active**.

## Checklist for the owner

1. Merge the dependency fix (`fix/eslint-9-peer-range`) first. Until then, `verify` fails on
   `main` itself, and required checks would block every PR.
2. Import both rulesets. Check that the required checks list shows `verify` and `docker`, as
   they appear on a recent PR.
3. Switch both to **Active**.
4. Open a small test PR and confirm the merge button waits for the checks.
5. Optional: Settings → Actions → "Require approval for first-time contributors". It's already
   the default for forks.

## Emergencies

**If `main` is broken and CI itself can't pass** (for example, a GitHub Actions outage):

1. The owner temporarily adds themselves to ruleset 1's bypass list.
2. Merges the fix.
3. Removes the bypass.
4. Records the reason in `docs/DECISIONS.md`.

**A red check that's "unrelated" is not an emergency.** Fix it or skip it explicitly in a PR.

## Dependabot

- Dependabot PRs need the same checks.
- Advisory: Firefox e2e is `continue-on-error`, so it isn't a required check.
