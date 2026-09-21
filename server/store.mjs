import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiError } from './api.mjs';
import { credentialVersion, hashPin } from './auth.mjs';
import { readLedgerState, withLedgerTransaction } from './ledger.mjs';

const shops = ['20 Acre', 'Anachal'];
const spices = ['cardamom', 'pepper', 'nutmeg', 'nutmeg_mace', 'coffee', 'clove'];
const recordFields = new Set(['id', 'txId', 'kind', 'shop', 'type', 'qty', 'price', 'sellPrice', 'totalValue', 'date', 'loadId', 'buyerName', 'mirrorStatus', 'mirrorError', 'updatedAt', 'deleted', 'deletedAt', 'createdBy']);
const ownerOnly = user => { if (user.role !== 'owner') throw apiError(403, 'Only an owner can change this record.'); };
const canonicalShop = shop => shop === 'KVS Anachal' ? 'Anachal' : shop;
const shopAllowed = (user, shop) => user.role === 'owner' || (shops.includes(canonicalShop(user.shop)) && canonicalShop(user.shop) === canonicalShop(shop));
const assertShop = (user, shop) => { if (!shopAllowed(user, shop)) throw apiError(403, 'This account cannot access that branch.'); };
const positive = value => Number.isFinite(value) && value > 0;

export function validateRecord(collection, id, record, user) {
  record = { ...record, shop: canonicalShop(record.shop) };
  if (Object.keys(record).some(key => !recordFields.has(key))) throw apiError(400, 'Unsupported transaction field.');
  if (record.txId !== id || (record.id && record.id !== id) || record.kind !== (collection === 'purchases' ? 'entry' : 'sale')) throw apiError(400, 'Transaction ID or type does not match.');
  if (!shops.includes(record.shop) || !spices.includes(record.type)) throw apiError(400, 'Choose a valid branch and spice.');
  assertShop(user, record.shop);
  const price = collection === 'purchases' ? record.price : record.sellPrice;
  if (!positive(record.qty) || record.qty >= 1000000 || !positive(price) || record.qty * price >= 1000000000 || typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.date) || !Number.isFinite(new Date(record.date).getTime())) throw apiError(400, 'Enter a valid date, quantity, and price.');
  for (const field of ['buyerName', 'loadId', 'mirrorStatus', 'mirrorError', 'updatedAt', 'deletedAt', 'createdBy']) {
    if (record[field] !== undefined && typeof record[field] !== 'string') throw apiError(400, 'Transaction text fields must contain text.');
  }
  if (Object.values(record).some(value => typeof value === 'string' && value.length > 2000)) throw apiError(400, 'Transaction text is too long.');
  if (record.deleted !== undefined && typeof record.deleted !== 'boolean') throw apiError(400, 'Invalid deletion state.');
  return { ...record, id, txId: id, totalValue: record.qty * price };
}

export function createStore(db) {
  const getUser = async uid => { const doc = await db.collection('users').doc(uid).get(); return doc.exists ? { ...doc.data(), uid: doc.id } : null; };
  const listUsers = async () => (await db.collection('users').limit(500).get()).docs.map(doc => ({ ...doc.data(), uid: doc.id }));
  return {
    getUser, listUsers,
    getLedgerState: () => readLedgerState(db),
    async changeOwnPin(uid, pin, expectedVersion) {
      const hashed = await hashPin(pin);
      return db.runTransaction(async transaction => {
        const ref = db.collection('users').doc(uid);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists || snapshot.data().active === false || credentialVersion(snapshot.data()) !== expectedVersion) throw apiError(401, 'Your account changed. Sign in again.');
        transaction.set(ref, { pin: hashed, updatedAt: new Date().toISOString() }, { merge: true });
        return { ...snapshot.data(), uid, pin: hashed };
      });
    },
    async queryDocuments(collection, constraints, user) {
      if (!Array.isArray(constraints) || constraints.length > 5) throw apiError(400, 'Invalid record query.');
      let query = db.collection(collection);
      let max = 2000;
      for (const condition of constraints) {
        if (condition?.kind === 'where' && condition.field === 'date' && condition.op === '>=' && typeof condition.value === 'string' && Number.isFinite(new Date(condition.value).getTime())) query = query.where('date', '>=', condition.value);
        else if (condition?.kind === 'orderBy' && condition.field === 'date' && ['asc', 'desc'].includes(condition.direction)) query = query.orderBy('date', condition.direction);
        else if (condition?.kind === 'limit' && Number.isInteger(condition.count) && condition.count > 0 && condition.count <= 2000) max = condition.count;
        else throw apiError(400, 'Unsupported record query.');
      }
      const snapshot = await query.limit(max).get();
      return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() })).filter(doc => collection === 'config' || shopAllowed(user, doc.data.shop));
    },
    async getDocument(collection, id, user) {
      const snapshot = await db.collection(collection).doc(id).get();
      if (!snapshot.exists) return null;
      if (collection !== 'config') assertShop(user, snapshot.data().shop);
      return { id: snapshot.id, data: snapshot.data() };
    },
    async setDocument(collection, id, data, merge, user, generation) {
      const ref = db.collection(collection).doc(id);
      if (collection === 'config') {
        ownerOnly(user);
        if (id === 'shops' && (!Array.isArray(data.list) || data.list.some(shop => typeof shop?.name !== 'string' || shop.name.trim().toLowerCase() === 'kallar'))) throw apiError(400, 'Kallar is no longer an available branch.');
        await withLedgerTransaction(db, generation, transaction => transaction.set(ref, data, { merge })); return;
      }
      if (collection === 'daily_summaries') {
        ownerOnly(user);
        if (!shops.includes(data.shop) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') || id !== `${data.shop}|${data.date}`) throw apiError(400, 'Invalid daily summary.');
        const allowed = new Set(['shop', 'date', 'updatedAt', 'purchaseQty', 'purchaseValue', 'saleQty', 'saleValue']);
        const payload = {};
        for (const [key, value] of Object.entries(data)) {
          if (!allowed.has(key)) throw apiError(400, 'Unsupported summary field.');
          if (['shop', 'date', 'updatedAt'].includes(key)) payload[key] = value;
          else if (Number.isFinite(value?.__increment) && value.__increment >= 0 && value.__increment < 1000000000) payload[key] = FieldValue.increment(value.__increment);
          else throw apiError(400, 'Invalid summary increment.');
        }
        await withLedgerTransaction(db, generation, transaction => transaction.set(ref, payload, { merge })); return;
      }
      await withLedgerTransaction(db, generation, async transaction => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) {
          assertShop(user, snapshot.data().shop);
          const mirrorOnly = Object.keys(data).every(key => ['mirrorStatus', 'mirrorError', 'updatedAt'].includes(key));
          if (!mirrorOnly) ownerOnly(user);
          if (mirrorOnly) {
            if (data.mirrorStatus !== undefined && !['pending', 'synced'].includes(data.mirrorStatus)) throw apiError(400, 'Invalid sync status.');
            if (Object.values(data).some(value => typeof value !== 'string' || value.length > 2000)) throw apiError(400, 'Invalid sync metadata.');
            transaction.set(ref, data, { merge: true }); return;
          }
        }
        const combined = merge && snapshot.exists ? { ...snapshot.data(), ...data } : data;
        const record = validateRecord(collection, id, { ...combined, txId: id }, user);
        transaction.set(ref, { ...record, updatedAt: new Date().toISOString() }, { merge });
      });
    },
    async deleteDocument(collection, id, user, generation) { ownerOnly(user); await withLedgerTransaction(db, generation, transaction => transaction.delete(db.collection(collection).doc(id))); },
    async createTransaction(collection, input, user, generation) {
      const record = validateRecord(collection, input.txId, input, user);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(record.date));
      const kind = collection === 'purchases' ? 'purchase' : 'sale';
      const summary = { shop: record.shop, date: day, updatedAt: new Date().toISOString(), [`${kind}Qty`]: FieldValue.increment(record.qty), [`${kind}Value`]: FieldValue.increment(record.totalValue) };
      await withLedgerTransaction(db, generation, async transaction => {
        const ref = db.collection(collection).doc(record.txId);
        const existing = await transaction.get(ref);
        if (existing.exists) { assertShop(user, existing.data().shop); return; }
        transaction.set(ref, { ...record, mirrorStatus: 'pending', createdBy: user.uid, updatedAt: new Date().toISOString() });
        transaction.set(db.collection('daily_summaries').doc(`${record.shop}|${day}`), summary, { merge: true });
      });
    },
    async mutateUser(action, uid, data, actor) {
      ownerOnly(actor);
      const userId = action === 'create' ? randomUUID() : uid;
      const changes = data || {};
      if (Object.keys(changes).some(key => !['name', 'pin', 'role', 'shop', 'active'].includes(key))) throw apiError(400, 'Unsupported account field.');
      if (changes.pin !== undefined && !/^\d{4}$/.test(changes.pin)) throw apiError(400, 'PIN must be exactly four digits.');
      const hashed = changes.pin ? await hashPin(changes.pin) : null;
      return db.runTransaction(async transaction => {
        const accounts = await transaction.get(db.collection('users'));
        const current = accounts.docs.find(doc => doc.id === userId)?.data();
        if (action !== 'create' && !current) throw apiError(404, 'Account no longer exists.');
        const next = { ...current, ...changes, ...(hashed ? { pin: hashed } : {}), uid: userId };
        if (action === 'create' && !hashed) throw apiError(400, 'A four-digit PIN is required.');
        if (action !== 'delete' && (typeof next.name !== 'string' || !next.name.trim() || next.name.length > 100 || !['owner', 'staff'].includes(next.role) || (next.role === 'staff' && !shops.includes(next.shop)) || (next.active !== undefined && typeof next.active !== 'boolean'))) throw apiError(400, 'Enter a valid account name, role, and branch.');
        const owners = accounts.docs.filter(doc => doc.data().role === 'owner' && doc.data().active !== false);
        if (current?.role === 'owner' && current.active !== false && (action === 'delete' || next.role !== 'owner' || next.active === false) && owners.length <= 1) throw apiError(400, 'Keep at least one active owner.');
        if (userId === actor.uid && (action === 'delete' || next.role !== 'owner' || next.active === false)) throw apiError(400, 'An owner cannot remove their own access.');
        const ref = db.collection('users').doc(userId);
        if (action === 'delete') { transaction.delete(ref); return null; }
        const { uid: _uid, ...stored } = next;
        transaction.set(ref, { ...stored, name: next.name.trim(), updatedAt: new Date().toISOString() });
        return { ...next, name: next.name.trim() };
      });
    },
  };
}

export function productionStore(root = process.cwd()) {
  if (!getApps().length) {
    const localKey = resolve(root, 'kvs-traders-firebase-adminsdk-fbsvc-d9eae37959.json');
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) : process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : existsSync(localKey) ? cert(JSON.parse(readFileSync(localKey, 'utf8'))) : applicationDefault();
    initializeApp({ credential });
  }
  return createStore(getFirestore());
}
