import { useCallback, useEffect, useMemo, useState } from 'react';
import { db, doc, setDoc, commitTransactionRecord } from './firebase';
import { createTransactionOutbox } from './pending-transactions';

export function useTransactionSync(userId, sheetUrl) {
  const [revision, setRevision] = useState(0);
  const notify = useCallback(() => setRevision(value => value + 1), []);
  const outbox = useMemo(() => createTransactionOutbox({
    storage: localStorage,
    userId,
    isActive: () => localStorage.getItem('spicesentry_cache_account') === userId,
    onChange: notify,
    writePrimary: ({ firestoreCollection, record }) => commitTransactionRecord(firestoreCollection, record, userId),
    writeMirror: async ({ sheetPayload }) => {
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
      if (event.key?.startsWith('spicesentry_pending_v1:')) notify();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [notify]);
  return { pendingTransactions, queueTransaction: outbox.enqueue, readPendingTransactions: outbox.pending, retryTransactions };
}
