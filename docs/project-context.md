# SpiceSentry project context

This document records current architecture and decisions for future work. The knowledge graph in `graphify-out/` is a source navigation aid, not a business database or backup. Verify graph findings against the referenced files before editing.

## Product and storage

SpiceSentry records spice purchases and sales, shows stock and reports, and administers accounts. The supported branches after the requested retirement are **20 Acre** and **Anachal**; **Kallar is retired**. Keep browser selectors, API validation, seed configuration, voice parsing, and integration catalogues consistent.

The primary business database is Google Cloud Firestore, project **kvs-traders**, database **(default)**. `purchases` and `sales` hold transaction documents; `daily_summaries` holds derived branch/day totals. `users` and `config` hold identity and settings. The authenticated Node API in `server/api.mjs` and `server/store.mjs` accesses Firestore with server-only Firebase Admin credentials. Never put those credentials in frontend environment variables or graph artifacts.

Google Sheets receives a reporting mirror through an externally deployed Apps Script. Its deployed write handler is absent from this repository. The optional `mcp-server` uses a separate MongoDB integration; that is not the web app's ledger. Graphify does not move business records into a graph database.

## Login and submitted-entry recovery

`src/AuthContext.jsx` and `src/api.js` restore server sessions. A four-digit account PIN produces a signed eight-hour HttpOnly session cookie. The server rechecks account role, active state, and credential version; new/reset PINs use scrypt. Staff access is restricted to the assigned branch. Every data request carries the tab's expected account ID to reject stale account tabs.

`src/pending-transactions.js` synchronously saves each complete submitted purchase/sale to an account- and ledger-generation-scoped localStorage outbox before the UI acknowledges it. `src/useTransactionSync.js` advances durable stages: primary commit, spreadsheet mirror, mirror-status confirmation. Failures remain visible and retry on foreground/reconnection. Server transactions create the primary record and Asia/Kolkata daily summary atomically and idempotently using the original record ID. A lost response must not create a duplicate or increment the summary again.

Display caches are also scoped by account and ledger generation. Old-tab cache writes and inactive enqueue attempts are rejected. They improve reopening but are not backups. Browser storage clearing loses unsynced local records. Cross-device recovery requires a successful cloud commit. Exactly-once spreadsheet delivery still depends on the external handler deduplicating the stable ID.

## Requested ledger reset

On 21 September 2026, the user explicitly authorized clearing every real purchase, sale, and daily summary across every branch, with existing users preserved. Firestore clearing is verified: 139 purchases, 7 sales, and 21 daily summaries were deleted, with all five accounts retained. The reporting copy was also cleared (242 purchase rows and 8 sale rows), and both its native cells and deployed Apps Script response were verified empty. The ledger reopened at 12:42:11 UTC. See `docs/ledger-reset-2026-09-21.md` for the operation record.

The implementation introduces a server ledger generation at `_system/ledger` and client cache/outbox invalidation so old tabs and queued submissions cannot recreate pre-reset records. A reset requires a private backup outside the repository, rejection of writes during maintenance, and verification of empty target collections before reopening writes. The external Apps Script is not generation-aware, so its requests must drain before clearing its reporting copy; old independently deployed direct writers remain an integration limitation. Keep backup contents, credentials, and actual ledger rows out of Graphify. The reporting workbook headers, formatting, and Loads configuration were retained. 79 unit/API tests and 15 isolated browser cases passed; no real test transactions were created.

## Running and validating

`npm run dev` serves the frontend and same-origin API at `http://localhost:5173`. Production requires the same-origin API: either `npm run build` + `npm start` on a Node host, or Vercel with `api/run.mjs` + env `AUTH_SESSION_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, and Production `APP_ORIGIN`. Use `/api/health` to confirm those env vars are present after deploy. A static `dist/` upload alone cannot support login. Local code validation and a Git push are not evidence of public deployment.

Use `npm test`, `npm run build`, and scoped ESLint for changes. Synthetic browser checks must intercept API and Apps Script writes. Never seed, backfill, reset PINs, create test records in production, or run a ledger reset merely to test the UI. Read `docs/login-recovery.md` for the previous verified login baseline. `docs/storage-and-recovery.md` includes historical test/build figures; use current command output for present validation.

## Remaining constraints and priorities

- The login limiter is process-local; multiple API instances need shared rate limiting.
- History reads are capped; complete stock projections and paginated history need separate work.
- Spreadsheet endpoint authentication and duplicate handling require reviewing the missing deployed handler.
- Existing transfer/dispatch, edits/deletes, valuation consistency, and historical summaries remain separate audit work.
- Existing dependency advisories and repository-wide lint failures require scoped repairs before public deployment claims.
- Measure read volume, sync lag, visible task latency, and rendering before further caching changes. Hidden/offline refreshes and overlapping drains are already coalesced or paused.

## Keeping context current with Graphify

The project uses [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify), Python distribution `graphifyy` pinned to **0.8.36**. Install with `uv tool install --python 3.12 graphifyy==0.8.36`. This is development tooling, not an application runtime dependency.

Run `npm run context:refresh` after code changes. The wrapper extracts a reviewed source allowlist locally, merges the checked-in semantic facts, and writes `graphify-out/graph.json`, `GRAPH_REPORT.md`, and `graph.html`. It makes no model API calls and does not read live databases. Relative source paths and content hashes make the artifacts portable and allow `npm run context:check` to report staleness.

Run `npm run context:query -- "Per-account durable submission outbox"`, `graphify path "Durable transaction sync stages" "Firestore primary ledger"`, or `graphify explain "Firestore primary ledger"`. Graph traversals are navigation evidence, not proof that a business operation occurred. Specific concept names make the lexical query engine more precise than broad natural-language questions. Open `graphify-out/graph.html` for the interactive map; its renderer may load public visualization assets.

When architecture or decisions change, update this document and the source-backed facts in `docs/context-graph.json`, then refresh. The semantic facts were extracted by the host coding agent, with no separate paid model request. Host-session token usage is not exposed by the tool; a zero external API cost is not a claim of zero host tokens. Never enable semantic API calls merely because a provider key exists in the environment.
