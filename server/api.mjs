import express from 'express';
import { assertLedgerGeneration } from './ledger.mjs';
import { credentialVersion, createLoginLimiter, equal, issueSession, publicUser, readSession, SESSION_MS, verifyPin } from './auth.mjs';

export const apiError = (status, message) => Object.assign(new Error(message), { status });
const collections = new Set(['purchases', 'sales', 'daily_summaries', 'config']);
const idIsValid = id => typeof id === 'string' && id.length > 0 && id.length <= 1000 && !id.includes('/') && id !== '.' && id !== '..';

export function createApi({ store, sessionSecret, now = () => Date.now(), secureCookies = false, allowedOrigin }) {
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) throw new Error('A session secret of at least 32 bytes is required.');
  const app = express();
  const limiter = createLoginLimiter(now);
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/', maxAge: SESSION_MS };
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    const expected = allowedOrigin || `${secureCookies ? 'https' : 'http'}://${req.get('host')}`;
    if ((req.get('origin') && req.get('origin') !== expected) || req.get('sec-fetch-site') === 'cross-site') return next(apiError(403, 'This request is not allowed from another site.'));
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) return next(apiError(415, 'Send a JSON request.'));
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const route = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const account = async req => {
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('spicesentry_session='))?.slice('spicesentry_session='.length);
    const session = readSession(token, sessionSecret, now());
    if (!session) throw apiError(401, 'Your session has ended. Sign in again.');
    const user = await store.getUser(session.uid);
    if (!user || user.active === false || !['owner', 'staff'].includes(user.role) || !equal(session.version, credentialVersion(user))) throw apiError(401, 'Your session has ended. Sign in again.');
    return user;
  };
  const requireOwner = user => { if (user.role !== 'owner') throw apiError(403, 'Only an owner can manage accounts.'); };

  app.get('/api/auth/users', route(async (_req, res) => {
    res.json({ users: (await store.listUsers()).filter(user => user.active !== false && ['owner', 'staff'].includes(user.role)).map(publicUser) });
  }));
  app.post('/api/auth/login', route(async (req, res) => {
    const { uid, pin } = req.body || {};
    if (!idIsValid(uid) || typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw apiError(400, 'Select a user and enter a four-digit PIN.');
    if (!limiter.take(req.ip, uid)) throw apiError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const user = await store.getUser(uid);
    if (!user || user.active === false || !['owner', 'staff'].includes(user.role) || !await verifyPin(pin, user.pin)) throw apiError(401, 'The PIN does not match this account.');
    limiter.success(uid);
    res.cookie('spicesentry_session', issueSession(user, sessionSecret, now()), cookieOptions);
    res.json({ user: publicUser(user), ledger: await store.getLedgerState() });
  }));
  app.get('/api/auth/session', route(async (req, res) => res.json({ user: publicUser(await account(req)), ledger: await store.getLedgerState() })));
  app.post('/api/auth/pin', route(async (req, res) => {
    const user = await account(req);
    const { currentPin, newPin } = req.body || {};
    if (typeof currentPin !== 'string' || typeof newPin !== 'string' || !/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) throw apiError(400, 'PIN must be exactly four digits.');
    if (!limiter.take(req.ip, user.uid)) throw apiError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    if (!await verifyPin(currentPin, user.pin)) throw apiError(401, 'Current PIN is incorrect.');
    const updated = await store.changeOwnPin(user.uid, newPin, credentialVersion(user));
    limiter.success(user.uid);
    res.cookie('spicesentry_session', issueSession(updated, sessionSecret, now()), cookieOptions);
    res.json({ user: publicUser(updated) });
  }));
  app.post('/api/auth/logout', (_req, res) => { res.clearCookie('spicesentry_session', { ...cookieOptions, maxAge: undefined }); res.json({ ok: true }); });
  app.get('/api/admin/users', route(async (req, res) => { requireOwner(await account(req)); res.json({ users: (await store.listUsers()).map(publicUser) }); }));
  app.post('/api/admin/users', route(async (req, res) => {
    const actor = await account(req); requireOwner(actor);
    const { action, uid, data } = req.body || {};
    if (!['create', 'update', 'delete'].includes(action) || (action !== 'create' && !idIsValid(uid))) throw apiError(400, 'Invalid account change.');
    const user = await store.mutateUser(action, uid, data, actor);
    // A PIN change invalidates previous sessions, including this browser's.
    if (user?.uid === actor.uid) res.cookie('spicesentry_session', issueSession(user, sessionSecret, now()), cookieOptions);
    res.json({ user: user ? publicUser(user) : null });
  }));
  app.post('/api/data/:operation', route(async (req, res) => {
    const user = await account(req);
    if (req.body?.expectedUserId !== undefined && req.body.expectedUserId !== user.uid) throw Object.assign(apiError(403, 'The signed-in account changed. Sign in again.'), { code: 'account-mismatch' });
    const { collection, id, data, merge = false, constraints = [], record, ledgerGeneration } = req.body || {};
    assertLedgerGeneration(await store.getLedgerState(), ledgerGeneration);
    if (!collections.has(collection)) throw apiError(400, 'Unsupported record collection.');
    switch (req.params.operation) {
      case 'check': return res.json({ ok: true });
      case 'query': return res.json({ documents: await store.queryDocuments(collection, constraints, user) });
      case 'get':
        if (!idIsValid(id)) throw apiError(400, 'Invalid record ID.');
        return res.json({ document: await store.getDocument(collection, id, user) });
      case 'set':
        if (!idIsValid(id) || !data || typeof data !== 'object' || Array.isArray(data) || typeof merge !== 'boolean') throw apiError(400, 'Invalid record.');
        await store.setDocument(collection, id, data, merge, user, ledgerGeneration); return res.json({ ok: true });
      case 'delete':
        if (!idIsValid(id)) throw apiError(400, 'Invalid record ID.');
        await store.deleteDocument(collection, id, user, ledgerGeneration); return res.json({ ok: true });
      case 'commit':
        if (!['purchases', 'sales'].includes(collection) || !record || !idIsValid(record.txId)) throw apiError(400, 'Invalid purchase or sale.');
        await store.createTransaction(collection, record, user, ledgerGeneration); return res.json({ ok: true });
      default: throw apiError(404, 'Unknown data operation.');
    }
  }));
  app.use('/api', (_req, _res, next) => next(apiError(404, 'Unknown API route.')));
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status >= 400 && error.status < 500 ? error.status : 503;
    res.status(status).json({ error: status === 503 ? 'The database is unavailable. Please retry shortly.' : error.message, ...(['account-mismatch', 'ledger-reset', 'ledger-maintenance'].includes(error.code) ? { code: error.code } : {}) });
  });
  return app;
}
