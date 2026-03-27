#!/usr/bin/env node
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const GSHEET_URL = process.env.GSHEET_URL || 'https://script.google.com/macros/s/AKfycbzWGVOetrbZMaN0XSKV94Yj_5HXKg2GwpFB8WPXwrtLZqt0HTAz9oBWs3TKxq7KtqypAQ/exec';
const DRY_RUN = process.argv.includes('--write') ? false : true;

const makeTxId = (kind, item) => {
  const parts = [
    kind,
    item.shop || '',
    item.type || '',
    Number(item.qty || 0).toFixed(3),
    Number(item.price ?? item.sellPrice ?? 0).toFixed(2),
    item.date || '',
    item.loadId || '',
    item.buyerName || '',
  ];
  return parts.join('|').replace(/\s+/g, '_');
};

function normalize(item) {
  if (item.shop === 'KVS Anachal') item.shop = 'Anachal';
  return item;
}

async function main() {
  const app = initializeApp({ credential: applicationDefault() });
  const db = getFirestore(app);
  const res = await fetch(GSHEET_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const data = await res.json();
  const entries = (data.entries || []).map(normalize);
  const sales = (data.sales || []).map(normalize);

  let writes = 0;
  let skipped = 0;
  for (const entry of entries) {
    const txId = makeTxId('entry', entry);
    const docRef = db.collection('purchases').doc(txId);
    const existing = await docRef.get();
    if (existing.exists) { skipped += 1; continue; }
    writes += 1;
    if (!DRY_RUN) {
      await docRef.set({ ...entry, txId, kind: 'entry', mirrorStatus: 'backfilled', backfilledAt: new Date().toISOString() }, { merge: true });
    }
  }
  for (const sale of sales) {
    const txId = makeTxId('sale', sale);
    const docRef = db.collection('sales').doc(txId);
    const existing = await docRef.get();
    if (existing.exists) { skipped += 1; continue; }
    writes += 1;
    if (!DRY_RUN) {
      await docRef.set({ ...sale, txId, kind: 'sale', mirrorStatus: 'backfilled', backfilledAt: new Date().toISOString() }, { merge: true });
    }
  }

  console.log(`${DRY_RUN ? 'Dry run' : 'Write mode'} complete.`);
  console.log(`Entries: ${entries.length}, Sales: ${sales.length}`);
  console.log(`To write: ${writes}, Already existing: ${skipped}`);
  if (DRY_RUN) console.log('Run with --write to persist.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
