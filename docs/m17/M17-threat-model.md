# M17 threat model: learner progression

**Actor:** an ordinary signed-in learner with a browser and devtools. They can replay or script
requests to `/api/*` and server actions, using their own session cookie.

**Assets:** XP, daily goals, streaks, achievements, mastery, review schedules, lesson completion
and unlocks. The M15 aggregate learning measurement reads these.

**Who sees progression:** only the learner themself. There are no leaderboards and no social
features. M15 analytics are aggregate and off by default. Forged progress therefore misleads the
learner and pollutes measurement. It doesn't harm other learners. This caps most severities at
Medium.

**Status legend:** ✅ holds (with evidence) · ⚠️ verified weakness, see `M17-audit-findings.md` ·
🔧 fixed in this mission · 🔎 code-reading only, not exercised by a test.

| Threat                                                                    | Control in place                                                                                | Status                                                 |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Direct URL to a locked lesson's practice                                  | `/practice/lesson/[id]` redirects. `startLessonSession` refuses.                                | ✅ learning.test, e2e                                  |
| Direct URL to free character practice of a locked lesson's character      | None: publication is checked, lesson state isn't                                                | ⚠️ F-01                                                |
| API: attempt on a locked lesson's exercise (`/api/attempts`, `/api/sync`) | Publication only                                                                                | ⚠️ F-01                                                |
| API: attempt naming a session for another lesson, or a review session     | Session ownership checked; its lesson and type aren't                                           | ⚠️ F-06, Low (no completion effect, tested)            |
| API: complete a lesson directly                                           | D-019 checks, idempotent, locked lessons can't start                                            | ✅ learning.test                                       |
| Complete a lesson with no exercises                                       | Not in `main`                                                                                   | ⚠️ F-05, fixed by **#48** (unmerged)                   |
| Complete a lesson unpublished or archived mid-session                     | Was missing                                                                                     | 🔧 F-03                                                |
| Client-supplied score, result or XP                                       | Ignored. Handwriting re-graded.                                                                 | ✅ learning.test, progress.test                        |
| Client-supplied guided mistakes                                           | Trusted, labelled as client-reported, half XP, never mastery                                    | ✅ documented (SECURITY.md); F-07 informational        |
| Client-supplied `hintsUsed`                                               | Trusted. Claiming 0 hints makes an attempt INDEPENDENT.                                         | F-08 informational: inherent to client-side hints      |
| Client-supplied `occurredAt`                                              | Accepted within 30 days back and 5 minutes forward, and decides the replay order and the XP day | ⚠️ F-02                                                |
| Repeated submissions (same id)                                            | Unique `clientEventId`. Returns the stored attempt.                                             | ✅                                                     |
| Repeated submissions (new ids)                                            | 3 rewarded per exercise per day, a 300 per day cap, "early repeats don't count" for SRS         | ✅ progress.test (per day; see F-02 for days)          |
| Concurrent submissions                                                    | Advisory lock and idempotency keys                                                              | ✅ progress.test                                       |
| Concurrent lesson starts                                                  | `createMany skipDuplicates` (#44)                                                               | ✅ session-start-race.test                             |
| Concurrent placement submissions                                          | Was a check-then-act                                                                            | 🔧 F-04                                                |
| Unpublished or archived content in attempts                               | `LEARNER_VISIBLE_LESSON`                                                                        | ✅ learning.test                                       |
| Suspended account                                                         | `getCurrentUser` returns null unless ACTIVE (D-005)                                             | ✅ e2e session-security, admin-review                  |
| Anonymous request                                                         | `requireApiUser` gives 401. Pages redirect.                                                     | ✅ e2e                                                 |
| Incomplete onboarding                                                     | Pages redirect. The API doesn't check it.                                                       | 🔎 F-09 informational: defaults apply, no extra reward |
| Another learner's attempt, session, assessment or event id                | Ownership checks                                                                                | ✅ learning, progress and placement tests              |
| Stale session after suspension or a password change                       | Roles and status are re-read per request                                                        | ✅ e2e session-security                                |
| Time-zone switching to re-bucket "today"                                  | Time zone is learner-editable. Caps are per local day.                                          | 🔎 F-10, Low, not exercised                            |
| Admin manipulation                                                        | No admin path writes progress. Publication needs `curriculum:publish` and is audited.           | ✅ 🔎                                                  |
| Database inconsistency                                                    | Mastery and schedules are replayed, never incremented. `progress:rebuild` exists.               | ✅                                                     |
