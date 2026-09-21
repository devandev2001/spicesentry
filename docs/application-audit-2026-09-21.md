**SpiceSentry / KVS Spices — application audit, 21 September 2026**

The app has a useful small-business workflow and a recognizable visual identity. Its next milestone should be trustworthy stock and transaction records: authentication, durable saving, inventory calculations, and configuration need attention before additional features or a visual redesign. Several defects can produce convincing success messages alongside incorrect or unsaved business data.

This report distinguishes **Live** observations from the original localhost application, **Isolated** browser tests using synthetic data, **Code** findings established by source inspection or local calculations, and **Proposal** recommendations. The application baseline was clean `main`, commit `ca34818`. File links refer to the reviewed checkout; line numbers may move after changes.

**How the application works**

| Layer / workflow | Current behavior |
|---|---|
| Frontend | React/Vite application with a mobile bottom navigation and desktop sidebar. Most behavior, calculations, screens, and exports live in the 4,572-line `src/App.jsx`. |
| Identity | The login screen loads users, lets someone select a name, and checks a four-digit PIN against client-fetched hashes. A localStorage session controls owner/staff UI. Device biometric enrollment is also stored locally. |
| Daily entry | Buy records branch, spice, kilograms, and purchase price. Sell records quantity, selling price, and optional buyer. Both immediately update local state and navigate to Home before deferred remote persistence. |
| Inventory | Stock is grouped by branch, spice, and active load. Dashboard combines purchases and sales to display remaining quantity, price measures, value, and profit. Owners can transfer stock or dispatch/close a load. |
| Storage / synchronization | LocalStorage caches the screen data; Firestore stores purchases, sales, summaries, users, and configuration. Google Apps Script/Sheets is a second write destination. Refresh runs every 15 seconds. Firestore uses memory-only cache. |
| Owner tools | Daily summaries; History with editing/deletion; HTML, PDF, and CSV reports; user/shop/spice/settings administration. |
| Additional integrations | Apps Script generates WhatsApp reports/alerts. The MCP server uses a separate MongoDB store; it is not automatically the app's Firestore/Sheets ledger. |

The warm spice-oriented palette, direct Buy/Sell navigation, numeric keyboards, quantity shortcuts, previews, export options, and safe-area treatment are worth retaining. The central product opportunity is to make those fast interactions dependable and easy to reconcile.

**Verification completed and limits**

| Check | Evidence |
|---|---|
| Production build | Passed. Main JavaScript bundle: **622.29 kB**, **178.85 kB gzip**. Successful compilation does not establish business correctness. |
| Lint | Failed: **34 errors and 5 warnings**. |
| Automated tests | No test scripts or application test files found. |
| Original localhost, port 5173 | **Live:** empty Select User and disabled Unlock. Browser console reports Firebase **“Missing or insufficient permissions.”** This establishes a login failure in this environment. |
| Authenticated workflow inspection | **Isolated:** copied app at `/tmp/spicesentry-audit`, synthetic owner/staff, mocked Firebase, intercepted Apps Script requests. No production writes. |
| Confirmed interactions | **Isolated:** select Kallar, then Buy defaults to 20 Acre; quantity/price lack accessible names; entering **−10 kg at ₹100** is accepted and displays a purchase-success toast. Supplied Firestore rules would reject persisting negative quantity; this proves misleading UI behavior, not production persistence. |
| Staff permissions | **Isolated:** staff assigned Kallar land on 20 Acre and see all branches. Dispatch remains visible and throws **“onDispatch is not a function”** when clicked; Transfer is also visible. |
| Failed persistence | **Isolated:** injected Firestore write failure still shows **“Purchase recorded — 3 kg added to 20 Acre”** and changes dashboard values. A pending count appears without recovery; failure is logged. Reproduced twice. |
| Responsive appearance | **Isolated:** dashboard has no document-level horizontal overflow at **320, 390, 768, and 1440px**. Navigation labels are hidden at 320/390 and visible at 768/1440. These checks do not establish every screen or keyboard-open layout. |
| External state | Deployed rules, real owner/staff sessions, service credentials, WhatsApp delivery, production reconciliation, and real biometric hardware were not verified. |

Local evidence: [browser results](/tmp/spicesentry-audit/browser-results.json), [mobile screenshot](/tmp/spicesentry-dashboard-mobile.png), and [desktop screenshot](/tmp/spicesentry-dashboard-desktop.png). These temporary artifacts use synthetic data. External fonts were deliberately blocked in the fixtures; their request failures are test artifacts, not application findings.

**Prioritized findings**

P0 means address before broader production use; P1 means core workflow/data correctness; P2 means important usability or maintainability. These priorities describe the code and intended release gate, not a claim of an exploited production system.

**1. P0 — Authentication and authorization depend on client-controlled state. [Code]**

The app accepts localStorage objects containing a name, UID, and role without expiry or account revalidation. PIN hashes are fetched to the client; hashing and lockout happen locally. Biometric login restores the saved session after a browser credential operation without server challenge/signature verification. Checked-in Firestore rules allow public user/config reads and writes, and other collections lack authenticated role checks. If deployed, these rules would permit access outside the owner/staff interface.

**Boundary:** the live browser actually received permission denial; current deployed rules were not retrieved. Do not describe production as anonymously exposed. Fix identity and rules together; publishing the permissive file to make login work would be the wrong remedy. Use verified identity, server-enforced roles/shop scope, revocation, and server-verified passkeys. Evidence: [session restoration](/Users/devandev/spicesentry/src/AuthContext.jsx:52), [PIN checking](/Users/devandev/spicesentry/src/AuthContext.jsx:152), [biometrics](/Users/devandev/spicesentry/src/AuthContext.jsx:122), [rules](/Users/devandev/spicesentry/firestore.rules:10). Firebase documents authentication-based rule conditions in its [rules guide](https://firebase.google.com/docs/firestore/security/rules-conditions).

**2. P0 — A service bearer token is committed in source. [Code]**

[WhatsApp integration configuration](/Users/devandev/spicesentry/whatsapp-cron/Code.gs:31) contains a tracked bearer token. Its value is deliberately omitted here; validity was not tested. Rotate/revoke it through the service administrator and load its replacement from protected configuration. Removing the latest text alone does not remove repository history. The ignored/untracked local admin credential is **not** being reported as a committed-secret finding.

**3. P1 — “Recorded” and “synced” do not reliably mean durable persistence. [Code; Isolated]**

Purchases/sales update state and show success before deferred writes. Injected write failures confirmed that a success toast and changed inventory/profit remain visible, with only a pending count and console error. Firestore uses memory-only cache; the app has no durable Firestore outbox, while localStorage screen caching waits five seconds. Closing/reloading during a failed save can lose the record. Sheets transport catches network failures, accepts HTTP error responses without checking success, and can let its caller mark a transaction synced. Edit/delete failures likewise lack a clear recovery experience.

Use one authoritative ledger plus a durable operation queue, stable operation IDs, idempotent replay, explicit acknowledged/queued/failed states, and a retry/reconciliation view. Treat Sheets as a downstream projection. Evidence: [optimistic writes](/Users/devandev/spicesentry/src/App.jsx:540), [sync handling](/Users/devandev/spicesentry/src/App.jsx:509), [Sheets transport](/Users/devandev/spicesentry/src/App.jsx:91), [cache](/Users/devandev/spicesentry/src/firebase.js:42). Firebase's [offline persistence documentation](https://firebase.google.com/docs/firestore/manage-data/enable-offline) describes available cache behavior; persistence alone does not solve application-level replay or consistency.

**4. P1 — Profit and inventory measures disagree between screens. [Code; local calculation]**

Report totals pool cost across different spices. Buy 10 kg pepper at ₹100/kg and 10 kg cardamom at ₹1,000/kg; sell 10 kg pepper at ₹150/kg. Spice-specific profit is **₹500**, but pooled report profit is **−₹4,000**. Sale preview uses unrecovered purchase expenditure per remaining kg, while dashboard profit uses original average cost: buy 100 kg at ₹100, sell 50 at ₹150, then preview 10 at ₹120; preview profit is **₹700**, while original-cost profit is **₹200**.

Agree the intended business definitions, distinguish inventory-at-cost from unrecovered investment, and centralize calculations shared by UI, PDFs, CSVs, and messages. Include opening stock when reporting a period containing sales of earlier purchases. Evidence: [pooled totals](/Users/devandev/spicesentry/src/App.jsx:2911), [overall totals](/Users/devandev/spicesentry/src/App.jsx:3009), [sale preview](/Users/devandev/spicesentry/src/App.jsx:1809), [dashboard calculation](/Users/devandev/spicesentry/src/App.jsx:418).

**5. P1 — Editing/deleting records leaves dependent values stale. [Code]**

Edits change quantity/price without recalculating stored `totalValue`; History prefers that stale field. Daily summaries increment during creation but are not corrected on edit/delete and are not intrinsically idempotent. WhatsApp processing reconstructs quantity from the stale amount. A corrected purchase can therefore display conflicting totals across outputs.

Calculate derived amounts centrally; use atomic revisions and rebuildable projections. Preserve who changed what and why. Evidence: [edit handlers](/Users/devandev/spicesentry/src/App.jsx:599), [summary increments](/Users/devandev/spicesentry/src/App.jsx:489), [History amount](/Users/devandev/spicesentry/src/App.jsx:4208), [message reconstruction](/Users/devandev/spicesentry/whatsapp-cron/Code.gs:273).

**6. P1 — Loads and transfers lack durable, atomic lifecycle records. [Code]**

Dispatch resets active load state locally and in Sheets, while Firestore refresh reconstructs loads from transaction data and can restore the earlier load. Transfers are independent sale/purchase writes without a shared transfer identity; one side can succeed alone, and an internal movement can be counted as revenue.

Make loads and transfers first-class records. Persist load closing/opening and both movement legs atomically; separate movement type from external sales. Evidence: [load derivation](/Users/devandev/spicesentry/src/App.jsx:203), [refresh](/Users/devandev/spicesentry/src/App.jsx:287), [dispatch](/Users/devandev/spicesentry/src/App.jsx:640), [transfer writes](/Users/devandev/spicesentry/src/App.jsx:768). Use the guarantees described in Firebase's [transactions and batched writes guide](https://firebase.google.com/docs/firestore/manage-data/transactions), with an explicit offline policy.

**7. P1 — Truncation and unstable identifiers undermine the ledger. [Code; SDK reproduction]**

Reads cap each transaction collection at 2,000 records and 180 days across all branches. Older unsold stock and “All Time” reports can become incomplete without disclosure. IDs concatenate business text; buyer name **Rajan/Kumar** produces an invalid Firebase document reference, confirmed with the SDK locally. Legacy import data can overwrite the physical document ID during mapping, so later edits/deletes target the wrong document.

Use opaque immutable IDs, separate legacy/external IDs, explicit pagination, and complete stock projections. Display coverage whenever a report is partial. Evidence: [read limits and mapping](/Users/devandev/spicesentry/src/App.jsx:268), [ID generation](/Users/devandev/spicesentry/src/App.jsx:58), [document write](/Users/devandev/spicesentry/src/App.jsx:513), [legacy backfill](/Users/devandev/spicesentry/scripts/backfill-sheet-to-firestore.mjs:39).

**8. P1 — Invalid quantities and misleading stock overrides are accepted. [Isolated; Code]**

Buy/Sell/Edit check nonempty strings rather than finite positive numbers and domain limits. The isolated browser accepted −10 kg at ₹100 and reported success. The supplied rules reject a negative persisted quantity: the confirmed defect is accepting invalid input and displaying optimistic success before that rejection, not proof of a negative production record. Overselling is permitted after confirmation, while remaining stock is clamped to zero, hiding the deficit.

Validate shared schemas in both UI and trusted write layer; distinguish authorized adjustments from purchases/sales; define whether overselling is forbidden or a separately approved exception. Evidence: [purchase validation](/Users/devandev/spicesentry/src/App.jsx:1662), [sale override](/Users/devandev/spicesentry/src/App.jsx:1813), [edit validation](/Users/devandev/spicesentry/src/App.jsx:4307).

**9. P1 — PIN policy and staff workflows contradict their interfaces. [Code; Isolated]**

Administration accepts 4–6 digit PINs, but authentication accepts exactly four. Staff receive undefined dispatch/transfer handlers, although Dashboard renders those buttons: Transfer is inert; the isolated staff browser confirmed Dispatch throws “onDispatch is not a function.” Staff shop assignment does not scope operational screens: synthetic Kallar staff landed on 20 Acre and saw all branches. Buy resets to 20 Acre even after selecting Kallar; Sell preserves selected branch.

Use one PIN contract, one permission model, and persistent branch context. Protect against removing/deactivating/demoting the final usable owner. Evidence: [admin PIN policy](/Users/devandev/spicesentry/src/CPanel.jsx:115), [authentication policy](/Users/devandev/spicesentry/src/AuthContext.jsx:157), [staff handlers](/Users/devandev/spicesentry/src/App.jsx:913), [Dispatch rendering](/Users/devandev/spicesentry/src/App.jsx:1567), [Buy default](/Users/devandev/spicesentry/src/App.jsx:1608).

**10. P1 — Administration saves configuration that the app ignores. [Code]**

Shops, spices, and Sheets endpoint are stored in Firestore, but operational screens/synchronization use hardcoded constants. The configuration callback is not supplied. Saving an added, renamed, disabled, or deleted item therefore does not change daily entry. Save failures are logged without user recovery and drafts can close prematurely.

Load one effective configuration everywhere, validate uniqueness, and use stable shop IDs so future renaming preserves historical links. Evidence: [constants](/Users/devandev/spicesentry/src/App.jsx:39), [CPanel invocation](/Users/devandev/spicesentry/src/App.jsx:901), [shop save](/Users/devandev/spicesentry/src/CPanel.jsx:272), [settings save](/Users/devandev/spicesentry/src/CPanel.jsx:461).

**11. P2 — Error feedback, accessibility, and voice parsing impede reliable entry. [Live; Isolated; Code]**

The observed Firebase denial becomes an empty login selector because user-fetch errors return an empty list. There is no useful failed-load/retry state. Important fields have visual labels without accessible names; branch tabs and daily expanders are click-only divs. Custom modals lack focus trapping, Escape, and dialog semantics; toasts lack live announcements. Small metric labels use approximately **2.31:1** contrast. Navigation labels disappear below 401px.

Voice parsing matches “nutmeg” before “nutmeg mace.” Local reproduction of **“20 acre nutmeg mace 10 kg at 500”** yields nutmeg / 20 kg / ₹10. Review inferred fields before submission. Evidence: [login loading](/Users/devandev/spicesentry/src/LoginPage.jsx:32), [swallowed error](/Users/devandev/spicesentry/src/AuthContext.jsx:71), [field markup](/Users/devandev/spicesentry/src/App.jsx:1735), [branch tabs](/Users/devandev/spicesentry/src/App.jsx:1448), [voice parser](/Users/devandev/spicesentry/src/App.jsx:1645), [contrast tokens](/Users/devandev/spicesentry/src/index.css:42). Implement dialogs following the [W3C dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

**12. P2 — Reports and integrations lack a single definition of completeness. [Code]**

Summary dates use UTC date slicing, unlike shop-local daily views; early IST transactions can land on different days. Report builders do not consistently honor visible filters. Weekly messaging includes eight dates when subtracting seven days inclusively. Last-row-based alerts lack durable processed IDs and can duplicate or skip transactions. The separate MongoDB MCP integration can report a different dataset altogether.

Use Asia/Kolkata business dates, a shared report/filter contract, event IDs/checkpoints, and explicit integration health/reconciliation. Evidence: [summary date](/Users/devandev/spicesentry/src/App.jsx:490), [report builders](/Users/devandev/spicesentry/src/App.jsx:2879), [weekly interval](/Users/devandev/spicesentry/whatsapp-cron/Code.gs:91), [alert processing](/Users/devandev/spicesentry/whatsapp-cron/Code.gs:523), [MCP implementation](/Users/devandev/spicesentry/mcp-server/index.js:1).

**Error-condition QA matrix**

These are acceptance scenarios, not claims that every scenario has been executed.

| Area | Conditions to exercise | Required outcome |
|---|---|---|
| Access | Anonymous client, forged role, inactive/deleted user, revoked session, wrong-shop write | Trusted layer denies access; UI explains recovery. |
| Login | Fetch denied/offline/empty; repeated wrong PIN; 4/5/6 digits; biometric cancellation | Clear state, consistent PIN contract, controlled retry; no insecure fallback. |
| Entry | Zero/negative/huge/nonfinite values, fractions, slash/Unicode buyer names | Validated input and opaque IDs; no false success. |
| Stock | Oversell, simultaneous sales, prior-load data, dispatch followed by refresh | Invariants preserved; durable load state; explicit exception policy. |
| Transfer | One leg fails, duplicate retry, receiving branch unavailable | Both legs committed together or neither; no external revenue inflation. |
| Persistence | Offline submit, reload within five seconds, tab close, full local storage, HTTP 403/500 | Durable queued/failed state and safe replay. |
| Corrections | Edit quantity/price, delete, repeated replay, legacy imported row | Every view/summary agrees; revision trail preserved. |
| Reporting | Mixed spices, prior-period stock, >180 days/>2,000 records, all filter combinations | Correct complete totals or explicit coverage warning. |
| Dates / alerts | IST midnight, seven-day window, retries, multiple new rows | Correct business day/window; no duplicate or missed event. |
| Configuration | Duplicate/renamed/disabled shop or spice, save failure, last-owner changes | Consistent effective config; historical integrity; recoverable failure. |
| Interaction | Branch change then Buy, unsaved draft navigation, voice ambiguity | Context preserved; confirmation makes inferred data visible. |
| Accessibility | Keyboard-only flows, screen reader, 320/390/768/1440px, zoom, phone keyboard | Named controls, readable text, usable focus/dialog behavior, no blocked actions. |

**Phased improvement roadmap and acceptance gates**

| Phase | Deliverable and ownership | Gate before proceeding |
|---|---|---|
| 1 — Secure access | Engineering: verified sessions, roles/shop rules, token rotation, PIN consistency. Product owner: approve permission matrix. | Emulator tests reject unauthorized reads/writes; authorized owner/staff paths work; revoked accounts lose access; secrets removed from active code/config. |
| 2 — Reliable ledger | Engineering: canonical store, opaque IDs, durable outbox, idempotency, atomic transfers, durable loads, correction history. | Offline/reload/retry/concurrent operations neither lose nor duplicate records; reconciliation balances; failed writes remain visible. |
| 3 — Consistent business model | Product owner plus engineering: valuation definitions, complete history, shared calculations/filters, live configuration, timezone rules. | Example calculations above pass; UI/PDF/CSV/WhatsApp agree; imported history and opening stock reconcile. |
| 4 — Usable daily workflow | Design plus engineering: branch continuity, accessible forms/dialogs, readable labels, drafts, recoverable errors, clear save states. | Staff complete purchase/sale/correction exercises; keyboard and responsive scenarios pass; no ambiguous saved state. |
| 5 — Maintainable operation | Engineering: split domain/storage/report/screens, fix lint, add regression and integration tests, monitor sync/alerts, document setup/restore/deployment. | CI passes; backup restoration demonstrated; operational dashboard exposes failures and lag; release/rollback checklist exercised. |

Avoid calendar promises before the authentication and ledger architecture are agreed. Maintain a backlog with finding ID, severity, owner, acceptance evidence, and dependencies. Start tests around the reproduced failures rather than superficial component snapshots.

**Product opportunities after those gates [Proposal]**

Give staff a branch-specific entry screen with a clear transaction receipt and recovery path. Give owners an exception-focused dashboard showing stock discrepancies, low stock, failed sync, unusual prices, and closing status. The inspected 1440px synthetic dashboard stretches stacked cards across the page, leaving substantial empty areas and a long scroll. Use a compact comparison table or grid for desktop stock; show Reports, Daily Summary, and Administration directly in its sidebar. Preserve shareable filters and browser navigation. Optimize the initial bundle after measuring real task performance.

Then validate supplier references, buyer payment balances, receipt attachments, stock counts/adjustments, transfer receiving confirmation, and spice grades/batches with shop users. Measure failed-save recovery, time to record an entry, discrepancy resolution time, report agreement, and daily-closing completion. These outcomes will improve the product more than adding visual complexity.

The audit changed no application source, rules, credentials, or production records. This document records findings and proposed acceptance criteria; remediation and production verification remain separate work.
