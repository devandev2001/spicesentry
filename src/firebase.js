// The browser uses the authenticated application API. Firebase Admin credentials
// and database authorization remain on the server.
import { api } from './api';

export const db = {};
export const collection = (_db, name) => ({ collection: name });
export const doc = (parent, name, id) => id === undefined ? { ...parent, id: name } : { collection: name, id };
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, direction = 'asc') => ({ kind: 'orderBy', field, direction });
export const limit = count => ({ kind: 'limit', count });
export const query = (ref, ...constraints) => ({ ...ref, constraints });
export const increment = value => ({ __increment: value });
const snapshot = document => ({ id: document?.id, exists: () => !!document, data: () => document?.data });
export async function getDocs(ref) {
  const { documents } = await api('data/query', ref);
  return { docs: documents.map(snapshot) };
}
export async function getDoc(ref) { const { document } = await api('data/get', ref); return snapshot(document); }
export const setDoc = (ref, data, options = {}) => api('data/set', { ...ref, data, merge: options.merge === true, expectedUserId: options.expectedUserId });
export const updateDoc = (ref, data) => setDoc(ref, data, { merge: true });
export const deleteDoc = ref => api('data/delete', ref);
export const commitTransactionRecord = (collection, record, expectedUserId) => api('data/commit', { collection, record, expectedUserId });
