import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLedgerStorage } from '../src/ledger-cache.js';
import { createTransactionOutbox, transactionCacheKey } from '../src/pending-transactions.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const ledgerEntries = {
  spice_entries: '[{"id":"legacy-purchase"}]',
  'spice_entries:owner-1': '[{"id":"owner-purchase"}]',
  'spice_entries:staff-1': '[{"id":"staff-purchase"}]',
  spice_sales: '[{"id":"legacy-sale"}]',
  'spice_sales:owner-1': '[{"id":"owner-sale"}]',
  spice_shop_loads: '{"20 Acre":"old-load"}',
  'spice_shop_loads:owner-1': '{"20 Acre":"old-load"}',
  'spicesentry_pending_v1:owner-1:purchase-1': '{"record":{"id":"pending-purchase"}}',
  'spicesentry_pending_v1:staff-1:sale-1': '{"record":{"id":"pending-sale"}}',
  spicesentry_offline_queue: '[{"id":"old-mirror-write"}]',
  spice_tombstones: '{"deleted-purchase":123}',
  'spicesentry_tombstones:owner-1': '{"deleted-purchase":123}',
};

const preferences = {
  spicesentry_cache_account: 'owner-1',
  'spice_selected_shop:owner-1': '20 Acre',
  theme: 'dark',
  unrelated_data: 'keep-me',
};

function assertLedgerCleared(storage) {
  for (const key of Object.keys(ledgerEntries)) assert.equal(storage.getItem(key), null, `Clears ${key}`);
  for (const [key, value] of Object.entries(preferences)) assert.equal(storage.getItem(key), value, `Preserves ${key}`);
}

test('a changed ledger generation clears all account caches and queued writes without resetting preferences', () => {
  const storage = memoryStorage({ ...ledgerEntries, ...preferences, spicesentry_ledger_generation: 'initial' });
  prepareLedgerStorage(storage, 'reset-1');
  assertLedgerCleared(storage);
  assert.equal(storage.getItem('spicesentry_ledger_generation'), 'reset-1');
});

test('a browser first opened after reset discards legacy rows and unsent writes', () => {
  const storage = memoryStorage({ ...ledgerEntries, ...preferences });
  prepareLedgerStorage(storage, 'reset-1');
  assertLedgerCleared(storage);
  assert.equal(storage.getItem('spicesentry_ledger_generation'), 'reset-1');
});

test('initial generation adoption preserves existing offline submissions before any reset', () => {
  const storage = memoryStorage({ ...ledgerEntries, ...preferences });
  prepareLedgerStorage(storage, 'initial');
  for (const [key, value] of Object.entries(ledgerEntries)) assert.equal(storage.getItem(key), value, `Preserves ${key}`);
  assert.equal(storage.getItem('spicesentry_ledger_generation'), 'initial');
});

test('returning to the same generation preserves new pending records and cached rows', () => {
  const storage = memoryStorage({ ...ledgerEntries, ...preferences, spicesentry_ledger_generation: 'reset-1' });
  prepareLedgerStorage(storage, 'reset-1');
  for (const [key, value] of Object.entries(ledgerEntries)) assert.equal(storage.getItem(key), value, `Preserves ${key}`);
});

test('a later explicit reset clears records created during the previous generation', () => {
  const storage = memoryStorage({ ...ledgerEntries, ...preferences, spicesentry_ledger_generation: 'reset-1' });
  prepareLedgerStorage(storage, 'reset-2');
  assertLedgerCleared(storage);
  assert.equal(storage.getItem('spicesentry_ledger_generation'), 'reset-2');
});

test('failing to remove a stale queued write cannot mark its generation as current', () => {
  const storage = memoryStorage({ ...ledgerEntries, spicesentry_ledger_generation: 'initial' });
  const remove = storage.removeItem;
  storage.removeItem = key => {
    if (key.startsWith('spicesentry_pending_v1:')) throw Error('Storage unavailable');
    remove(key);
  };
  assert.throws(() => prepareLedgerStorage(storage, 'reset-1'), /Storage unavailable/);
  assert.equal(storage.getItem('spicesentry_ledger_generation'), 'initial');
});

test('late writes from an old tab cannot populate the current generation cache or outbox', async () => {
  const storage = memoryStorage({ spicesentry_ledger_generation: 'reset-1' });
  prepareLedgerStorage(storage, 'reset-2');
  const oldRecord = { id: 'old-entry', txId: 'old-entry' };
  // A tab suspended between checking its generation and writing can finish late.
  storage.setItem(transactionCacheKey('spice_entries', 'owner-1', 'reset-1'), JSON.stringify([oldRecord]));
  storage.setItem('spicesentry_pending_v2:reset-1:owner-1:old-entry', JSON.stringify({ record: oldRecord }));
  // The returning current tab sees the same generation and needs no second purge.
  prepareLedgerStorage(storage, 'reset-2');
  assert.equal(storage.getItem(transactionCacheKey('spice_entries', 'owner-1', 'reset-2')), null);
  let primaryWrites = 0;
  const currentOutbox = createTransactionOutbox({
    storage, userId: 'owner-1', generation: 'reset-2',
    writePrimary: async () => { primaryWrites++; }, writeMirror: async () => {},
  });
  assert.deepEqual(currentOutbox.pending(), []);
  await currentOutbox.flush();
  assert.equal(primaryWrites, 0);
});

test('adopting a generation preserves its queued records and cache written by another tab', () => {
  const record = { id: 'new-entry', txId: 'new-entry' };
  const cacheKey = transactionCacheKey('spice_entries', 'owner-1', 'reset-2');
  const pendingKey = 'spicesentry_pending_v2:reset-2:owner-1:new-entry';
  const storage = memoryStorage({
    spicesentry_ledger_generation: 'reset-1',
    [cacheKey]: JSON.stringify([record]),
    [pendingKey]: JSON.stringify({ record }),
    'spicesentry_pending_v2:reset-1:owner-1:old-entry': JSON.stringify({ record: { id: 'old-entry' } }),
  });
  prepareLedgerStorage(storage, 'reset-2');
  assert.deepEqual(JSON.parse(storage.getItem(cacheKey)), [record]);
  assert.deepEqual(JSON.parse(storage.getItem(pendingKey)), { record });
  assert.equal(storage.getItem('spicesentry_pending_v2:reset-1:owner-1:old-entry'), null);
});
