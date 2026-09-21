import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransactionOutbox, mergeTransactionRows, commitRecordOnce } from '../src/pending-transactions.js';

function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i],
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const operation = (id = 'purchase-1') => ({ firestoreCollection: 'purchases', record: { id, txId: id, kind: 'entry', shop: 'Kallar', type: 'pepper', qty: 3, price: 125, totalValue: 375, date: '2026-09-20T10:00:00.000Z', loadId: 'load-1' }, sheetPayload: { id, kind: 'entry' } });
const makeOutbox = (storage, overrides = {}) => createTransactionOutbox({ storage, userId: 'owner-1', writePrimary: async () => {}, writeMirror: async () => {}, ...overrides });

test('a submitted record survives immediate app recreation before any cloud write', () => {
  const storage = memoryStorage();
  makeOutbox(storage).enqueue(operation());
  const reopened = makeOutbox(storage);
  assert.equal(reopened.pending()[0].record.qty, 3);
  assert.deepEqual(mergeTransactionRows([], [], reopened.pending(), new Set()), [operation().record]);
});

test('failed primary writes remain visible beyond six hours and retry after reopening', async () => {
  const storage = memoryStorage();
  const offline = makeOutbox(storage, { writePrimary: async () => { throw Error('Connection unavailable'); } });
  offline.enqueue(operation()); await offline.flush();
  assert.match(offline.pending()[0].error, /Connection unavailable/);
  assert.equal(mergeTransactionRows([], [], offline.pending(), new Set(), Date.now() + 86400000).length, 1);
  const reopened = makeOutbox(storage); await reopened.flush();
  assert.equal(reopened.pending().length, 0);
  assert.equal(JSON.parse(storage.getItem('spice_entries'))[0].qty, 3);
});

test('a failed mirror retries without repeating an acknowledged primary write', async () => {
  const storage = memoryStorage(); let writes = 0;
  const outbox = makeOutbox(storage, { writePrimary: async () => { writes++; }, writeMirror: async () => { throw Error('HTTP 503'); } });
  outbox.enqueue(operation()); await outbox.flush();
  assert.equal(outbox.pending()[0].primarySaved, true);
  assert.equal(outbox.pending()[0].stage, 'mirror');
  await makeOutbox(storage, { writePrimary: async () => { writes++; } }).flush();
  assert.equal(writes, 1);
  assert.equal(outbox.pending().length, 0);
});

test('overlapping drains do not send an operation twice or erase newly queued records', async () => {
  const storage = memoryStorage(); let release; let writes = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const outbox = makeOutbox(storage, { writePrimary: async () => { writes++; await waiting; } });
  outbox.enqueue(operation()); const first = outbox.flush(); const second = outbox.flush();
  outbox.enqueue(operation('purchase-2')); release(); await Promise.all([first, second]); await outbox.flush();
  assert.equal(writes, 2);
  assert.equal(JSON.parse(storage.getItem('spice_entries')).length, 2);
});

test('storage failure rejects a submission instead of acknowledging a volatile record', () => {
  const storage = memoryStorage(); storage.setItem = () => { throw Error('QuotaExceeded'); };
  assert.throws(() => makeOutbox(storage).enqueue(operation()), /save.*device/i);
});

test('pending records are scoped to the submitting account and tombstones still win', () => {
  const storage = memoryStorage(); const outbox = makeOutbox(storage); outbox.enqueue(operation());
  assert.equal(makeOutbox(storage, { userId: 'staff-2' }).pending().length, 0);
  assert.equal(mergeTransactionRows([], [], outbox.pending(), new Set(['purchase-1'])).length, 0);
});

test('a failure updating mirror status does not send the spreadsheet record again', async () => {
  const storage = memoryStorage(); let mirrors = 0;
  const outbox = makeOutbox(storage, { writeMirror: async () => { mirrors++; }, markMirrored: async () => { throw Error('Disconnected'); } });
  outbox.enqueue(operation()); await outbox.flush();
  assert.equal(outbox.pending()[0].mirrorSaved, true);
  await makeOutbox(storage, { writeMirror: async () => { mirrors++; } }).flush();
  assert.equal(mirrors, 1); assert.equal(outbox.pending().length, 0);
});

test('a damaged display cache is rebuilt without losing the submitted record', async () => {
  const storage = memoryStorage(); storage.setItem('spice_entries', '{broken');
  const outbox = makeOutbox(storage); outbox.enqueue(operation()); await outbox.flush();
  assert.equal(outbox.pending().length, 0);
  assert.equal(JSON.parse(storage.getItem('spice_entries'))[0].id, 'purchase-1');
});

test('replaying a committed operation does not overwrite corrections or increment its summary again', async () => {
  const rows = new Map(); let summaryWrites = 0;
  const transaction = { get: async ref => ({ exists: () => rows.has(ref) }), set: (ref, data) => { rows.set(ref, data); if (ref === 'summary') summaryWrites++; } };
  await commitRecordOnce(transaction, 'record', 'summary', operation().record, { purchaseQty: 3 });
  rows.set('record', { ...operation().record, qty: 4 });
  await commitRecordOnce(transaction, 'record', 'summary', operation().record, { purchaseQty: 3 });
  assert.equal(summaryWrites, 1); assert.equal(rows.get('record').qty, 4);
});
