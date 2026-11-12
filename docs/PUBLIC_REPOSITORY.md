# Public repository: exposure, settings and CI status

The repository became public on 2026-11-12. A security audit of every commit was run before
any new workflow run. The detailed report stays outside the repository, with the owner.

## Audit result

- **No secrets:** no credential, API key, token, real database URL or Neon/Render identifier
  in any commit. The only pattern hit is a made-up test fixture.
- **Local files never committed:** `.env`, `.env.staging.local`, backups, logs, `.local/` and
  test reports are git-ignored and never were committed.
- **Development credentials:** the only ones in the repository are the documented local
  embedded-Postgres values (`hanziquest`/`hanziquest@localhost`), which are not secrets.
- **Workflows:** `ci.yml` runs on `pull_request`, not `pull_request_target`. It references no
  secrets and has a read-only token, so pull requests from forks can't reach secrets. The
  deploy and backup workflows run only on manual dispatch, with secrets scoped to GitHub
  environments.

## Author email in commit history (exposed)

Most commits made before 2026-11-12 record the owner's **personal email address** as author and
committer. That metadata is part of git history, so it became public with the repository and
anyone can read it (for example `git log`, or the GitHub API). It isn't repeated here.

- **Done:** commits from this repository now use the GitHub noreply address (local git config,
  D-064).
- **Not done:** history hasn't been rewritten. Rewriting would change every commit SHA, break
  links to merged PRs and invalidate existing clones. It needs the owner's approval, and it
  can't remove copies others already fetched.
- **Owner's options:**
  1. Set the noreply address globally: `git config --global user.email <id>+<login>@users.noreply.github.com`.
  2. Turn on GitHub → Settings → Emails → "Keep my email addresses private" and "Block command
     line pushes that expose my email".
  3. Decide whether a history rewrite is worth its cost.

## Recommended repository settings (owner)

These are settings, not code, and none has been changed here.

1. **Environments → `staging`:** add yourself as a required reviewer, and limit deployment
   branches to `main`. Create **`production`** with the same protection **before** adding any
   secret to it (`deploy.yml` explains why).
2. **Settings → Actions → General → "Approval for running fork pull request workflows":**
   choose "Require approval for all outside collaborators".
3. **Settings → Code security:** turn on secret scanning and push protection (free for public
   repositories), plus Dependabot alerts.
4. Optional: pin third-party actions to commit SHAs. Dependabot already proposes action
   updates.

## GitHub Actions status

**BLOCKED by an account-level billing restriction, not by the code.** Runs on this public
repository are refused before any step starts: "The job was not started because recent
account payments have failed or your spending limit needs to be increased". It affects the PR
#22 runs and the push to `main` (`02a6b68`). Nothing here bypasses it, changes billing or adds
payment details.

Until the account restriction is lifted, `npm run ci:local` (docs/LOCAL_CI.md) is the
verification on record. It is not GitHub CI. Once the restriction is lifted, re-run the
latest `main` run, or open a PR, to get the real Ubuntu, PostgreSQL 17 and Docker checks.
