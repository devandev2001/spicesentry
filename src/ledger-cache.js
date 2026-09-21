export const LEDGER_GENERATION_KEY = 'spicesentry_ledger_generation';

export function prepareLedgerStorage(storage, generation) {
  if (typeof generation !== 'string' || !generation) throw new Error('Missing ledger version.');
  const previous = storage.getItem(LEDGER_GENERATION_KEY);
  if (previous !== generation && !(previous === null && generation === 'initial')) {
    const prefixes = ['spice_entries', 'spice_sales', 'spice_shop_loads', 'spice_tombstones', 'spicesentry_tombstones', 'spicesentry_pending_v1:', 'spicesentry_pending_v2:'];
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (key?.startsWith(`spicesentry_pending_v2:${encodeURIComponent(generation)}:`) || key?.endsWith(`:ledger:${encodeURIComponent(generation)}`)) continue;
      if (key === 'spicesentry_offline_queue' || prefixes.some(prefix => key?.startsWith(prefix))) storage.removeItem(key);
    }
  }
  storage.setItem(LEDGER_GENERATION_KEY, generation);
}
