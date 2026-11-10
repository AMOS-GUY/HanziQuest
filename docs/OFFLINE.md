# Offline learning and synchronisation

HanziQuest works offline **for lessons the learner has downloaded**. Review rounds, the
learning path and admin need a connection.

## Pieces

| Piece                  | Where                                                | Role                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service worker         | `public/sw.js`                                       | Precaches `/offline`, `/offline/practice` and the build assets they reference. Hashed assets are cache-first. Navigations are network-first, falling back to `/offline`. Never caches `/api/*` or signed-in HTML. |
| Local database (Dexie) | `src/features/offline/client/db.ts`                  | IndexedDB `hanziquest`: `packages` (downloaded lessons), `outbox` (queued events), `meta` (device id, active account).                                                                                            |
| Lesson download        | `POST /api/lessons/:id/download`                     | Returns the practice payload for an unlocked lesson and records the device's content version.                                                                                                                     |
| Outbox and sync client | `src/features/offline/client/sync.ts`                | Uploads queued events in order, in batches (25, shrinking on 413). Runs on app start, on reconnect, and every 60 s while anything is waiting.                                                                     |
| Sync API               | `POST /api/sync`, `features/offline/sync-service.ts` | Applies events idempotently (event id = attempt `clientEventId`), with the same validation and server-side evaluation as online submissions.                                                                      |
| Account isolation      | `src/features/offline/client/account.ts`             | See below.                                                                                                                                                                                                        |

## Flow

1. Online: the learner taps **Download for offline** on a lesson page. The package (exercises,
   stroke data and the candidate set for local grading) is stored with the learner's user id.
2. Offline: any navigation shows `/offline`, which lists the active account's downloads. In
   `/offline/practice?lesson=…`, answers are graded on the device straight away and each
   attempt goes into the outbox.
3. Finishing the lesson queues a `lesson.complete` event that carries the run's attempt ids.
4. Back online: the outbox is uploaded. The server re-evaluates every drawing, awards XP once
   per attempt (idempotency keys), replays mastery and review schedules in time order, and
   completes the lesson if the normal rules (locks, skip ratio) allow it.

## Guarantees

- **No duplicate XP.** Every event id is stored in `SyncEvent`. Re-uploading a batch, for
  example after a lost response, returns `duplicate` with no side effects. XP rows carry unique
  idempotency keys.
- **Interrupted syncs resume.** Events that hit an unexpected server error stay `RECEIVED` and
  are reprocessed on the next upload. Events rejected for a reason (invalid, too old, lesson
  locked) are marked rejected and never retried.
- **Server authority.** Client grades are only for instant feedback. XP, mastery and lesson
  completion come from the server.
- **Order independence.** Mastery and review state are replayed from the full attempt history
  sorted by `occurredAt`, so late-arriving offline attempts land in the right place.

## Account isolation on shared devices

| Situation                                | What happens                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learner signs out (Profile → Log out)    | Pending results are uploaded first (up to 4 s). Then the account's downloads and rejected events are deleted, and the "active account" marker is cleared. If offline with unsynced results, the learner chooses to keep them (they sync at the owner's next sign-in on this device) or delete them. |
| A different account signs in             | The previous account's downloads are deleted. Its queued results stay tagged with the owner's id. They are never shown to, counted for, or uploaded by the new account.                                                                                                                             |
| Offline page with nobody signed in       | Shows "Not signed in". Downloads are only listed for the active account.                                                                                                                                                                                                                            |
| Session expired while results are queued | Uploads get 401 and nothing is dropped. They go up after the next sign-in.                                                                                                                                                                                                                          |
| Server-side                              | `/api/sync` uses the session's user only. Another user's event ids are rejected. Attempts referencing another user's session are refused.                                                                                                                                                           |

These scenarios run in a real browser in `tests/e2e/offline-accounts.spec.ts`: sign-out
clearing, account switching, a blocked sync endpoint and resumption after the owner returns,
with XP counted once.

## Limits

- Offline practice covers downloaded lessons only. Reviews need a connection.
- Queued results are stroke coordinates, not personal text. They aren't encrypted at rest;
  anyone with access to the browser profile could read them with developer tools. Deleting
  the account on the server doesn't clear another device's queue; that happens at that
  device's next sign-out.
- The service worker is only registered in production builds.
