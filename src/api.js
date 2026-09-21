import { LEDGER_GENERATION_KEY, prepareLedgerStorage } from './ledger-cache';

let accountId = null;
let ledgerGeneration = 'initial';
export const getLedgerGeneration = () => ledgerGeneration;
export const isLedgerCurrent = () => localStorage.getItem(LEDGER_GENERATION_KEY) === ledgerGeneration;

export async function api(path, body) {
  if (path.startsWith('data/')) {
    if (!isLedgerCurrent()) {
      window.location.reload();
      throw new Error('The ledger changed. Reloading the application.');
    }
    body = { ...body, expectedUserId: body?.expectedUserId || accountId, ledgerGeneration };
  }
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (result.code === 'ledger-reset') window.location.reload();
    if ((response.status === 401 || result.code === 'account-mismatch') && path.startsWith('data/')) {
      accountId = null;
      window.dispatchEvent(new Event('spicesentry-session-expired'));
    }
    throw Object.assign(new Error(result.error || 'Could not reach the application server. Please retry.'), { status: response.status, code: result.code });
  }
  if (['auth/login', 'auth/session'].includes(path)) {
    // This runs before React mounts inventory or starts draining pending writes.
    const generation = result.ledger?.generation || 'initial';
    if (result.ledger?.status && result.ledger.status !== 'active') throw new Error('The ledger is being reset. Please retry shortly.');
    prepareLedgerStorage(localStorage, generation);
    ledgerGeneration = generation;
    accountId = result.user?.uid || null;
  }
  if (path === 'auth/logout') accountId = null;
  return result;
}
