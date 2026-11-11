# Rollback

How to go back after a bad release. **Prepared, not exercised in production**: there is no
production yet. The app rollback relies on Render's own rollback, which only the owner can
test once the service exists.

## Decide first

| Symptom                                                                       | Action                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A new release fails its health check                                          | Nothing to do: Render keeps the previous release serving. Read the deploy log, fix forward. |
| The new release serves, but a feature is broken and data is fine              | **App rollback** (below).                                                                   |
| A migration failed part-way (`/api/health` says `"migrations": "incomplete"`) | **Failed migration** (below).                                                               |
| Data was damaged (a bad script, a bug writing wrong values)                   | **Data recovery** (below) plus an incident (PRODUCTION_OPERATIONS.md).                      |
| The service worker serves something broken offline                            | **Service worker** (below).                                                                 |

Write down the time you noticed, the release (`/api/health` → `release`) and what you did, in
the incident log (PRODUCTION_OPERATIONS.md).

## App rollback (code only)

Every migration is additive (expand, then contract, enforced by `db:check-migrations`), so the
previous release runs on the newer schema. Readiness tolerates a database that is ahead of the
code.

1. Render dashboard → the service → **Events** → the last good deploy → **Rollback**. Or:
   **Manual Deploy → Deploy a specific commit**, with the last good SHA.
2. Wait for `/api/health` to report the old `release` with `"status": "ok"`.
3. `npm run smoke -- https://<origin>`.
4. Revert the bad change on `main` with a PR (`git revert -m 1 <merge commit>`), so the next
   deploy doesn't bring it back. Never force-push `main`.

Special case: **reverting M9 or anything that sets registration defaults** must keep
`REGISTRATION_MODE` unset (invite-only). Check Admin → Operations after the rollback.

## Failed migration

`prisma migrate deploy` runs in Render's pre-deploy step. If it fails, Render cancels the
deploy and the previous release keeps serving. The database may hold a partly applied
migration.

1. Connect with the **direct** URL and read `_prisma_migrations` for the failed row
   (`finished_at IS NULL`). Check which statements were applied.
2. If nothing was applied, or the changes can be undone safely by hand, undo them. Then:
   ```bash
   MIGRATE_DATABASE_URL="<direct URL>" npx prisma migrate resolve --rolled-back <migration_name>
   ```
3. Fix the migration **in a new commit**, before it is ever applied successfully anywhere
   shared. If it was already applied anywhere, write a new forward migration instead. Never
   edit or delete an applied migration.
4. Deploy again through deploy.yml.

Never run `migrate reset` or `db push` against production.

## Data recovery

Prefer the smallest restore that fixes the problem.

1. **Stop the damage:** roll back the app (above), or suspend the job or script that caused it.
2. **Find the point in time** just before the damage (audit log, request logs, error reports).
3. **Restore to a Neon branch** at that time. Don't touch the live database yet. See
   DATABASE_BACKUP.md, "PITR restore". Verify the branch:
   `npm run db:verify -- --source <branch direct URL> --target <branch direct URL>` (FK check),
   then start the app against it locally and run the smoke test.
4. Choose one:
   - **Partial repair (preferred):** copy only the damaged rows from the branch into
     production with a reviewed, idempotent script, in one transaction, with an audit entry.
     Learners keep everything they did after the incident.
   - **Full switch:** point `DATABASE_URL` and `MIGRATE_DATABASE_URL` on Render at the restored
     branch (or restore the main branch in place in Neon), then redeploy. Everything written
     after the restore point is lost. Tell affected learners. Offline queues re-sync
     safely, because event ids make uploads idempotent.
5. If Neon itself is unavailable or the account is lost, use the latest off-site backup
   (DATABASE_BACKUP.md, "Restore from an off-site backup").

## Service worker

A release with a bumped `VERSION` in `public/sw.js` replaces the old caches. In an emergency,
ship a `sw.js` whose `install` calls `self.skipWaiting()` and whose `activate` deletes every
cache and calls `self.registration.unregister()`. Bump `VERSION` and deploy. Learners receive
it on their next visit, because `sw.js` is never cached (`Cache-Control: no-cache`).

## Configuration rollback

Render keeps environment changes per deploy. Restore the previous values in the dashboard
and redeploy. The start-up check refuses a fatal configuration, so a bad secret shows up as a
failed deploy, not as a broken site.
