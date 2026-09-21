**SpiceSentry record storage and recovery**

The web app's primary database is Google Cloud Firestore in Firebase project **kvs-traders**, database **(default)**. The login recovery now accesses it through the authenticated Node API and the server's Firebase Admin credentials, verified against the existing database. Inspect records through the [Firebase Firestore console](https://console.firebase.google.com/project/kvs-traders/firestore/databases/-default-/data). See [login recovery and hosting requirements](login-recovery.md) for the current authentication path and validation; the following recovery-test results describe the earlier entry-persistence change.

| Location | Stored data | Purpose |
|---|---|---|
| Firestore `purchases` | One document per purchase: ID, branch, spice, quantity, unit price, total, date, load, mirror status | Primary purchase ledger |
| Firestore `sales` | One document per sale, including buyer and sale price | Primary sales ledger |
| Firestore `daily_summaries` | Branch/day purchase and sale totals | Derived daily totals |
| Firestore `users` and `config` | Current account records and administration settings | Existing identity/configuration model; earlier audit limitations still apply |
| Browser localStorage `spicesentry_pending_v1:<user>:<transaction>` | Complete submitted purchase/sale, ID, destination, pending sync stage and last error | Durable device queue for submissions not fully acknowledged |
| Browser localStorage `spice_entries`, `spice_sales`, `spice_shop_loads` | Cached screen data | Fast reopening; not an independent cloud backup |
| Google Sheets through Apps Script | Mirrored purchase/sale data | Reporting/integration copy |
| Optional MCP server's MongoDB database (default `spicesentry`) | `entries` and `dispatches` | Separate integration, not the web app's primary ledger |

The WhatsApp script reads purchases from `Sheet1` and sales from `Sales` in its [configured reporting spreadsheet](https://docs.google.com/spreadsheets/d/1H_4Br3r1RePxAahV4RixHzsmVjSHqhQuT4JG-mXhPe8/edit). The Apps Script handler that accepts the web app's mirror writes is not present in this repository; its exact deployed configuration and duplicate-handling contract were not inspected.

**Why a submitted entry disappeared**

Previously the app displayed success, navigated away, and started the remote write later. Its full localStorage snapshot waited five seconds. Firestore used an in-memory cache. A rejected or unfinished write followed by closing/reloading could therefore leave no durable entry to restore. Returning to the foreground had no immediate refresh handler. Four isolated browser tests reproduced the failure for purchases/sales with pending/rejected writes before the five-second snapshot.

**What changed for new purchases and sales**

1. Validate positive finite quantities/prices and assign an opaque UUID once.
2. Synchronously persist the complete operation in the current account's device queue before acknowledging it or closing the form. A storage failure keeps the form and displays an error.
3. Immediately include queued records in the UI and restore them on reopening. Pending records do not expire under the old six-hour merge rule.
4. Create the Firestore record and increment its daily summary in one transaction. If the same ID already exists, replay does not overwrite it or increment again. New purchase/sale summaries use the Asia/Kolkata business date.
5. Persist each completed stage locally: database saved, spreadsheet accepted, mirror status recorded. Retrying the final status update does not resend an already acknowledged mirror request.
6. Keep failures visible with a Retry action. Editing/deleting a locally queued record waits for sync so replay cannot undo the correction.
7. Write a usable local snapshot before removing the completed queue item.

Queue replay runs on mount, return to a visible app, browser pageshow/back restoration, reconnection, and the visible-app refresh interval. Overlapping queue drains are coalesced; browser Web Locks coordinate the same operation across tabs where supported. Firestore retries use the original ID. Firebase provides the [transaction guarantees](https://firebase.google.com/docs/firestore/manage-data/transactions) used for the record/summary commit.

The device queue survives normal reload/reopening on the same browser origin and account. Clearing site data or using a different device does not carry unsynced local records across. An entry saying **saved on this device** has not yet been confirmed in Firestore. The queue cannot recover a record that was already lost before this change and is absent from both cloud storage and local caches.

This change covers submission through Record Purchase and Record Sale. Existing transfer/dispatch, edit/delete, authentication, historical calculations, report completeness, and other issues in the original audit still require their own repairs. The fix does not change deployed database permissions, rotate service credentials, or migrate historical summary totals. Primary database retries are idempotent; end-to-end exactly-once Google Sheets delivery still depends on the unavailable handler deduplicating the stable transaction ID, particularly when its response is lost after accepting a request.

**Optimization implemented**

- Pause periodic inventory refresh while hidden/offline and resume promptly when visible. This follows the visibility-based background-work pattern described by the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
- Coalesce overlapping inventory refreshes and queue drains.
- Persist small submission records immediately while retaining debounced full inventory snapshots; flush snapshots on leaving.
- Update the dashboard clock at minute boundaries, matching its displayed precision, and stop its timer when hidden. Stock cards no longer rerender every second solely for a clock with no seconds display.
- Preserve the selected branch across reopening and pass it into the purchase form.

**Next optimization priorities**

1. Replace repeated full transaction reads with complete stock-balance projections and scoped realtime/delta reads; paginate history separately. Do not reduce the existing history limit as an optimization, because old unsold stock must remain represented.
2. Move History/report screens into lazy-loaded modules. PDF tools and the control panel already load lazily; the main application bundle still exceeds Vite's warning threshold. The reliability fix adds transaction support and is not a bundle-size reduction.
3. Use one report/valuation calculation module and a single branch/spice aggregation pass instead of repeated filters across screens.
4. Measure visible task latency, document reads per active session, sync lag/failure rate, and memory usage before choosing further caching or rendering changes.

**Verification**

`npm test` passes all nine durable-queue, retry, merge, storage-failure, and idempotency regressions. Seven isolated browser scenarios pass: purchase/sale reloads with pending or rejected writes, acknowledged save followed by reload, retry after rejection, and retry after a lost database acknowledgement. The recovery checks verify one primary record and one summary increment. The return-to-app recovery test dispatches a browser `pageshow` event; physical mobile operating-system background/termination behavior was not tested.

Browser regressions use an isolated copy and synthetic Firebase/Sheets so they never alter production records. Sync banners were checked at 320, 390, and 1440 pixels; branch restoration and negative-input rejection were also checked. Production build and scoped lint for the new modules pass. Repository-wide lint still reports 33 errors and 3 warnings in existing code. The production build's main JavaScript bundle is 633.74 kB (182.22 kB gzip), still above the chunk-size warning threshold.

These changes are local and have not been deployed. Real authenticated cloud saving and deployed Apps Script behavior require verification in the intended deployment after the independent permissions issue is resolved.
