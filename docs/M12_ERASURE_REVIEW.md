# M12 — Participant erasure: privacy review

**Date:** 2026-11-12. **Scope:** what happens to a pilot participant's data when their code is
erased (withdrawal or end of retention), surface by surface.

**Verdict:**

- **Erased:** in the live application database.
- **Re-erased by procedure:** in any restored database, which can't serve traffic until the
  signed erasure ledger has been applied.
- **Not erased by the app:** exported files, backups held elsewhere, feedback text and the
  paper key. These need the checklist below.

Don't describe erasure as complete to a participant until every step of the checklist is done.

No real participant data exists: every check used synthetic `TEST…` codes on local databases.

## Surfaces

| Surface                                                                                         | What erasure does                                                                                                                                                                                                              | Verified by                                                                                        | Status                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Samples** (`HandwritingSample`): strokes, device facts, verdict, observations, legacy `notes` | Deletes every row for the code, including pre-M12 rows matched by code only                                                                                                                                                    | `handwriting-lab.test.ts`: erasure, legacy rows, other participants untouched, race with recording | **Erased**                                                                                      |
| **Sample audit entries** (`AuditLog`, `handwriting.sample.record`)                              | Keeps the action and time; replaces `before`/`after` (code, character) with a redaction marker                                                                                                                                 | `handwriting-lab.test.ts`; backup drill section 4                                                  | **Redacted**                                                                                    |
| **Consent** (`PilotConsent`)                                                                    | Revoked (timestamp). Version and signing time are kept as the record that consent was given and withdrawn                                                                                                                      | `handwriting-lab.test.ts`                                                                          | **Kept by design** (no handwriting; pseudonymous)                                               |
| **Participant** (`PilotParticipant`)                                                            | Kept as a tombstone: code, status WITHDRAWN or RETENTION_ENDED, `erasedAt`. Blocks recording and re-consent for good                                                                                                           | `handwriting-lab.test.ts`; e2e                                                                     | **Kept by design**                                                                              |
| **Erasure and consent audit entries**                                                           | Keep the code and counts (no handwriting)                                                                                                                                                                                      | `handwriting-lab.test.ts`                                                                          | **Kept by design**; pruned with all audit entries by `ops:prune` once a retention period is set |
| **Analysis and lab views**                                                                      | Recomputed from the remaining samples, so erased samples drop out immediately                                                                                                                                                  | `handwriting-lab.test.ts` ("removes erased samples from the analysis")                             | **Erased**                                                                                      |
| **JSON export** (`/api/admin/handwriting/samples`)                                              | Served live from the database (`no-store`), so new exports exclude erased samples                                                                                                                                              | Same query as the analysis                                                                         | **Erased for new exports**                                                                      |
| **Exported files already downloaded**                                                           | Out of the app's reach                                                                                                                                                                                                         | —                                                                                                  | **Manual**: delete every copy (checklist)                                                       |
| **Feedback** (`Feedback`)                                                                       | **Not erased.** Feedback isn't linked to participants and is free text. Erasure only **counts** entries whose text contains the code, which misses entries that identify someone without the code and can match unrelated text | `handwriting-lab.test.ts` (counted, kept)                                                          | **Not erased: keep pilot feedback on paper** (below)                                            |
| **Application logs and error reports**                                                          | Messages carry no participant codes or strokes; URL credentials and long tokens are redacted (`lib/monitoring`)                                                                                                                | Code review                                                                                        | **Nothing stored**                                                                              |
| **Database backups** (local files, off-site copies)                                             | Backups taken before the erasure still contain the samples                                                                                                                                                                     | Backup drill section 4: restoring an older backup **brings the samples back**                      | **Manual**: expire or purge (checklist)                                                         |
| **Restored databases**                                                                          | Every restore is **gated**: readiness returns 503 until the signed erasure ledger is applied, which re-erases every listed code                                                                                                | Backup drill section 4; `handwriting-lab.test.ts` ("erasure ledger and restore gate")              | **Re-erased before serving**, as long as the ledger (or a rebuild of it) exists                 |
| **Paper key and signed form**                                                                   | Out of the app                                                                                                                                                                                                                 | —                                                                                                  | **Manual**: per protocol section 8                                                              |

## Feedback: recommendation for the pilot

The app can't erase feedback reliably, so **for the exploratory pilot, collect participant
feedback on paper only** (kept with the paper key and destroyed with it), and don't enter it in
Admin → Feedback. The count that erasure reports is a safety net for mistakes, **not an
erasure**.

Moving feedback into the app needs a participant-linked model: feedback rows tied to the
participant record and deleted with it, and no free text that names people. That model isn't
built.

## The erasure ledger

**What it is.** A file listing every erased code with its reason and date, and no handwriting. A
backup taken before an erasure still holds the erased samples. The ledger is what removes them
again after a restore.

**Integrity** (`src/features/handwriting/erasure-ledger.ts`, D-062):

- **Canonical:** entries are sorted, in a fixed field order, and duplicates are rejected
  (including case variants).
- **Complete:** a declared `count` must match the entries, so an incomplete or truncated
  ledger is refused.
- **Uncorrupted:** an `entriesSha256` checksum catches corruption.
- **Untampered:** an HMAC-SHA256 signature, keyed with **`ERASURE_LEDGER_KEY`**, catches
  unauthorised changes. That includes removing an entry and recomputing the checksum.
- **Verified first:** every check runs before anything is written. Applying is one
  transaction, so a bad ledger changes nothing and the gate stays pending.

**The key.** Generate it once, for example `openssl rand -base64 48`.

- Keep it in your password manager, with a second copy alongside the paper key.
- It never goes in the repository, `.env` files committed anywhere, Render or GitHub. The app
  doesn't need it; only the CLI does.
- **Rotation:**
  1. Verify the current ledger with the old key.
  2. Move the file aside and archive it.
  3. Export a fresh ledger from the live database with the new key. The live tombstones are
     complete.

**Protection against loss and accidental change:**

- **Merging:** exporting over an existing ledger first verifies it, then merges, so a ledger
  never shrinks. The previous file is kept as `<file>.<timestamp>.bak`.
- **Location:** the tool refuses to write a ledger inside the public repository, except under
  the git-ignored `.local/` or `backups/`.
- **Copies:** keep at least two copies, for example the password manager's secure notes and an
  encrypted file next to the paper key. Re-export after every erasure.
- **Backups:** every backup taken after an erasure also contains the tombstones, so the ledger
  can be rebuilt from it (below).

**Commands** (all need `ERASURE_LEDGER_KEY`):

```bash
npm run handwriting:erasures -- --export <file>                      # after every erasure
npm run handwriting:erasures -- --verify <file>
npm run handwriting:erasures -- --status --target <restored url>     # exit 3 while gated
npm run handwriting:erasures -- --apply <file> --target <restored url>
npm run db:restore -- --in <backup> --target <url> --erasure-ledger <file>   # one step
```

## Restore procedure (every supported restore)

`db:restore` always writes a pending `ErasureLedgerGate` row in the same transaction as the
restored data. `/api/health` returns 503 with `erasureGate: "pending"` until the ledger is
applied. Deploys wait for `/api/health`, so a gated database can't take traffic.

1. Restore with the ledger in one step (`--erasure-ledger <file>`). The ledger is verified
   before anything is restored, and applied right after the commit. Or restore, then run
   `--apply`.
2. Confirm with `npm run handwriting:erasures -- --status --target <url>` (no pending gate) and
   `npm run db:verify`, which reports the gate.
3. Only then switch the app to the restored database.

The off-site restore verification (`backup.yml`) restores into a throwaway database that never
serves traffic, so its gate is left pending and the database is discarded.

A backup older than the gate migration has no gate table. `db:restore` refuses it unless
`--pre-gate-backup` is passed. In that case, run `prisma migrate deploy` and then `--apply`
before serving.

## If the ledger is unavailable

Work down this list, stopping at the first step that produces a ledger that verifies. Merge
several sources if you have them: exports merge, and applying the same ledger twice is
harmless.

1. **Other copies:** the second stored copy, or a `<file>.<timestamp>.bak` beside it.
2. **The live database**, if it still exists: `--export <new file>` rebuilds the full ledger
   from its tombstones.
3. **The newest backup taken after the latest erasure:**
   `--export <new file> --from-backup <backup.ndjson.gz>`. Combine several backups to cover
   every erasure.
4. **The key is lost but a ledger file exists:** you can't verify it. Treat it as unavailable
   and rebuild from 2 or 3 with a new key.
5. **None of the above:** use the paper record of withdrawals.
   1. In the restored database, before it serves traffic, erase each withdrawn code in the lab
      as a Super Admin. Erasure is idempotent and blocks the code.
   2. Record the recovery and clear the gate:
      `npm run handwriting:erasures -- --clear-without-ledger --target <url> --reason "<what was done>" --confirm "erased data may return"`.
      This is audited (`handwriting.erasure-ledger.cleared-without-ledger`).
   3. Note in PROGRESS.md that erasure after that backup relied on the paper record (with no
      personal detail).

## Erasure checklist (collector and owner)

1. Erase the code in the lab (Super Admin). Note the counts it reports.
2. If it reports feedback entries mentioning the code, review them in Admin → Feedback.
   Pilot feedback should be on paper, so this is a check for mistakes.
3. Export the erasure ledger (`--export`) and store both copies.
4. Delete every exported file (`?strokes=1` downloads) that contains the participant.
5. Backups: either wait until every backup taken before the erasure has expired, which
   completes the erasure there too, or purge those backups. Until then, every restore is
   gated and needs the ledger.
6. Destroy the paper key entry, the signed form and any paper feedback when the protocol says
   so.
7. Only then tell the participant their data is deleted, within the promised number of days.
   **The promised window must be at least the backup retention period**, or step 5 must purge.

## Known limits

- **Backup expiry** isn't automated: retention is the owner's decision (DATABASE_BACKUP.md,
  "Retention policy").
- **Losing both the ledger and every later backup:** if that happens and the live database is
  gone, only the paper record can recover erasures (step 5 above).
- **Feedback** isn't erased by the app. The count is a safety net, and the pilot uses paper.
- **Live database:** the gate protects restored databases, not the live one. Erasure there is
  immediate and doesn't need the ledger.
