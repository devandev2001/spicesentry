// Each submitted record has its own durable key, so a queue flush cannot erase
// a different record submitted while it is waiting for the network.
const activeDrains = new Map();

export function createTransactionOutbox({ storage, userId, writePrimary, writeMirror, markMirrored = async () => {}, onChange = () => {} }) {
  const prefix = `spicesentry_pending_v1:${encodeURIComponent(userId)}:`;
  const keyFor = id => prefix + encodeURIComponent(id);
  const read = key => {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  };
  const pending = () => {
    const operations = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) {
        const operation = read(key);
        if (operation?.record?.txId) operations.push(operation);
      }
    }
    return operations;
  };
  const save = operation => {
    storage.setItem(keyFor(operation.record.txId), JSON.stringify(operation));
    onChange();
  };
  const enqueue = operation => {
    try {
      save({ ...operation, primarySaved: false, stage: 'primary', error: null });
    } catch {
      throw new Error('Could not save this entry on this device. Free some browser storage and try again.');
    }
  };
  const process = async key => {
    let operation = read(key);
    if (!operation) return;
    try {
      if (!operation.primarySaved) {
        await writePrimary(operation);
        operation = { ...operation, primarySaved: true, stage: 'mirror', error: null };
        save(operation);
      }
      if (!operation.mirrorSaved) {
        await writeMirror(operation);
        operation = { ...operation, mirrorSaved: true, stage: 'confirmation', error: null };
        save(operation);
      }
      await markMirrored(operation);
      // Keep an immediately usable snapshot before removing the durable outbox
      // item. This closes the reload gap before React's debounced cache runs.
      const cacheKey = operation.firestoreCollection === 'purchases' ? 'spice_entries' : 'spice_sales';
      let rows = [];
      try {
        const cached = JSON.parse(storage.getItem(cacheKey) || '[]');
        if (Array.isArray(cached)) rows = cached;
      } catch { /* A damaged disposable snapshot must not prevent a durable save. */ }
      const id = operation.record.id;
      storage.setItem(cacheKey, JSON.stringify([operation.record, ...rows.filter(row => row.id !== id)]));
      storage.removeItem(key);
      onChange();
    } catch (error) {
      // Never delete a failed operation. The same ID and stage are retried on
      // return/reconnection, including after the browser process is killed.
      save({ ...operation, error: error?.message || 'Could not sync this entry.' });
    }
  };
  const flush = () => {
    if (activeDrains.has(prefix)) return activeDrains.get(prefix);
    const drain = (async () => {
      for (const operation of pending()) {
        const key = keyFor(operation.record.txId);
        if (globalThis.navigator?.locks) {
          await navigator.locks.request(key, () => process(key));
        } else {
          await process(key);
        }
      }
    })().finally(() => activeDrains.delete(prefix));
    activeDrains.set(prefix, drain);
    return drain;
  };
  return { enqueue, pending, flush };
}

export function mergeTransactionRows(remote, local, pending, tombstones = new Set(), now = Date.now()) {
  const rows = new Map();
  const pendingIds = new Set(pending.map(operation => operation.record.id));
  for (const row of local) {
    const id = row.id || row.txId;
    if (id && (pendingIds.has(id) || now - new Date(row.date || 0).getTime() < 6 * 60 * 60 * 1000)) rows.set(id, row);
  }
  for (const operation of pending) rows.set(operation.record.id, operation.record);
  for (const row of remote) rows.set(row.id || row.txId, row);
  return [...rows.values()].filter(row => !row.deleted && !tombstones.has(row.id || row.txId))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Creation and summary increment share a transaction. A retry after a lost
// acknowledgement must neither increment twice nor overwrite a later edit.
export async function commitRecordOnce(transaction, recordRef, summaryRef, record, summary) {
  const existing = await transaction.get(recordRef);
  if (existing.exists()) return;
  transaction.set(recordRef, record);
  transaction.set(summaryRef, summary, { merge: true });
}
