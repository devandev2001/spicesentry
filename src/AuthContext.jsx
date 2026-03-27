import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { db, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where } from './firebase';

const AuthContext = createContext(null);

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + '_kvs_salt_2026');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const SESSION_KEY = 'spicesentry_session';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (saved && saved.uid && saved.name && saved.role) {
        setUser(saved);
      }
    } catch {}
    setLoading(false);
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      setUsers(list);
      return list;
    } catch (err) {
      console.error('Failed to fetch users:', err);
      return [];
    }
  }, []);

  /** PIN-only login. Optional nameHint disambiguates when several users share the same PIN. */
  const login = async (pin, nameHint = null) => {
    const pinStr = String(pin || '').replace(/\D/g, '');
    if (pinStr.length < 4) return { ok: false, error: 'Enter at least 4 digits' };
    if (pinStr.length > 6) return { ok: false, error: 'PIN must be at most 6 digits' };

    const normName = (s) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();

    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
      const activeUsers = allUsers.filter((u) => u.active !== false);

      if (allUsers.length === 0) {
        return {
          ok: false,
          error:
            'No users in this database. On your computer run: npm run seed — then try again. Also check Firebase Console → Firestore → Data has a "users" collection.',
        };
      }

      const hashed = await hashPin(pinStr);
      const matches = activeUsers.filter((u) => u.pin === hashed);

      if (matches.length === 0) {
        return { ok: false, error: 'Wrong PIN' };
      }

      let found = null;
      if (matches.length === 1) {
        found = matches[0];
      } else if (nameHint && normName(nameHint)) {
        const needle = normName(nameHint);
        found = matches.find((u) => normName(u.name) === needle) || null;
        if (!found) {
          return { ok: false, error: 'That name does not match this PIN. Try another name below.' };
        }
      } else {
        const candidates = [...new Set(matches.map((u) => u.name).filter(Boolean))].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: 'base' }),
        );
        return {
          ok: false,
          needsName: true,
          candidates,
          error: 'This PIN matches more than one person. Tap your name to continue.',
        };
      }

      const session = { uid: found.uid, name: found.name, role: found.role, shop: found.shop || null };
      setUser(session);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return { ok: true, user: session };
    } catch (err) {
      console.error('Login Firestore error:', err);
      if (err?.code === 'permission-denied') {
        return {
          ok: false,
          error: 'Firestore blocked this app. Firebase Console → Firestore → Rules → paste rules from firestore.rules file, then Publish.',
        };
      }
      return { ok: false, error: err?.message || 'Could not reach database' };
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const addUser = async ({ name, pin, role, shop }) => {
    const uid = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const hashed = await hashPin(pin);
    await setDoc(doc(db, 'users', uid), {
      name,
      pin: hashed,
      role: role || 'staff',
      shop: shop || null,
      active: true,
      createdAt: Date.now(),
    });
    await fetchUsers();
  };

  const updateUser = async (uid, updates) => {
    const payload = { ...updates };
    if (updates.pin) {
      payload.pin = await hashPin(updates.pin);
    }
    await updateDoc(doc(db, 'users', uid), payload);
    if (user && user.uid === uid) {
      const newSession = { ...user, ...payload };
      delete newSession.pin;
      setUser(newSession);
      localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    }
    await fetchUsers();
  };

  const removeUser = async (uid) => {
    await deleteDoc(doc(db, 'users', uid));
    await fetchUsers();
  };

  const resetPin = async (uid, newPin) => {
    const hashed = await hashPin(newPin);
    await updateDoc(doc(db, 'users', uid), { pin: hashed });
  };

  const isOwner = user?.role === 'owner';

  return (
    <AuthContext.Provider value={{
      user, loading, isOwner, users,
      login, logout, fetchUsers,
      addUser, updateUser, removeUser, resetPin,
      hashPin,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { hashPin };
