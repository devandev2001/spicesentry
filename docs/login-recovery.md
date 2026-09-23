**Login recovery, 21 September 2026**

The deployed Firestore test rule allowed browser access only before 25 April 2026. After that date, the login user query was denied and `fetchUsers` hid the error by returning an empty array. A read-only administrative check confirmed five existing active accounts. Firebase Authentication was never configured for this project. No users needed seeding or resetting.

The application now uses a same-origin Node API. The public account picker returns account labels without PIN hashes. The server checks the selected account's existing PIN, then issues an eight-hour HttpOnly, SameSite=Strict session cookie. Every protected request rechecks the account's active state, role, and credential version. Existing PINs remain unchanged; newly set PINs use salted scrypt. Account editing and login now use the same four-digit contract. Old browser-only biometric sessions are no longer accepted; biometric login requires a future server-verifiable passkey implementation.

The API uses Firebase Admin credentials exclusively on the server to access the existing `kvs-traders` database. Owners can administer accounts and inventory; staff reads and new transactions are restricted to their assigned branch. An existing staff account named Admin has no branch assigned and requires an owner to configure that assignment. Protected endpoints validate inputs, reject hostile browser origins and non-JSON mutations, and limit PIN attempts. Transaction creation and its daily summary remain atomic and idempotent. Failed database reads retain cached data instead of falling back to an unauthenticated spreadsheet read.

The checked-in Firestore rules now deny direct client access. No cloud rules were published and the live expired rule was left unchanged; the authenticated server works through its IAM credentials. Firebase documents that [server client libraries use IAM rather than client Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions).

**Local use**

Run `npm run dev`, then open `http://localhost:5173`. The Vite development server also mounts the API and binds to loopback. The existing ignored local service-account file is recognized on this checkout. On another machine, set `GOOGLE_APPLICATION_CREDENTIALS` to a private credential file or provide `FIREBASE_SERVICE_ACCOUNT_JSON` through the process environment. Never prefix server secrets with `VITE_`. The development server denies requests for server code and credential files; the service worker never caches `/api/` responses.

The development session-signing key is generated in memory, so restarting the server requires signing in again. Saved transaction queues and display snapshots are scoped by account. Requests carry the current tab's expected account ID, and an account change suspends pending drains and signs stale tabs out. Restoring a session after reopening requires the server and database to be reachable; an offline queued record is not discarded when authentication is temporarily unavailable.

**Hosting requirements**

This version needs a Node API; deploying only `dist/` to a static host will not provide login. Run `npm run build`, then `npm start` in a Node service behind HTTPS, with `APP_ORIGIN` set to its exact public HTTPS origin, `AUTH_SESSION_SECRET` set to a random secret of at least 32 bytes, and private Firebase Admin credentials supplied by the deployment environment. The production server issues Secure cookies. It does not enable APIs, create paid infrastructure, or deploy itself.

**Vercel (same-origin API)**

The repo includes `api/run.mjs` (Express via `serverless-http`), `api/health.mjs`, and `vercel.json` rewrites so `/api/*` is served by a single serverless function while `dist/` remains the static SPA. Without those API routes, the login screen cannot load user chips (`GET /api/auth/users`).

Set these Vercel Project Environment Variables (Production and Preview as needed):

- `AUTH_SESSION_SECRET` — random secret, at least 32 bytes
- `FIREBASE_SERVICE_ACCOUNT_JSON` — full Firebase Admin service-account JSON as one string (never use `VITE_` for this)
- `APP_ORIGIN` — exact public HTTPS origin for Production (example: `https://your-app.vercel.app`). Preview can omit this; the API falls back to the request host

Redeploy after saving env vars. First open `/api/health` — it should return JSON with `authSecretConfigured` and `firebaseConfigured` both `true`. Then confirm in the Network tab that `GET /api/auth/users` returns `200` with a `users` array. A Dockerfile is also provided for a conventional Node host (`npm start`) if you prefer a long-running server instead of serverless.

The provided login limiter is process-local. Before running multiple instances, use a shared limiter and review trusted proxy configuration. Sessions are signed and expire after eight hours; logout clears the browser cookie, account deactivation or a PIN change revokes server access. Broader audit findings, including spreadsheet endpoint authentication, historical accounting, and complete pagination, remain separate work. This login repair is not a claim that every production security issue is resolved.

**Verification**

Live read-only browser verification signed into an existing owner account, loaded existing inventory, and survived a reload without uncaught page errors. No production purchase, sale, account, PIN, or rule was modified during verification. Synthetic HTTP and store-policy tests cover credential-safe account discovery, invalid PINs, forged/expired sessions, account deactivation, origin enforcement, rate limits, branch permissions, payload validation, and idempotent record/summary commits. Browser failure/retry scenarios use intercepted API responses so test records never reach the database.

Final validation: 40 automated tests and nine isolated browser scenarios pass, along with the production build and scoped lint for the server, tests, and new authentication/sync modules. Full-repository lint retains 25 errors and two warnings in existing App, CPanel, and MCP code. The main browser bundle is 367.15 kB (101.05 kB gzip), compared with 633.74 kB before moving database access to the server. This is build output, not a measured user latency improvement.

The dependency review found existing advisories. Vite was updated to 8.0.16 because the previous dev server had a [file-deny bypass](https://github.com/vitejs/vite/security/advisories/GHSA-v2wj-q39q-566r), relevant to keeping server credentials private. Other dependency findings need a separately scoped update: protobuf schema/code-generation inputs are packaged Firestore schemas, not user-provided schemas; the reported Realtime Database websocket driver is not used by this Firestore application; Express routes do not use repeated optional groups or multiple wildcards; YAML, glob, CSS and browserslist inputs are repository-controlled; React Router server/RSC APIs, XML building, and multipart uploads are not used here. The gRPC transport connects only to Google through TLS. This bounds the known high/critical advisory paths in this change; it does not assert a clean dependency audit. Review the remaining advisories before public deployment.
