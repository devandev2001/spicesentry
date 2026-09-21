import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, validateRecord } from '../server/store.mjs';

const staff = { uid: 'staff-1', role: 'staff', shop: '20 Acre', active: true };
const owner = { uid: 'owner-1', role: 'owner', active: true };
const record = overrides => ({
  id: 'purchase-1', txId: 'purchase-1', kind: 'entry', shop: '20 Acre', type: 'pepper',
  qty: 3, price: 125, totalValue: 375, date: '2026-09-21T20:00:00.000Z', loadId: 'load-1', ...overrides,
});
const status = expected => error => error?.status === expected;

function fakeDatabase(seed = {}, { beforeTransaction } = {}) {
  const records = new Map(Object.entries(seed));
  const writes = [];
  const snapshot = path => ({ id: path.split('/').at(-1), exists: records.has(path), data: () => records.get(path) });
  const set = (ref, data, options) => {
    records.set(ref.path, options?.merge ? { ...records.get(ref.path), ...data } : { ...data });
    writes.push({ path: ref.path, data, options });
  };
  const db = {
    collection(name) {
      const collection = {
        name,
        doc(id) {
          const ref = { path: `${name}/${id}`, id };
          return { ...ref, get: async () => snapshot(ref.path), set: async (data, options) => set(ref, data, options), delete: async () => records.delete(ref.path) };
        },
        limit() { return collection; },
        async get() { return { docs: [...records.keys()].filter(path => path.startsWith(`${name}/`)).map(snapshot) }; },
      };
      return collection;
    },
    async runTransaction(callback) {
      beforeTransaction?.(records);
      const pending = [];
      const result = await callback({
        get: async ref => ref.path ? snapshot(ref.path) : ref.get(),
        set: (ref, data, options) => pending.push(() => set(ref, data, options)),
        delete: ref => pending.push(() => records.delete(ref.path)),
      });
      for (const commit of pending) commit();
      return result;
    },
  };
  return { db, records, writes, store: createStore(db) };
}

test('server validation computes purchase and sale values from quantity and price', () => {
  assert.equal(validateRecord('purchases', 'purchase-1', record({ totalValue: 1 }), staff).totalValue, 375);
  const sale = record({ kind: 'sale', sellPrice: 200, totalValue: 1 });
  assert.equal(validateRecord('sales', 'purchase-1', sale, staff).totalValue, 600);
});

test('staff can only submit transactions for their assigned branch', () => {
  assert.throws(() => validateRecord('purchases', 'purchase-1', record({ shop: 'Anachal' }), staff), status(403));
  assert.equal(validateRecord('purchases', 'purchase-1', record({ shop: 'Anachal' }), owner).shop, 'Anachal');
});

test('non-positive, non-numeric, oversized, or non-finite quantities and prices are rejected', () => {
  for (const qty of [0, -1, NaN, Infinity, '3', 1000000]) {
    assert.throws(() => validateRecord('purchases', 'purchase-1', record({ qty }), staff), status(400), `quantity ${qty}`);
  }
  for (const price of [0, -1, NaN, Infinity, '125']) {
    assert.throws(() => validateRecord('purchases', 'purchase-1', record({ price }), staff), status(400), `purchase price ${price}`);
    assert.throws(() => validateRecord('sales', 'purchase-1', record({ kind: 'sale', sellPrice: price }), staff), status(400), `sale price ${price}`);
  }
  assert.throws(() => validateRecord('purchases', 'purchase-1', record({ qty: 10000, price: 100000 }), staff), status(400));
});

test('mismatched IDs, transaction kinds, spice types, and malformed record fields are rejected', () => {
  for (const changes of [
    { txId: 'another-id' }, { id: 'another-id' }, { kind: 'sale' }, { type: 'unknown-spice' },
    { shop: 'unknown-shop' }, { date: 'invalid-date' }, { deleted: 'true' }, { unexpected: true },
  ]) {
    assert.throws(() => validateRecord('purchases', 'purchase-1', record(changes), staff), status(400));
  }
});

test('atomic transaction retries preserve the first record and increment its daily summary only once', async () => {
  const { store, records, writes } = fakeDatabase();
  await store.createTransaction('purchases', record({ totalValue: 1, createdBy: 'spoofed-owner' }), staff);
  await store.createTransaction('purchases', record({ qty: 4, totalValue: 1 }), staff);
  const saved = records.get('purchases/purchase-1');
  assert.equal(saved.qty, 3);
  assert.equal(saved.totalValue, 375);
  assert.equal(saved.createdBy, staff.uid);
  assert.equal(saved.mirrorStatus, 'pending');
  assert.equal(writes.filter(write => write.path.startsWith('purchases/')).length, 1);
  const summaries = writes.filter(write => write.path.startsWith('daily_summaries/'));
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].path, 'daily_summaries/20 Acre|2026-09-22');
  assert.ok(summaries[0].data.purchaseQty);
  assert.ok(summaries[0].data.purchaseValue);
});

test('a retry cannot claim or modify a transaction ID that belongs to another branch', async () => {
  const existing = record({ shop: 'Anachal' });
  const { store, records, writes } = fakeDatabase({ 'purchases/purchase-1': existing });
  await assert.rejects(store.createTransaction('purchases', record(), staff), status(403));
  assert.deepEqual(records.get('purchases/purchase-1'), existing);
  assert.equal(writes.length, 0);
});

test('staff cannot edit existing business values, delete records, change config, or manage users', async () => {
  const { store, records, writes } = fakeDatabase({ 'purchases/purchase-1': record() });
  await assert.rejects(store.setDocument('purchases', 'purchase-1', { qty: 4 }, true, staff), status(403));
  await assert.rejects(store.deleteDocument('purchases', 'purchase-1', staff), status(403));
  await assert.rejects(store.setDocument('config', 'settings', { activeLoad: 'another' }, true, staff), status(403));
  await assert.rejects(store.setDocument('daily_summaries', '20 Acre|2026-09-21', {}, true, staff), status(403));
  await assert.rejects(store.mutateUser('update', 'owner-1', { role: 'staff' }, staff), status(403));
  assert.equal(records.get('purchases/purchase-1').qty, 3);
  assert.equal(writes.length, 0);
});

test('staff can acknowledge their branch sync but cannot update another branch or smuggle an edit', async () => {
  const { store, records } = fakeDatabase({
    'purchases/purchase-1': record(),
    'purchases/foreign-1': record({ id: 'foreign-1', txId: 'foreign-1', shop: 'Anachal' }),
  });
  await store.setDocument('purchases', 'purchase-1', { mirrorStatus: 'synced' }, true, staff);
  assert.equal(records.get('purchases/purchase-1').mirrorStatus, 'synced');
  await assert.rejects(store.setDocument('purchases', 'foreign-1', { mirrorStatus: 'synced' }, true, staff), status(403));
  await assert.rejects(store.setDocument('purchases', 'purchase-1', { mirrorStatus: 'synced', price: 1 }, true, staff), status(403));
});

test('owner corrections recompute the stored total instead of trusting a supplied total', async () => {
  const { store, records } = fakeDatabase({ 'purchases/purchase-1': record() });
  await store.setDocument('purchases', 'purchase-1', { qty: 4, totalValue: 1 }, true, owner);
  assert.equal(records.get('purchases/purchase-1').qty, 4);
  assert.equal(records.get('purchases/purchase-1').totalValue, 500);
});

test('account management cannot disable or remove the last active owner', async () => {
  const { store, records } = fakeDatabase({ 'users/owner-1': { name: 'Owner', role: 'owner', active: true, pin: 'stored-hash' } });
  await assert.rejects(store.mutateUser('update', 'owner-1', { active: false }, owner), status(400));
  await assert.rejects(store.mutateUser('delete', 'owner-1', {}, owner), status(400));
  assert.equal(records.get('users/owner-1').active, true);
});

test('transaction metadata cannot inject objects into text fields or null into its date', () => {
  for (const changes of [{ date: null }, { date: 0 }, { buyerName: { unexpected: 'object' } }, { loadId: ['not-a-string'] }, { mirrorError: { message: 'object' } }]) {
    assert.throws(() => validateRecord('purchases', 'purchase-1', record(changes), staff), status(400), JSON.stringify(changes));
  }
});

test('legacy Anachal records remain readable to staff assigned to the canonical branch', async () => {
  const { store } = fakeDatabase({ 'purchases/purchase-1': record({ shop: 'KVS Anachal' }) });
  const anachalStaff = { ...staff, shop: 'Anachal' };
  assert.equal((await store.queryDocuments('purchases', [], anachalStaff)).length, 1);
  assert.ok(await store.getDocument('purchases', 'purchase-1', anachalStaff));
  await assert.rejects(store.getDocument('purchases', 'purchase-1', staff), status(403));
});

test('removed Kallar branch cannot receive new purchases or sales even from owners', async () => {
  const { store, writes } = fakeDatabase();
  await assert.rejects(store.createTransaction('purchases', record({ shop: 'Kallar' }), owner), status(400));
  await assert.rejects(store.createTransaction('sales', record({ shop: 'Kallar', kind: 'sale', sellPrice: 200 }), owner), status(400));
  assert.equal(writes.length, 0);
});

test('ledger state defaults to the initial generation until an explicit reset', async () => {
  const { store } = fakeDatabase();
  assert.deepEqual(await store.getLedgerState(), { generation: 'initial', status: 'active' });
  const reset = fakeDatabase({ '_system/ledger': { generation: 'reset-1', status: 'active' } });
  assert.deepEqual(await reset.store.getLedgerState(), { generation: 'reset-1', status: 'active' });
});

const ledgerMutations = [
  ['purchase submission', (store, generation) => store.createTransaction('purchases', record(), owner, generation)],
  ['sale submission', (store, generation) => store.createTransaction('sales', record({ kind: 'sale', sellPrice: 200 }), owner, generation)],
  ['record replacement', (store, generation) => store.setDocument('purchases', 'purchase-1', record(), false, owner, generation)],
  ['mirror acknowledgement', (store, generation) => store.setDocument('purchases', 'purchase-1', { mirrorStatus: 'synced' }, true, owner, generation)],
  ['summary update', (store, generation) => store.setDocument('daily_summaries', '20 Acre|2026-09-22', { shop: '20 Acre', date: '2026-09-22', purchaseQty: { __increment: 3 } }, true, owner, generation)],
  ['record deletion', (store, generation) => store.deleteDocument('purchases', 'purchase-1', owner, generation)],
];

for (const [name, mutate] of ledgerMutations) {
  test(`a stale or unversioned ${name} cannot alter the ledger after reset`, async () => {
    for (const generation of [undefined, 'initial', 'older-reset']) {
      const seed = { '_system/ledger': { generation: 'reset-1', status: 'active' }, 'purchases/purchase-1': record() };
      const { store, records } = fakeDatabase(seed);
      await assert.rejects(mutate(store, generation), error => error.status === 409 && error.code === 'ledger-reset');
      assert.deepEqual(Object.fromEntries(records), seed, 'Rejected writes leave all ledger data unchanged');
    }
  });

  test(`maintenance blocks ${name} even with the current generation`, async () => {
    const seed = { '_system/ledger': { generation: 'reset-1', status: 'resetting' }, 'purchases/purchase-1': record() };
    const { store, records } = fakeDatabase(seed);
    await assert.rejects(mutate(store, 'reset-1'), status(503));
    assert.deepEqual(Object.fromEntries(records), seed);
  });

  test(`${name} succeeds with the current ledger generation`, async () => {
    const { store } = fakeDatabase({ '_system/ledger': { generation: 'reset-1', status: 'active' }, 'purchases/purchase-1': record() });
    await mutate(store, 'reset-1');
  });

  test(`a reset immediately before ${name} commits cannot be bypassed by an earlier generation check`, async () => {
    const ledger = { generation: 'initial', status: 'active' };
    const { store, records } = fakeDatabase({ '_system/ledger': ledger, 'purchases/purchase-1': record() }, {
      beforeTransaction: records => records.set('_system/ledger', { generation: 'reset-1', status: 'active' }),
    });
    await assert.rejects(mutate(store, 'initial'), error => error.status === 409 && error.code === 'ledger-reset');
    assert.deepEqual(records.get('purchases/purchase-1'), record());
    assert.equal(records.has('sales/purchase-1'), false);
    assert.equal(records.has('daily_summaries/20 Acre|2026-09-22'), false);
  });
}

test('an offline submission cannot recreate a transaction deleted by a completed ledger reset', async () => {
  const { store, records } = fakeDatabase({ '_system/ledger': { generation: 'reset-1', status: 'active' } });
  await assert.rejects(store.createTransaction('purchases', record(), owner, 'initial'), error => error.status === 409 && error.code === 'ledger-reset');
  assert.equal(records.has('purchases/purchase-1'), false);
  assert.equal(records.has('daily_summaries/20 Acre|2026-09-22'), false);
});

test('new purchases still persist with their summary after the reset completes', async () => {
  const { store, records } = fakeDatabase({ '_system/ledger': { generation: 'reset-1', status: 'active' } });
  await store.createTransaction('purchases', record(), owner, 'reset-1');
  assert.equal(records.get('purchases/purchase-1').qty, 3);
  assert.equal(records.get('daily_summaries/20 Acre|2026-09-22').shop, '20 Acre');
});
