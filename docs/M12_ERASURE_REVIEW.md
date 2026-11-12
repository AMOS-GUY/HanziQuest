# M12 — Participant erasure: privacy review

**Date:** 2026-11-12. **Scope:** what happens to a pilot participant's data when their code is
erased (withdrawal or end of retention), and how restores and the erasure ledger are protected.
No real participant data exists: every check used synthetic `TEST…` codes on local databases.

## Verdict, by place where data lives

**Participant erasure is not complete across all copies, and must not be described as such.**
Each place has its own status:

| Where                                                                              | Status after an erasure                                                                              | What completes it                                                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Primary database** (the live app database)                                       | **Erased immediately.** Samples deleted, their audit content redacted, consent revoked, code blocked | Nothing more. Verified by tests                                                                                     |
| **Database backups** (provider snapshots, off-site files)                          | **Still contain the samples** until each backup older than the erasure expires or is purged          | Backup retention or purge (owner). A deletion window promised to participants must be at least the retention period |
| **Restored databases**                                                             | **Blocked** (readiness 503) until the signed erasure ledger is applied, which erases the codes again | The ledger and its key (below). Verified by the backup drill                                                        |
| **Erasure ledger**                                                                 | Holds codes, reasons and dates of erasures, never handwriting. Signed                                | Protected by the key and by copies. It is the safeguard, not personal content                                       |
| **Feedback records** (Admin → Feedback)                                            | **Not erased.** Erasure only counts entries whose text contains the code                             | Pilot feedback stays on paper (D-063)                                                                               |
| **Exported files** (`?strokes=1` downloads)                                        | **Not erased by the app**                                                                            | Delete every copy by hand                                                                                           |
| **Separately held paper records** (code-to-name key, signed forms, paper feedback) | **Outside the app**                                                                                  | Destroyed per protocol section 8                                                                                    |

## Primary database: surfaces

| Surface                                                                                         | What erasure does                                                                                                           | Verified by                                                                                        | Status                                                                                          |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Samples** (`HandwritingSample`): strokes, device facts, verdict, observations, legacy `notes` | Deletes every row for the code, including pre-M12 rows matched by code only                                                 | `handwriting-lab.test.ts`: erasure, legacy rows, other participants untouched, race with recording | **Erased**                                                                                      |
| **Sample audit entries** (`handwriting.sample.record`)                                          | Keeps the action and time; replaces `before`/`after` (code, character) with a redaction marker                              | `handwriting-lab.test.ts`; backup drill                                                            | **Redacted**                                                                                    |
| **Consent** (`PilotConsent`)                                                                    | Revoked (timestamp). Version and signing time are kept as the record of consent and withdrawal                              | `handwriting-lab.test.ts`                                                                          | **Kept by design** (no handwriting; pseudonymous)                                               |
| **Participant** (`PilotParticipant`)                                                            | Kept as a tombstone: code, status, `erasedAt`. Blocks recording and re-consent for good. The source for rebuilding a ledger | `handwriting-lab.test.ts`; e2e                                                                     | **Kept by design**                                                                              |
| **Erasure, re-apply and ledger audit entries**                                                  | Code and counts, no handwriting, never the key                                                                              | `handwriting-lab.test.ts` ("never stores the signing key")                                         | **Kept by design**; pruned with all audit entries by `ops:prune` once a retention period is set |
| **Analysis, lab views, new exports**                                                            | Recomputed live, so erased samples drop out                                                                                 | `handwriting-lab.test.ts`                                                                          | **Erased**                                                                                      |
| **Logs and error reports**                                                                      | Carry no participant codes or strokes; URL credentials and long tokens are redacted                                         | Code review                                                                                        | **Nothing stored**                                                                              |

## Feedback

The app **does not erase feedback**. Feedback isn't linked to participants and is free text, so:

- a pattern match would miss entries that identify someone without using the code
- a pattern match could delete unrelated learner text that happens to contain the code

Erasure reports how many entries contain the code. **That count is a safety net, not
erasure.** For the exploratory pilot, **collect participant feedback on paper only**, keep it
with the paper key and destroy it with the key. In-app pilot feedback first needs a
participant-linked model, deleted with the participant; that model isn't built.

## The erasure ledger

A file listing every erased code with its reason and date. It contains no handwriting. A
restored backup can contain samples that were erased after the backup was taken; applying the
ledger erases them again.

**Integrity** (`src/features/handwriting/erasure-ledger.ts`, D-062). Each check runs before
anything is written:

| Check                                        | Catches                                                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Strict structure                             | Corrupted or truncated files, unknown fields, malformed codes or dates                                                        |
| Declared `count`                             | Incomplete ledgers: missing or extra entries                                                                                  |
| No duplicate codes (including case variants) | Duplicated entries                                                                                                            |
| `entriesSha256`                              | Any change to an entry                                                                                                        |
| HMAC-SHA256 with `ERASURE_LEDGER_KEY`        | Unauthorised changes, including removing an entry and recomputing the count and checksum, and ledgers signed with another key |

There is **no unsigned mode**. Without the key nothing verifies, so nothing is applied, and no
command clears a restore gate without a signed ledger.

**Applying** happens in one transaction: every code is erased again, then the restore gate is
cleared. An interruption or failure rolls it all back and the gate stays pending. Re-applying
is idempotent: it keeps the first erasure date and writes no per-code audit entry when nothing
changes.

**Exports never shrink or overwrite history** (`scripts/lib/erasure-ledger-file.ts`):

- An existing ledger must verify before anything is written. A corrupted, tampered or
  wrong-key file is left untouched.
- New entries are merged in. Every recorded erasure stays, and a code keeps its earliest date.
- The previous file is kept as `<file>.<timestamp>.bak`. The new file is written to a
  temporary file and then renamed.
- The tool refuses to write a ledger inside the public repository, except under the
  git-ignored `.local/` or `backups/`.

## Signing key lifecycle (`ERASURE_LEDGER_KEY`)

| Stage                                                  | Rule                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What it is**                                         | A random secret of at least 32 characters, used only to sign and verify ledgers. The app server never needs it, only the `handwriting:erasures` and `db:restore --erasure-ledger` CLIs                                                                                                                                   |
| **Where it lives**                                     | **The owner's password manager** (primary), as its own entry                                                                                                                                                                                                                                                             |
| **Provisioning**                                       | Generate once on the owner's machine: `openssl rand -base64 48`. Store it in the password manager immediately                                                                                                                                                                                                            |
| **Use**                                                | Supplied in the process environment only for the command that needs it. For example, in bash: `read -rs ERASURE_LEDGER_KEY && export ERASURE_LEDGER_KEY`, then run the command and close the shell. Not saved in `.env` files                                                                                            |
| **Never**                                              | In Git or any committed file (`.env.example` has an empty placeholder only); in the database or its backups (tested: audit entries and gate rows never contain it); on Render, Neon or GitHub (no secret, variable or workflow uses it); in logs or tool output (tested: no output contains it); in public documentation |
| **Backup, independent of the database and the ledger** | A second copy on paper, sealed and kept in a **different place from the ledger copies and the paper key**. Losing the ledger storage then doesn't lose the key, and someone who can reach the ledger copies can't also re-sign them                                                                                      |
| **Recovery**                                           | From the password manager, or from the sealed paper copy                                                                                                                                                                                                                                                                 |
| **Loss of every copy**                                 | Existing ledgers can no longer be verified. Generate a new key and rebuild the ledger from the live database or later backups (below). Archive the old ledger files; don't apply them                                                                                                                                    |
| **Rotation**                                           | Verify the current ledger with the old key. Generate a new key. Rebuild from the live database with `--export` to a **new** file (live tombstones are complete). Verify it. Archive the old file and update both key copies                                                                                              |
| **Suspected compromise**                               | Rotate. Then compare the live database's tombstones (the authoritative list) with the ledger, because a compromised key could have signed a shortened ledger. Rebuild from the live database                                                                                                                             |

## Restores (every supported restore)

1. **The gate comes first.** `db:restore` commits a pending `ErasureLedgerGate` row on its own,
   before it reads any data. From then on `/api/health` returns 503 (`erasureGate: "pending"`).
   Deploys and monitors wait for `/api/health`, so the database can't take traffic.
2. **One-step restore:**
   `npm run db:restore -- --in <backup> --target <url> --erasure-ledger <ledger>`. The ledger is
   read and verified before any data is loaded, then applied right after the data commits.
3. **Or restore first,** then
   `npm run handwriting:erasures -- --apply <ledger> --target <url>`.
4. **Confirm:** `npm run handwriting:erasures -- --status --target <url>` exits 0, and
   `npm run db:verify` reports "erasure gate: none pending".
5. **Only then** switch the app over.

**Failure cases** (backup drill section 4, and `handwriting-lab.test.ts`). Readiness stays
blocked in every one until a successful recovery:

| Failure                                                     | Result                                      | Recovery (tested)                                                      |
| ----------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------- |
| Invalid signature, or signed with another key               | Refused. Nothing restored or changed        | Apply the genuine ledger                                               |
| Tampered entry                                              | Refused (checksum)                          | Same                                                                   |
| Missing ledger file                                         | Refused. Nothing restored                   | Find a copy, or rebuild (below)                                        |
| Missing signing key                                         | Refused. Nothing restored                   | Get the key from the password manager or the sealed copy               |
| Interrupted restore (the load fails part-way)               | Data rolled back, gate pending              | Re-run the restore into the same target; gate rows don't count as data |
| Interrupted ledger application (a failure after some codes) | Whole transaction rolled back, gate pending | Apply again                                                            |
| Repeated application                                        | No change, gate stays clear                 | —                                                                      |

A backup older than the gate migration has no gate table. `db:restore` refuses it unless
`--pre-gate-backup` is given. Then run `prisma migrate deploy` and `--apply` before serving.

The off-site restore verification (`backup.yml`) restores into a disposable `hq_restore_verify`
database on the runner, which never serves traffic and is thrown away. Its gate may stay
pending.

## Rebuilding a lost ledger

Every backup taken **after** an erasure contains that code's tombstone with its original
erasure date. Rebuilding therefore preserves every historical erasure up to that backup. The
drill proves it with two erasures at different times: the rebuild from the latest backup
matches the live ledger exactly, dates included.

Work down this list. Sources can be combined in one export, and exports merge:

1. **Another copy**, or a `<file>.<timestamp>.bak` beside it. Verify it with `--verify`.
2. **The live database:** `--export <new file> --source <url>`. Its tombstones are the
   authoritative, complete list.
3. **The newest backup taken after the latest erasure:**
   `--export <new file> --from-backup <backup.ndjson.gz>`. Add `--from-backup` once per backup
   to cover every erasure.
4. **The paper record** of withdrawals, one line each, `CODE REASON YYYY-MM-DD`:
   `--export <new file> --from-codes <record.txt>`. The result is still a signed ledger.

**Assumptions and limits:**

- **Backups:** a backup only knows erasures made before it was taken. If the live database
  is gone and the latest erasures postdate every surviving backup and ledger copy, only the
  paper record can recover them (step 4). So export the ledger **after every erasure**.
- **Dates:** a rebuild takes the date recorded in the tombstone. A paper-record entry has day
  precision only.
- **Edited data:** a rebuild from a backup trusts that backup's contents. Backups are
  checksummed per table (`db:restore` refuses altered files), but a backup made from a
  database someone had edited would carry the edit.
- **Silent loss:** merging protects against accidental shrinkage, but a person with the key
  could still sign a shorter ledger on purpose. Compare with the live tombstones after any
  suspected compromise.

## Erasure checklist (collector and owner)

1. Erase the code in the lab (Super Admin). Note the counts it reports.
2. If it reports feedback entries containing the code, review them in Admin → Feedback.
   Pilot feedback should be on paper, so this is a check for mistakes.
3. Export the ledger (`--export`) and store the copies.
4. Delete every exported file (`?strokes=1`) that contains the participant.
5. **Backups:** wait until every backup older than the erasure has expired, or purge those
   backups. Until then every restore is gated and needs the ledger.
6. Destroy the paper key entry, the signed form and any paper feedback when the protocol says
   so.
7. Tell the participant their data is deleted only once steps 1–6 are done, within the promised
   window. That window must be at least the backup retention period, unless step 5 purges.
