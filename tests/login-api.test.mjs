import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { createApi } from '../server/api.mjs';

const PIN = '8642';
const legacyHash = pin => createHash('sha256').update(`${pin}_kvs_salt_2026`).digest('hex');
const safeUser = { uid: 'staff-1', name: 'Local Test Staff', role: 'staff', shop: '20 Acre', active: true };

async function fixture(t, options = {}) {
  const users = new Map([
    [safeUser.uid, { ...safeUser, pin: legacyHash(PIN), pinHash: 'must-not-be-exposed' }],
    ['inactive-1', { ...safeUser, uid: 'inactive-1', active: false, pin: legacyHash(PIN) }],
  ]);
  const documents = new Map();
  const ledger = { generation: 'initial', status: 'active' };
  let currentTime = Date.parse('2026-09-21T12:00:00.000Z');
  const store = {
    listUsers: async () => [...users.values()],
    getLedgerState: async () => ({ ...ledger }),
    getUser: async uid => users.get(uid) ?? null,
    changeOwnPin: async (uid, pin, expectedVersion) => {
      const user = users.get(uid);
      if (!user || createHash('sha256').update(user.pin).digest('hex') !== expectedVersion) throw Object.assign(new Error('Account changed'), { status: 401 });
      const updated = { ...user, pin: legacyHash(pin) };
      users.set(uid, updated);
      return updated;
    },
    queryDocuments: async collection => [...documents.values()].filter(row => row.collection === collection).map(row => row.record),
    getDocument: async (collection, id) => documents.get(`${collection}/${id}`)?.record ?? null,
    setDocument: async (collection, id, data) => documents.set(`${collection}/${id}`, { collection, record: data }),
    deleteDocument: async (collection, id) => documents.delete(`${collection}/${id}`),
    createTransaction: async (collection, record) => {
      const key = `${collection}/${record.txId}`;
      if (!documents.has(key)) documents.set(key, { collection, record });
      return { created: documents.get(key).record === record };
    },
    mutateUser: async () => { throw new Error('User mutations are outside this test fixture'); },
  };
  const app = createApi({ store, sessionSecret: 'test-secret-with-at-least-32-characters-please', now: () => currentTime, secureCookies: false, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { body, cookie, headers = {}, ...init } = {}) => fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const login = async () => {
    const response = await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: PIN } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.ok(cookie, 'Successful login must set a session cookie');
    return { response, cookie: cookie.split(';')[0], setCookie: cookie };
  };
  return { request, login, users, documents, ledger, baseUrl, advanceTime: milliseconds => { currentTime += milliseconds; } };
}

test('the login account picker exposes active user labels without credentials', async t => {
  const { request } = await fixture(t);
  const response = await request('/api/auth/users');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { users: [safeUser] });
});

test('an existing legacy PIN opens a protected session without returning credential fields', async t => {
  const { login, request } = await fixture(t);
  const { response, cookie, setCookie } = await login();
  assert.deepEqual(await response.json(), { user: safeUser, ledger: { generation: 'initial', status: 'active' } });
  assert.match(setCookie, /(?:^|;\s*)HttpOnly(?:;|$)/i);
  assert.match(setCookie, /(?:^|;\s*)SameSite=Strict(?:;|$)/i);
  assert.match(setCookie, /(?:^|;\s*)Path=\/(?:;|$)/i);
  const session = await request('/api/auth/session', { cookie });
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { user: safeUser, ledger: { generation: 'initial', status: 'active' } });
});

test('accounts with the stronger scrypt format can sign in using the same PIN flow', async t => {
  const { users, login } = await fixture(t);
  const salt = '8ad901ea594402d5a6756ce9537a1d82';
  users.get(safeUser.uid).pin = `scrypt:${salt}:${scryptSync(PIN, salt, 64).toString('hex')}`;
  const { response } = await login();
  assert.deepEqual(await response.json(), { user: safeUser, ledger: { generation: 'initial', status: 'active' } });
});

test('wrong PINs, unknown accounts, and inactive accounts cannot obtain sessions', async t => {
  const { request } = await fixture(t);
  for (const body of [
    { uid: safeUser.uid, pin: '1111' },
    { uid: 'missing-user', pin: PIN },
    { uid: 'inactive-1', pin: PIN },
  ]) {
    const response = await request('/api/auth/login', { method: 'POST', body });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    const message = await response.text();
    assert.ok(!message.includes(legacyHash(PIN)), 'Auth failures must not disclose stored hashes');
  }
});

test('invalid login payloads are rejected before authenticating', async t => {
  const { request } = await fixture(t);
  for (const body of [null, {}, { uid: safeUser.uid }, { uid: safeUser.uid, pin: 8642 }, { uid: {}, pin: PIN }, { uid: safeUser.uid, pin: 'letters' }]) {
    const response = await request('/api/auth/login', { method: 'POST', body });
    assert.equal(response.status, 400, `Expected invalid payload to fail: ${JSON.stringify(body)}`);
    assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('clients cannot promote themselves by sending a role during login', async t => {
  const { request } = await fixture(t);
  const response = await request('/api/auth/login', {
    method: 'POST', body: { uid: safeUser.uid, pin: PIN, role: 'admin', active: true, shop: 'Other shop' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: safeUser, ledger: { generation: 'initial', status: 'active' } });
});

test('session verification rejects a missing or tampered authentication cookie', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await request('/api/auth/session')).status, 401);
  const { cookie } = await login();
  const tampered = cookie.slice(0, -8) + (cookie.endsWith('aaaaaaaa') ? 'bbbbbbbb' : 'aaaaaaaa');
  assert.equal((await request('/api/auth/session', { cookie: tampered })).status, 401);
});

test('sessions expire after the configured eight-hour login window', async t => {
  const { request, login, advanceTime } = await fixture(t);
  const { cookie } = await login();
  advanceTime(8 * 60 * 60 * 1000 + 1000);
  assert.equal((await request('/api/auth/session', { cookie })).status, 401);
  assert.equal((await request('/api/data/query', { method: 'POST', cookie, body: { collection: 'purchases', constraints: [] } })).status, 401);
});

test('deactivating an account revokes access even while its session cookie remains valid', async t => {
  const { users, request, login } = await fixture(t);
  const { cookie } = await login();
  users.get(safeUser.uid).active = false;
  assert.equal((await request('/api/auth/session', { cookie })).status, 401);
  assert.equal((await request('/api/data/query', { method: 'POST', cookie, body: { collection: 'purchases', constraints: [] } })).status, 401);
});

test('logout clears the browser session cookie', async t => {
  const { request, login } = await fixture(t);
  const { cookie } = await login();
  const response = await request('/api/auth/logout', { method: 'POST', cookie, body: {} });
  assert.ok([200, 204].includes(response.status));
  const clearedCookie = response.headers.get('set-cookie');
  assert.match(clearedCookie ?? '', /^spicesentry_session=;/);
  assert.match(clearedCookie, /(?:Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
});

test('business data requires a verified session and collection allowlisting', async t => {
  const { request, login } = await fixture(t);
  const body = { collection: 'purchases', constraints: [] };
  assert.equal((await request('/api/data/query', { method: 'POST', body })).status, 401);
  const { cookie } = await login();
  const allowed = await request('/api/data/query', { method: 'POST', body, cookie });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { documents: [] });
  for (const collection of ['users', '../users', 'arbitrary-collection']) {
    assert.equal((await request('/api/data/query', { method: 'POST', body: { collection, constraints: [] }, cookie })).status, 400);
  }
});

test('transaction submission cannot write records without a verified session', async t => {
  const { request, login, documents } = await fixture(t);
  const record = { id: 'purchase-test-1', txId: 'purchase-test-1', kind: 'entry', shop: '20 Acre', type: 'pepper', qty: 3, price: 125, totalValue: 375, date: '2026-09-21T12:00:00.000Z', loadId: 'test-load' };
  const body = { collection: 'purchases', record };
  assert.equal((await request('/api/data/commit', { method: 'POST', body })).status, 401);
  assert.equal(documents.size, 0);
  const { cookie } = await login();
  const committed = await request('/api/data/commit', { method: 'POST', cookie, body });
  assert.ok([200, 201].includes(committed.status));
  assert.equal(documents.size, 1);
  assert.equal(documents.get('purchases/purchase-test-1').record.qty, 3);
  assert.equal((await request('/api/data/commit', { method: 'POST', cookie, body: { collection: 'users', record } })).status, 400);
});

test('hostile browser origins cannot log in or operate through a valid cookie', async t => {
  const { request, login, baseUrl } = await fixture(t);
  const hostileHeaders = { Origin: 'https://attacker.example' };
  assert.equal((await request('/api/auth/login', { method: 'POST', headers: hostileHeaders, body: { uid: safeUser.uid, pin: PIN } })).status, 403);
  const { cookie } = await login();
  const body = { collection: 'purchases', constraints: [] };
  assert.equal((await request('/api/data/query', { method: 'POST', cookie, headers: hostileHeaders, body })).status, 403);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie, headers: hostileHeaders, body: {} })).status, 403);
  assert.equal((await request('/api/data/query', { method: 'POST', cookie, headers: { Origin: baseUrl }, body })).status, 200);
});

test('state-changing requests require JSON rather than accepting cross-origin form payloads', async t => {
  const { request, login } = await fixture(t);
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: { uid: safeUser.uid, pin: PIN },
  });
  assert.ok([400, 415].includes(response.status));
  const { cookie } = await login();
  const logout = await request('/api/auth/logout', { method: 'POST', cookie, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: {} });
  assert.ok([400, 415].includes(logout.status));
});

test('five failed PIN attempts lock the account until the fifteen-minute rate window expires', async t => {
  const { request, advanceTime } = await fixture(t);
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: '1111' } })).status, 401);
  }
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: PIN } })).status, 429);
  advanceTime(15 * 60 * 1000 + 1000);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: PIN } })).status, 200);
});

test('a pending operation cannot run through a different account session after a browser account switch', async t => {
  const { request, login, documents } = await fixture(t);
  const { cookie } = await login();
  const record = { id: 'old-account-purchase', txId: 'old-account-purchase', kind: 'entry', shop: '20 Acre', type: 'pepper', qty: 3, price: 125, date: '2026-09-21T12:00:00.000Z' };
  const response = await request('/api/data/commit', {
    method: 'POST', cookie, body: { collection: 'purchases', record, expectedUserId: 'previously-signed-in-user' },
  });
  assert.equal(response.status, 403);
  assert.equal(documents.size, 0);
  const sameAccount = await request('/api/data/query', {
    method: 'POST', cookie, body: { collection: 'purchases', constraints: [], expectedUserId: safeUser.uid },
  });
  assert.equal(sameAccount.status, 200);
});

test('staff can change their own PIN, renewing this session and invalidating older cookies', async t => {
  const { request, login } = await fixture(t);
  const { cookie } = await login();
  const changed = await request('/api/auth/pin', { method: 'POST', cookie, body: { currentPin: PIN, newPin: '9753' } });
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { user: safeUser });
  const renewedCookie = changed.headers.get('set-cookie')?.split(';')[0];
  assert.ok(renewedCookie);
  assert.equal((await request('/api/auth/session', { cookie: renewedCookie })).status, 200);
  assert.equal((await request('/api/auth/session', { cookie })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: '9753' } })).status, 200);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { uid: safeUser.uid, pin: PIN } })).status, 401);
});

test('changing a PIN requires a valid session and the correct current PIN', async t => {
  const { request, login, users } = await fixture(t);
  const { cookie } = await login();
  const before = users.get(safeUser.uid).pin;
  assert.equal((await request('/api/auth/pin', { method: 'POST', body: { currentPin: PIN, newPin: '9753' } })).status, 401);
  assert.equal((await request('/api/auth/pin', { method: 'POST', cookie, body: { currentPin: '1111', newPin: '9753' } })).status, 401);
  assert.equal(users.get(safeUser.uid).pin, before);
});

test('the own-PIN route cannot target another account or promote its caller', async t => {
  const { request, login, users } = await fixture(t);
  users.set('owner-1', { uid: 'owner-1', name: 'Owner', role: 'owner', active: true, pin: legacyHash('3579') });
  const before = users.get('owner-1').pin;
  const { cookie } = await login();
  const response = await request('/api/auth/pin', {
    method: 'POST', cookie, body: { uid: 'owner-1', role: 'owner', currentPin: PIN, newPin: '9753' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { user: safeUser });
  assert.equal(users.get('owner-1').pin, before);
  assert.equal(users.get(safeUser.uid).role, 'staff');
});


test('reset generations reach sign-in and reject stale reads, writes, and mirror preflights', async t => {
  const { request, login, ledger, documents } = await fixture(t);
  const { response, cookie } = await login();
  assert.equal((await response.json()).ledger.generation, 'initial');
  Object.assign(ledger, { generation: 'reset-1' });
  for (const operation of ['query', 'set', 'commit', 'delete', 'check']) {
    const response = await request(`/api/data/${operation}`, { method: 'POST', cookie, body: { collection: 'purchases', ledgerGeneration: 'initial' } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'ledger-reset');
  }
  assert.equal(documents.size, 0);
  const resumed = await request('/api/auth/session', { cookie });
  assert.equal((await resumed.json()).ledger.generation, 'reset-1');
  const fresh = await request('/api/data/query', { method: 'POST', cookie, body: { collection: 'purchases', ledgerGeneration: 'reset-1' } });
  assert.equal(fresh.status, 200);
  ledger.status = 'resetting';
  const paused = await request('/api/data/check', { method: 'POST', cookie, body: { collection: 'purchases', ledgerGeneration: 'reset-1' } });
  assert.equal(paused.status, 503);
  assert.equal((await paused.json()).code, 'ledger-maintenance');
});
