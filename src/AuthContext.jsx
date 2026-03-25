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

  const login = async (username, pin) => {
    const normalized = (username || '').trim().replace(/\s+/g, ' ');
    if (!normalized) return { ok: false, error: 'Enter your name' };

    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const allUsers = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

      if (allUsers.length === 0) {
        return {
          ok: false,
          error: 'No users in Firestore. Run: node scripts/setup.mjs (from project folder).',
        };
      }

      const needle = normalized.toLowerCase();
      const found = allUsers.find((u) => {
        const n = (u.name || '').trim().replace(/\s+/g, ' ').toLowerCase();
        return n === needle && u.active !== false;
      });

      if (!found) {
        const hint = allUsers.map((u) => u.name).filter(Boolean).join(', ');
        return {
          ok: false,
          error: hint
            ? `No user "${normalized}". Try: ${hint}`
            : `No user "${normalized}". Ask the owner to add you in CPanel.`,
        };
      }

      const hashed = await hashPin(pin);
      if (found.pin !== hashed) return { ok: false, error: 'Wrong PIN' };

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
