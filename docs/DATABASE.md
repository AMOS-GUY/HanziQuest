# Database

PostgreSQL via Prisma 7. Schema: `prisma/schema.prisma`; migrations: `prisma/migrations/`
(committed, applied with `prisma migrate deploy`).

## Conventions

- IDs are `cuid()` strings. Sync-related records use client-generated UUIDs (`ExerciseAttempt.clientEventId`, `SyncEvent.id`) for idempotency.
- Timestamps are `timestamptz`-equivalent `DateTime` in UTC; calendar days for streaks use `@db.Date` computed in the learner's timezone.
- Curriculum entities use `onDelete: Restrict` so content referenced by learner history cannot be deleted; admins unpublish/archive instead. Join tables cascade from their owning side.
- Personal data cascades from `User` (account deletion removes it); `AuditLog.actor` and `ContentRevision.author` are set to null instead, so the audit trail survives.

## Domains

| Domain                | Models                                                                                                                                                                       | Notes                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Auth                  | User, Profile, Account, Session, VerificationToken, Role, UserRole                                                                                                           | Account/Session/VerificationToken are the Auth.js adapter tables. Roles are rows (`RoleKey` enum) so assignments are auditable. |
| Curriculum            | Curriculum, HSKLevel, Unit, Lesson, Character, CharacterStroke, CharacterAsset, Vocabulary, VocabularyCharacter, LessonVocabulary, LessonCharacter, Exercise, LessonExercise | See below.                                                                                                                      |
| Learning              | LearningSession, LessonProgress, ExerciseAttempt, CharacterMastery, ReviewSchedule, LearningGoal, PlacementAssessment, AssessmentResult                                      | Attempts are append-only history; mastery and review schedules are derived from them.                                           |
| Gamification          | XPTransaction, Achievement, UserAchievement, DailyActivity, Streak                                                                                                           | XP is a ledger (`SUM(amount)`), each row with a unique `idempotencyKey`.                                                        |
| Offline               | Device, SyncEvent, DownloadedContentVersion                                                                                                                                  |                                                                                                                                 |
| Administration        | AuditLog, ContentRevision                                                                                                                                                    |                                                                                                                                 |
| Monetization (future) | SubscriptionPlan, Subscription, PaymentCustomer, PaymentTransaction, PaymentEvent, Entitlement                                                                               | Schema only. Prices in minor units with an explicit currency.                                                                   |

### Curriculum model

- A **Curriculum** is versioned (`framework` + `version` unique; e.g. `HSK_2_0` / `starter-1`).
  HSK 2.0 and HSK 3.0 are separate curricula, never merged.
- **Character** is global (unique `hanzi`) and independent of any curriculum. **Vocabulary** is
  global (unique `simplified` + `pinyin`). A word links to its characters through
  `VocabularyCharacter` (ordered), so one character can appear in many words.
- Lessons reference vocabulary (`LessonVocabulary`) and the characters they teach
  (`LessonCharacter`, where `isNew` marks the lesson that first introduces a character).
- **Exercise** belongs to one curriculum version and has a stable `key` (unique per curriculum),
  so re-imports update exercises in place.
- `Lesson.contentVersion` increases whenever a lesson's word list changes. Offline packages will
  compare against it.
- `verification` (`PROVISIONAL` / `REVIEWED` / `VERIFIED`) and `licenseStatus` are stored on
  curricula, characters and vocabulary. Only `VERIFIED` content may be presented as official.

### Lesson progress and attempts (M2)

- `LessonProgress(userId, lessonId)` holds IN_PROGRESS, COMPLETED or TESTED_OUT (set by
  placement). No row means not started. Locked/available is derived, never stored.
- `LearningSession.completedAt` is set when every lesson exercise has an attempt in that
  session and at least half were not skipped.
- `ExerciseAttempt` stores the raw normalised strokes (`strokeData`), the server's evaluation
  JSON (`evaluation`, including `engineVersion`), `mode` (GUIDED/INDEPENDENT), `result` and an
  integer `score`. `clientEventId` (UUID) makes submission idempotent.

### Mastery vs vocabulary

Character mastery (`CharacterMastery`) and vocabulary knowledge are tracked separately. Guided
and independent attempts have separate counters. No mastery logic exists yet (milestone M3).

## Local development database

`npm run db:local` runs a real PostgreSQL 18 server from the `embedded-postgres` binaries in
`.local/postgres` (port 5433, UTF-8). No Docker needed. It creates `hanziquest` and
`hanziquest_test`.

```bash
npm run db:local        # keep running in its own terminal
npm run db:migrate      # create/apply migrations in development
npm run db:seed         # roles, achievements, HSK 1 starter content, optional admin
```

## Migrations policy

- Never edit an applied migration. Create a new one.
- Production uses `prisma migrate deploy` only. `migrate reset` and `db push` must never run
  against production.
- Destructive changes (dropping or renaming columns) need a backup and a two-step
  expand/contract migration.
