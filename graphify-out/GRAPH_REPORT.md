# Graph Report - SpiceSentry source context  (2026-09-21)

## Corpus Check
- 35 files · ~42,349 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 182 nodes · 343 edges · 15 communities (14 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- External model API tokens: 0. Curated semantic facts use the host agent; host token usage is unavailable.


## God Nodes (most connected - your core abstractions)
1. `server/store.mjs` - 23 edges
2. `server/api.mjs` - 19 edges
3. `MainApp()` - 17 edges
4. `api()` - 14 edges
5. `src/useTransactionSync.js` - 14 edges
6. `src/AuthContext.jsx` - 11 edges
7. `src/api.js` - 10 edges
8. `setDoc()` - 10 edges
9. `src/pending-transactions.js` - 9 edges
10. `isLedgerCurrent()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `server/api.mjs` --implements--> `Authenticated Node API`  [EXTRACTED]
  server/api.mjs → docs/project-context.md
- `server/store.mjs` --implements--> `Authenticated Node API`  [EXTRACTED]
  server/store.mjs → docs/project-context.md
- `src/AuthContext.jsx` --implements--> `Signed account sessions`  [EXTRACTED]
  src/AuthContext.jsx → docs/project-context.md
- `src/api.js` --implements--> `Signed account sessions`  [EXTRACTED]
  src/api.js → docs/project-context.md
- `src/pending-transactions.js` --implements--> `Per-account durable submission outbox`  [EXTRACTED]
  src/pending-transactions.js → docs/project-context.md

## Import Cycles
- None detected.

## Communities (15 total, 1 thin omitted)

### Community 0 - "Inventory User Interface"
Cohesion: 0.11
Nodes (27): getLedgerGeneration(), isLedgerCurrent(), AddEntry(), AddSale(), CPanel, DailyPurchases(), Dashboard(), flushOfflineQueue() (+19 more)

### Community 1 - "Session Authentication"
Cohesion: 0.17
Nodes (18): server/api.mjs, collections, createApi(), createLoginLimiter(), credentialVersion(), equal(), hashPin(), issueSession() (+10 more)

### Community 2 - "Firebase"
Cohesion: 0.23
Nodes (17): src/api.js, api(), SettingsPanel(), ShopsPanel(), SpicesPanel(), TABS, commitTransactionRecord(), db (+9 more)

### Community 3 - "Firestore Transaction Store"
Cohesion: 0.17
Nodes (16): apiError(), server/store.mjs, assertShop(), canonicalShop(), createStore(), ownerOnly(), positive(), recordFields (+8 more)

### Community 4 - "Architecture And Decisions"
Cohesion: 0.17
Nodes (18): Account and branch isolation, Atomic idempotent primary commit, Kallar retirement, Account and generation scoped display caches, Derived branch/day summaries, SpiceSentry project context, Per-account durable submission outbox, Firestore primary ledger (+10 more)

### Community 5 - "Authcontext"
Cohesion: 0.22
Nodes (9): App(), AuthContext, useAuth(), src/AuthContext.jsx, AuthProvider(), clearLegacySession(), prepareAccount(), CPanel() (+1 more)

### Community 6 - "Ledger"
Cohesion: 0.31
Nodes (7): main(), makeTxId(), assertLedgerGeneration(), ledgerRef(), ledgerState(), readLedgerState(), withLedgerTransaction()

### Community 7 - "Ledger Cache.Test"
Cohesion: 0.22
Nodes (4): createTransactionOutbox(), ledgerEntries, preferences, makeOutbox()

### Community 8 - "Setup"
Cohesion: 0.25
Nodes (8): app, db, __dirname, hashPin(), rootDir, saPath, serviceAccount, setup()

### Community 9 - "Index"
Cohesion: 0.29
Nodes (4): server, SHOPS, SPICE_IDS, SPICES

### Community 10 - "Project Context Generation"
Cohesion: 0.33
Nodes (3): Build a portable Graphify map from source files only; never call model APIs., Positive allowlist avoids indexing data exports even if ignore rules drift., source_files()

### Community 11 - "Enable Firestore"
Cohesion: 0.33
Nodes (4): __dirname, rootDir, saPath, serviceAccount

### Community 12 - "Refresh Context"
Cohesion: 0.50
Nodes (3): binary, result, root

## Knowledge Gaps
- **36 isolated node(s):** `SHOPS`, `SPICES`, `SPICE_IDS`, `server`, `PRECACHE` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Authenticated Node API` connect `Architecture And Decisions` to `Session Authentication`, `Firestore Transaction Store`?**
  _High betweenness centrality (0.320) - this node is a cross-community bridge._
- **Why does `Signed account sessions` connect `Architecture And Decisions` to `Firebase`, `Authcontext`?**
  _High betweenness centrality (0.240) - this node is a cross-community bridge._
- **Why does `server/store.mjs` connect `Firestore Transaction Store` to `Session Authentication`, `Architecture And Decisions`, `Ledger`?**
  _High betweenness centrality (0.220) - this node is a cross-community bridge._
- **What connects `SHOPS`, `SPICES`, `SPICE_IDS` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Inventory User Interface` be split into smaller, more focused modules?**
  _Cohesion score 0.11363636363636363 - nodes in this community are weakly interconnected._

## Refresh and scope

Generated with graphifyy 0.8.36. Run `npm run context:refresh` and `npm run context:check`. Source hashes are in `sources.json`. Business records, credentials, backups, and the credential-bearing WhatsApp script are excluded. This graph does not establish live deployment or reset completion.
