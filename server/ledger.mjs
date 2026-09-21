// A reset changes the ledger generation. Reading this document in the same
// transaction as a write also fences off requests already in flight at reset.
export const ledgerRef = db => db.collection('_system').doc('ledger');
export const ledgerState = snapshot => snapshot.exists ? snapshot.data() : { generation: 'initial', status: 'active' };

export function assertLedgerGeneration(state, expectedGeneration) {
  if (state.status !== 'active' || typeof state.generation !== 'string') {
    throw Object.assign(new Error('The ledger is being reset. Please retry shortly.'), { status: 503, code: 'ledger-maintenance' });
  }
  if ((expectedGeneration ?? 'initial') !== state.generation) {
    throw Object.assign(new Error('The ledger was cleared. Reload to start with the new records.'), { status: 409, code: 'ledger-reset' });
  }
}

export const readLedgerState = async db => ledgerState(await ledgerRef(db).get());
export const withLedgerTransaction = (db, expectedGeneration, action) => db.runTransaction(async transaction => {
  assertLedgerGeneration(ledgerState(await transaction.get(ledgerRef(db))), expectedGeneration);
  return action(transaction);
});
