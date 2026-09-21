import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, doc, setDoc, commitTransactionRecord } from './firebase';
import { createTransactionOutbox } from './pending-transactions';
import { api, isLedgerCurrent, getLedgerGeneration } from './api';

export function useTransactionSync(userId, sheetUrl) {
  const [revision, setRevision] = useState(0);
  const notify = useCallback(() => setRevision(value => value + 1), []);
  const outbox = useMemo(() => createTransactionOutbox({
    storage: localStorage,
    userId,
    generation: getLedgerGeneration(),
    isActive: () => localStorage.getItem('spicesentry_cache_account') === userId && isLedgerCurrent(),
    onChange: notify,
    writePrimary: ({ firestoreCollection, record }) => commitTransactionRecord(firestoreCollection, record, userId),
    writeMirror: async ({ sheetPayload }) => {
      // Even an operation whose primary write previously succeeded must prove
      // it still belongs to the current ledger before touching the mirror.
      await api('data/check', { collection: 'purchases', expectedUserId: userId });
      const response = await fetch(`${sheetUrl}?data=${encodeURIComponent(JSON.stringify(sheetPayload))}`, {
        redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Spreadsheet sync failed (${response.status}).`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) throw new Error('Spreadsheet sync returned a sign-in or error page.');
      if (contentType.includes('json')) {
        const result = await response.json();
        if (!result || result.error || result.ok === false || result.success === false || result.status === 'error') {
          throw new Error('The spreadsheet did not accept this entry.');
        }
      }
    },
    markMirrored: async ({ firestoreCollection, record }) => {
      await setDoc(doc(db, firestoreCollection, record.txId), { mirrorStatus: 'synced', updatedAt: new Date().toISOString() }, { merge: true, expectedUserId: userId });
    },
  }), [userId, sheetUrl, notify]);
  useEffect(() => { outbox.resume(); return () => outbox.pause(); }, [outbox]);

  const pendingTransactions = useMemo(() => {
    // revision is advanced by local writes and storage events in another tab.
    void revision;
    return outbox.pending();
  }, [outbox, revision]);
  const retryTransactions = useCallback(() => {
    if (!navigator.onLine || outbox.pending().length === 0) return Promise.resolve();
    return outbox.flush().catch(error => {
      console.error('Could not sync saved entries:', error);
    }).finally(notify);
  }, [outbox, notify]);
  useEffect(() => {
    const onStorage = event => {
      if (/^spicesentry_pending_v[12]:/.test(event.key || '')) notify();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [notify]);
  return { pendingTransactions, queueTransaction: outbox.enqueue, readPendingTransactions: outbox.pending, retryTransactions };
}
