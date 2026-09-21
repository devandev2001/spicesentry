# Ledger reset, 21 September 2026

The user explicitly authorized clearing all real purchases, sales, and daily summaries across every branch. Existing accounts and PINs were retained. Kallar was removed from branch selectors, voice input, API validation, seed configuration, the optional MCP catalogue, the reporting-script catalogue, and live `config/shops`.

## Verified operations

Maintenance began at 12:33:33 UTC. At 12:36:03 UTC the `kvs-traders` Firestore database `(default)` was verified to contain zero purchases, zero sales, and zero daily summaries after deleting 139, 7, and 21 documents respectively. All five accounts were retained; active branch configuration contains 20 Acre and Anachal.

The reporting workbook `spices` contains a separate copy of transactions. Its `Sheet1` purchase table and `Sales` sale table were backed up with their cell values, formatting, and validation. 242 purchase rows and 8 sale rows were cleared. Two native readbacks verified empty transaction cells, intact headers, and unchanged formatting/validation; the deployed Apps Script also returned zero purchases and zero sales. Writes reopened at 12:42:11 UTC after a final Firestore zero-count check. The `Loads` tab is configuration and is outside the confirmed transaction deletion scope.

## Backup and recovery

Private backups live outside the repository under `~/.local/share/spicesentry/backups/2026-09-21T12-33-33-133Z/`. The directory is mode 700 and files are mode 600. `records.json` contains Firestore document IDs and typed REST Value fields, including the previous configuration; `sheets.json` contains native Google Sheets cell data. `manifest.json`, `reset-control.json`, and operation receipts record counts, generation, and checksums. No record rows, credentials, or backups are committed or indexed by Graphify.

Restoration would be a separate, explicitly authorized operation. Verify backup checksums and the destination project first; preserve Firestore Value types during restore. Do not run the old seed or spreadsheet backfill commands as a restoration shortcut: they can replace accounts/configuration, and backfill is intentionally disabled after a reset.

## Reset safeguards

The private `_system/ledger` document stores a generation and maintenance status. Every data request checks the generation. Every Firestore business/config write checks it again inside the same database transaction, so an in-flight write conflicts with a concurrent reset instead of recreating old records. The legacy backfill also checks transactionally.

Authentication returns the current generation before inventory mounts. Stale local caches and queues are removed; new caches and pending operations are scoped by both account and ledger generation. Inactive tabs cannot enqueue, and pagehide/visibility cache writes stop after a generation change. A second tab adopting a reset triggers a reload without restoring the old screen contents.

The external Apps Script mirror handler is not in this repository and does not enforce ledger generations. Updated clients check maintenance before calling it. This reset holds maintenance while allowing earlier executions to drain, then clears and reads back the reporting tables. Google's current [Apps Script execution limit](https://developers.google.com/apps-script/guides/services/quotas) is six minutes per execution. This procedure does not revoke old independently deployed clients or direct callers of that endpoint; handler authentication, deduplication, and reset enforcement remain separate integration work.

## Validation

79 unit/API tests and 15 isolated browser cases passed, including submitted purchase/sale recovery, lost acknowledgements, rejected writes, Kallar removal, cache invalidation, primary-saved mirror retries, post-reset saves, and an actual two-tab pagehide race. Production build and scoped ESLint passed. Browser cases intercept API and external writes; they do not create real business records. Final live verification was read-only: the existing owner login and session reload succeeded, both purchase/sale history screens were empty, only 20 Acre and Anachal were offered, and no browser exceptions or business writes occurred.

Repository-wide lint retains 25 pre-existing errors and two warnings. The dependency audit retains 30 findings (3 low, 15 moderate, 10 high, 2 critical), with prior reachability notes in `docs/login-recovery.md`. This change does not claim those unrelated issues or public Node hosting are resolved.
