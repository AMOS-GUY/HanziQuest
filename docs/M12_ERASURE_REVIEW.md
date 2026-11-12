# M12 — Participant erasure: privacy review

**Date:** 2026-11-12. **Scope:** what happens to a pilot participant's data when their code is
erased (withdrawal or end of retention), surface by surface. **Verdict: erasure is complete
inside the live application database, and recoverable after a restore with the erasure
ledger. It is not complete everywhere: exports, backups held elsewhere, feedback free text and
the paper key need the procedure below.** Don't describe erasure as complete to a participant
until each step of the checklist has been done.

No real participant data exists: every check used synthetic `TEST…` codes on local databases.

## Surfaces

| Surface                                                                                         | What erasure does                                                                                                                                           | Verified by                                                                                         | Status                                                                                          |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Samples** (`HandwritingSample`): strokes, device facts, verdict, observations, legacy `notes` | Deletes every row for the code, including pre-M12 rows matched by code only                                                                                 | `handwriting-lab.test.ts` (erasure, legacy rows, other participants untouched, race with recording) | **Erased**                                                                                      |
| **Sample audit entries** (`AuditLog`, `handwriting.sample.record`)                              | Keeps the action and time; replaces `before`/`after` (code, character) with a redaction marker                                                              | `handwriting-lab.test.ts`; backup drill section 4                                                   | **Redacted**                                                                                    |
| **Consent** (`PilotConsent`)                                                                    | Revoked (timestamp). Version and signing time kept as the record that consent was given and withdrawn                                                       | `handwriting-lab.test.ts`                                                                           | **Kept by design** (no handwriting; pseudonymous)                                               |
| **Participant** (`PilotParticipant`)                                                            | Kept as a tombstone: code, status WITHDRAWN/RETENTION_ENDED, `erasedAt`. Blocks recording and re-consent for ever                                           | `handwriting-lab.test.ts`; e2e                                                                      | **Kept by design**                                                                              |
| **Erasure and consent audit entries**                                                           | Keep the code and counts (no handwriting)                                                                                                                   | `handwriting-lab.test.ts`                                                                           | **Kept by design**; pruned with all audit entries by `ops:prune` once a retention period is set |
| **Analysis and lab views**                                                                      | Recomputed from the remaining samples, so erased samples drop out immediately                                                                               | `handwriting-lab.test.ts` ("removes erased samples from the analysis")                              | **Erased**                                                                                      |
| **JSON export** (`/api/admin/handwriting/samples`)                                              | Served live from the database (`no-store`), so new exports exclude erased samples                                                                           | Same query as the analysis                                                                          | **Erased for new exports**                                                                      |
| **Exported files already downloaded**                                                           | Out of the app's reach                                                                                                                                      | —                                                                                                   | **Manual**: delete every copy (checklist)                                                       |
| **Feedback** (`Feedback`)                                                                       | Not linked to codes; free text. Erasure never deletes it (a learner's unrelated text could contain "P01") but **reports how many entries mention the code** | `handwriting-lab.test.ts` (reported, kept)                                                          | **Manual review**                                                                               |
| **Application logs and error reports**                                                          | Messages carry no participant codes or strokes; URL credentials and long tokens are redacted (`lib/monitoring`)                                             | Code review                                                                                         | **Nothing stored**                                                                              |
| **Database backups** (local files, off-site copies)                                             | Backups taken before the erasure still contain the samples                                                                                                  | Backup drill section 4: restoring an older backup **brings the samples back**                       | **Manual**: expire or purge; see below                                                          |
| **Restored databases**                                                                          | `npm run handwriting:erasures -- --apply <ledger> --target <url>` re-erases every code in the ledger                                                        | Backup drill section 4: samples gone again, code blocked, idempotent                                | **Erased, if the ledger is applied**                                                            |
| **Paper key and signed form**                                                                   | Out of the app                                                                                                                                              | —                                                                                                   | **Manual**: per protocol section 8                                                              |

## The erasure ledger

- `npm run handwriting:erasures -- --export <file>` writes every erased code with its reason and
  date (no handwriting). The tool refuses to write it inside the repository except under the
  git-ignored `.local/` or `backups/`, because the repository is public.
- Export it **after every erasure**, and keep it with the paper key, outside the repository.
- After **any** restore, apply it to the restored database **before** it serves traffic:
  `npm run handwriting:erasures -- --apply <file> --target <restored url>`. Re-applying is
  idempotent and audited as the system (`handwriting.participant.erase-reapply`).

## Erasure checklist (collector and owner)

1. Erase the code in the lab (Super Admin). Note the counts it reports.
2. If it reports feedback entries mentioning the code, review them in Admin → Feedback and
   delete or edit them as appropriate.
3. Export the erasure ledger and store it with the paper key.
4. Delete every exported file (`?strokes=1` downloads) that contains the participant.
5. Backups: either wait until every backup taken before the erasure has expired (then the
   erasure is complete there too), or purge those backups. Until then, any restore must apply
   the ledger.
6. Destroy the paper key entry and signed form when the protocol says so.
7. Only then tell the participant their data is deleted, within the promised number of days.
   **The promised window must be at least the backup retention period**, or step 5 must purge.

## Not covered (known limits)

- Backup expiry isn't automated here: retention is the owner's decision (DATABASE_BACKUP.md,
  "Retention policy").
- The ledger is a file the owner keeps. If it's lost and an old backup is restored, erased
  samples come back. The restored database's own erasure audit entries are only as new as the
  backup.
- Feedback is reviewed by a person, not erased automatically.
