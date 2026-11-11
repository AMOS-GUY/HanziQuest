# Database backup and restore

**Status:**

- The tools and workflows are tested locally and in CI on disposable databases.
- **No production backup exists yet,** because there is no production database.
- The production drills below are owner actions after the first deployment.

## Layers

| Layer                      | What                                                                                               | Retention                                           | Protects against                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 1. Provider PITR (primary) | Neon Launch history, restorable to any second                                                      | 7 days (set the project's history window to 7 days) | bad deploys, bad scripts, accidental deletes              |
| 2. Pre-deploy backup       | deploy.yml: a logical backup taken just before every production deploy, `age`-encrypted            | 30 days (GitHub artifact)                           | a migration that damages data, even after the PITR window |
| 3. Off-site weekly backup  | backup.yml: a logical backup, restored and verified on a disposable database, then `age`-encrypted | 30 days (GitHub artifact)                           | provider incident, account loss, PITR misconfiguration    |
| 4. Curriculum source       | `content/*.json` in git; imports are idempotent                                                    | git history                                         | content loss                                              |
| 5. Configuration           | environment variables in the owner's password manager                                              | on change                                           | lost settings                                             |

Backups contain personal data: emails, password hashes, handwriting, IPs in audit entries.

- Only the encrypted file ever leaves the runner.
- The private key (`hanziquest-backup.key`) stays with the owner, offline, in two places.
  **Without it the off-site backups can't be read.**
- Decrypted copies are deleted after use.
- Keeping longer than 30 days, or in other storage such as Cloudflare R2 or Backblaze B2, is the
  owner's decision. It must match the retention periods in LEGAL_REVIEW.md.

## Tools

| Command                                                           | What it does                                                                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:backup -- --source <direct URL> --out file.ndjson.gz` | A consistent snapshot (one REPEATABLE READ, READ ONLY transaction). Gzip NDJSON with a header listing migrations, row counts and per-table content checksums. Read-only on the source. |
| `npm run db:restore -- --in file.ndjson.gz --target <url>`        | Restores into an **empty** database with **the same migrations** applied. Refuses a non-empty target. Foreign keys stay enforced.                                                      |
| `npm run db:verify -- --source <url> --target <url>`              | Compares row counts and checksums with the source, re-checks every FK, and compares app-level reads (progress, lesson states) for 5 learners.                                          |
| `npm run db:verify -- --backup file.ndjson.gz --target <url>`     | Checks the target against the backup alone: migrations, row counts, checksums, FKs and lesson load. Use it when the source has moved on (production).                                  |

`pg_dump --format=custom` also works, as an independent second format.

## Automation

- **Pre-deploy:** automatic in deploy.yml, after the owner approves the deploy.
- **Weekly off-site:** backup.yml.
  1. Run it manually once (Actions → Off-site backup → Run workflow).
  2. Download the artifact and decrypt it on your machine (below).
  3. Then uncomment the `schedule:` block (Mondays 03:17 UTC).
- **Failure alerts:** GitHub emails the owner when a workflow fails. Check the run list monthly.

## Restore verification (every off-site run)

backup.yml restores each backup into a fresh PostgreSQL 17 on the runner, at exactly the
migrations the backup was taken at. It then runs `db:verify --backup` and keeps the
encrypted file only if verification passes.

## Drills (owner, after the first deployment)

**Quarterly, and before inviting the first testers:**

1. **PITR restore**, without touching production:
   - In the Neon console → Branches → create a branch from `main` at a past time.
   - Copy the branch's direct URL. Then run:
     ```bash
     npm run db:verify -- --source "<branch direct URL>" --target "<branch direct URL>"
     DATABASE_URL="<branch pooled URL>" AUTH_URL=http://localhost:3300 AUTH_TRUST_HOST=true npx next start -p 3300
     npm run smoke -- http://localhost:3300
     ```
   - Record the restore point, how long it took and the result in the drill log below.
   - Delete the branch, which is billed per branch-month.
2. **Off-site restore.** Download the latest backup.yml artifact, then:
   ```bash
   age -d -i hanziquest-backup.key -o backup.ndjson.gz hanziquest-<date>.ndjson.gz.age
   createdb hanziquest_drill        # or any empty disposable database
   DATABASE_URL="<drill URL>" npx prisma migrate deploy   # at the release the backup came from
   npm run db:restore -- --in backup.ndjson.gz --target "<drill URL>"
   npm run db:verify -- --backup backup.ndjson.gz --target "<drill URL>"
   ```
   Then delete `backup.ndjson.gz` and the drill database.

## Restore from an off-site backup (provider lost)

1. Create a new PostgreSQL 15+ database (any provider) and note its direct URL.
2. Decrypt the newest backup (as above).
3. Apply the migrations of the release the backup came from: check out that commit, and run
   `DATABASE_URL=<new> npx prisma migrate deploy`.
4. Run `db:restore`, then `db:verify --backup`.
5. Point the app at the new database (`DATABASE_URL`, `MIGRATE_DATABASE_URL`) and redeploy the
   matching release. Then run the smoke test.
6. Anything after the backup's time is lost. Tell affected learners (PRODUCTION_OPERATIONS.md).

## Retention policy (proposal for the owner)

| Data                                    | Keep                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| PITR history                            | 7 days                                                                       |
| Pre-deploy and weekly encrypted backups | 30 days (artifact expiry deletes them automatically)                         |
| Decrypted copies                        | Deleted the same day                                                         |
| Audit log, sync events                  | Pruned by `ops:prune` per LEGAL_REVIEW.md periods (PRODUCTION_OPERATIONS.md) |

## Drill log

**M10 (2026-11-11), local disposable database, development data:**

| Step                      | Result                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db:backup`               | 1.24 MB gzip, with per-table checksums                                                                                                           |
| Migrate an empty database | 11 migrations                                                                                                                                    |
| `db:restore`              | committed                                                                                                                                        |
| `db:verify --source`      | every table matched; 70 FKs checked, 0 orphaned rows; app reads for 5 learners matched; lesson content loads                                     |
| `db:verify --backup`      | every table matched the header                                                                                                                   |
| Tamper check              | after one character reading was changed in the restored database, `db:verify --backup` reported `Character … vs target` and exited with status 1 |

The disposable database was dropped and the backup file deleted.

**M9 (2026-11-11), local:** 928 KB backup restored into a fresh migrated database. Every
table matched, 69 FKs checked with 0 orphans, and app reads for 5 learners matched.

**M5 (2026-11-10), local:**

- About 3,500 rows (389 KB gzip); the restore took 2.6 s.
- Every table identical; 68 FKs, 0 orphans.
- Smoke test 8/8 on the restored database.
- A second restore into a non-empty database was refused.

**CI:** the `verify` job runs backup → restore → verify on every push.

**Production:** none yet.
