import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  memoryLocalCache,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';

// Public web client config (same as Firebase Console). Env vars override when set.
// Without this fallback, a missing .env (e.g. on another machine) connects nowhere → empty Firestore.
const FIREBASE_PUBLIC = {
  apiKey: 'AIzaSyCn3kh5xJJcMxYMjvxXPeaS2bf3dpVfM14',
  authDomain: 'kvs-traders.firebaseapp.com',
  projectId: 'kvs-traders',
  storageBucket: 'kvs-traders.firebasestorage.app',
  messagingSenderId: '78981430758',
  appId: '1:78981430758:web:5147a76417dbee723f2a27',
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || FIREBASE_PUBLIC.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || FIREBASE_PUBLIC.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || FIREBASE_PUBLIC.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || FIREBASE_PUBLIC.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || FIREBASE_PUBLIC.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || FIREBASE_PUBLIC.appId,
};

const app = initializeApp(firebaseConfig);

// Memory cache avoids stale IndexedDB snapshots (sometimes showed 0 users after fixing config).
const db = initializeFirestore(app, { localCache: memoryLocalCache() });

export { db, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy };
export default app;
