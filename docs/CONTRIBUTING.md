# Contributing to HanziQuest

A short guide for everyone who works on the code: people and AI agents. Agents also follow
`CLAUDE.md`.

## 1. Run the real app locally (no shortcuts needed)

The README's **Getting started** gives you the full app with a real database. You don't need
Docker or a hosted database, and it works on Windows.

```bash
npm run db:local     # keep it running
npm run db:deploy
npm run db:seed
npm run dev
```

**To see a page as a learner,** register at `http://localhost:3000/register`. Registration is
open in development, and the HSK 1 starter lessons are seeded.

**If something blocks you locally, ask, or open a draft PR describing it.** Please don't comment
out sign-in, rename `src/proxy.ts`, edit `prisma.config.ts`, or add fake data to a page. These
are security and data-integrity guards, and changes like that are easy to merge by accident.

## 2. Branches and pull requests

- **Branch from `main`:**
  - `feature/<area>-<thing>` for features (`feature/practice-hub`);
  - `fix/<thing>` for fixes;
  - `docs/<thing>` for docs;
  - `spike/<thing>` for experiments that won't be merged.
- **Keep PRs small,** one idea each. Screenshots for UI changes (mobile and desktop, light and
  dark).
- **Open a draft PR early** if you want feedback. It also tells others what you're working on.
- **`main` only receives green PRs:** lint, format, typecheck, unit tests and build. Before
  pushing, run:

  ```bash
  npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
  ```

  Changes to `src/features`, API routes or `prisma/` also need `npm run test:integration` (with
  `npm run db:local` running).

- **CI must be green before merging.** Both the `verify` and `docker` jobs. Don't merge on red,
  even when the failure looks unrelated: find out first (docs/BRANCH_PROTECTION.md).
- **Review, then Amos merges:**
  - **Anesu's PRs:** Amos reviews. Claude can do a first technical review on request.
  - **Claude's PRs:** they're pushed from Amos's account, so GitHub shows Amos as the author.
    Amos is the reviewer, and nobody else needs to approve them.
  - **Amos's own PRs:** a review from Anesu or Claude when they touch shared UI or architecture.
- **Dependabot PRs:** merge only when CI is green. A lockfile conflict with another PR is fixed
  by asking Dependabot to rebase (comment `@dependabot rebase`), never by hand-editing.

## 3. Ask before changing these

| Area                                                               | Why                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `src/proxy.ts`, `src/lib/auth/*`, `prisma.config.ts`, `lib/env.ts` | Security and database guards                                       |
| `src/features/*` (services), API routes, `prisma/`                 | Business rules, grading, XP, mastery, streaks, reviews, migrations |
| `src/app/globals.css` tokens, `docs/BRANDING.md`, `icon design/`   | Brand, colour contrast, dark mode                                  |
| `package.json` dependencies                                        | Bundle size, security audit, and exact versions (no `^`)           |
| `content/*.json`                                                   | Curriculum is data, with review rules                              |

Frontend work rarely needs any of these. If it does, say so in the PR description.

## 4. Frontend conventions

- **Reuse what exists:**
  - `src/components/ui/*`: `Button`, `Card`, `Alert`, `ProgressBar`, …;
  - `cn` from `@/lib/utilities/cn`.
  - Stroke order: `StrokeOrderPlayer` (watch) and `GuidedStrokeQuiz` (trace), from
    `@/components/characters` and `@/components/handwriting`.
  - New shared components go in `src/components/ui` or a feature folder, not the root.
- **Use the design tokens** (`bg-surface`, `text-primary`, `border-border`, …), never raw hex.
  Check dark mode: every token has a dark value.
- **Data comes from the server:**
  - Pages load data in server components (`requireUser()` and the `features/*` queries) and pass
    it to client components.
  - Never hardcode lessons or characters in the frontend, and never compute scores, streaks or XP
    on the client.
- **Accessibility:**
  - real headings (`CardTitle` is an `<h2>`);
  - labelled buttons and `aria-pressed` for toggles;
  - Chinese text with `lang="zh"` or the `.hanzi` class;
  - text contrast of at least 4.5 : 1;
  - respect reduced motion (`useReducedMotion`, or `MotionConfig reducedMotion="user"`).
- **New UI libraries** (for example shadcn/ui or Base UI) are a team decision first: what they
  replace, and how they map onto the HanziQuest tokens.

## 5. Working alongside each other (and with Claude)

- **Who does what** (a guide, not a fence):
  - **Amos:** product ownership, architecture decisions, final approval and merges.
  - **Anesu:** frontend, UI/UX, design and frontend implementation.
  - **Claude:** engineering support, including architecture analysis, implementation, tests,
    audits and integration help.
  - Anyone can propose a change in any area through a PR.
- **Before starting something big,** post a one-line note in the team channel (or a draft PR),
  so two people don't build the same thing.
- **Shared architecture** (data loading, component APIs in `src/components/ui`, design tokens):
  agree in the PR or a short note before changing it, so nobody builds on something that is
  about to move.
- **Claude integrates; it doesn't overwrite.**
  - It works on its own branches and never rewrites or force-pushes someone else's branch.
  - It credits the original author in commit messages.
  - It explains each change it makes to their work in the PR.
- **When a design idea touches learning behaviour** (what counts as correct, XP, hints), the PR
  describes it and the owner decides.
