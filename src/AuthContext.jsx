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
const BIOMETRIC_KEY = 'spicesentry_biometric';
const BIOMETRIC_PROMPTED_KEY = 'spicesentry_biometric_prompted';

const canUseWebAuthn = () =>
  typeof window !== 'undefined' &&
  typeof window.PublicKeyCredential !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  !!navigator.credentials;

const toBase64Url = (buf) => {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const fromBase64Url = (value) => {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

const randomChallenge = (size = 32) => {
  const out = new Uint8Array(size);
  crypto.getRandomValues(out);
  return out;
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [lockoutUntil, setLockoutUntil] = useState(0);
  const [hasBiometricEnrollment, setHasBiometricEnrollment] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
      if (saved && saved.uid && saved.name && saved.role) {
        setUser(saved);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BIOMETRIC_KEY) || 'null');
      setHasBiometricEnrollment(!!saved?.credentialId && !!saved?.session?.uid);
    } catch {
      setHasBiometricEnrollment(false);
    }
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

  const enrollBiometric = useCallback(async (session) => {
    if (!canUseWebAuthn()) return { ok: false, error: 'Biometric not supported on this device.' };
    try {
      const userId = new TextEncoder().encode(session.uid);
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: randomChallenge(),
          rp: { name: 'SpiceSentry' },
          user: {
            id: userId,
            name: session.name || session.uid,
            displayName: session.name || 'SpiceSentry User',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          timeout: 60000,
          authenticatorSelection: {
            userVerification: 'preferred',
            residentKey: 'preferred',
          },
          attestation: 'none',
        },
      });
      if (!credential?.rawId) return { ok: false, error: 'Biometric enrollment cancelled.' };
      localStorage.setItem(
        BIOMETRIC_KEY,
        JSON.stringify({
          credentialId: toBase64Url(credential.rawId),
          session,
          enrolledAt: new Date().toISOString(),
        }),
      );
      localStorage.setItem(BIOMETRIC_PROMPTED_KEY, '1');
      setHasBiometricEnrollment(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Could not enroll biometric.' };
    }
  }, []);

  const biometricLogin = useCallback(async () => {
    if (!canUseWebAuthn()) return { ok: false, error: 'Biometric not supported on this device.' };
    try {
      const saved = JSON.parse(localStorage.getItem(BIOMETRIC_KEY) || 'null');
      if (!saved?.credentialId || !saved?.session?.uid) {
        return { ok: false, error: 'No biometric login configured on this device.' };
      }
      await navigator.credentials.get({
        publicKey: {
          challenge: randomChallenge(),
          allowCredentials: [{ type: 'public-key', id: fromBase64Url(saved.credentialId) }],
          timeout: 60000,
          userVerification: 'preferred',
        },
      });
      setUser(saved.session);
      localStorage.setItem(SESSION_KEY, JSON.stringify(saved.session));
      return { ok: true, user: saved.session };
    } catch (err) {
      return { ok: false, error: err?.message || 'Biometric verification failed.' };
    }
  }, []);

  const clearBiometricEnrollment = useCallback(() => {
    localStorage.removeItem(BIOMETRIC_KEY);
    localStorage.removeItem(BIOMETRIC_PROMPTED_KEY);
    setHasBiometricEnrollment(false);
    return { ok: true };
  }, []);

  const authenticateByPinAndName = useCallback(async (pin, nameHint = null) => {
    if (Date.now() < lockoutUntil) {
      const secs = Math.max(1, Math.ceil((lockoutUntil - Date.now()) / 1000));
      return { ok: false, error: `Too many attempts. Try again in ${secs}s.` };
    }
    const pinStr = String(pin || '').replace(/\D/g, '');
    if (pinStr.length !== 4) return { ok: false, error: 'PIN must be exactly 4 digits' };
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
        const failed = Number(sessionStorage.getItem('spicesentry_failed_login') || '0') + 1;
        sessionStorage.setItem('spicesentry_failed_login', String(failed));
        if (failed >= 5) {
          setLockoutUntil(Date.now() + 60_000);
          sessionStorage.setItem('spicesentry_failed_login', '0');
          return { ok: false, error: 'Too many wrong attempts. Locked for 60 seconds.' };
        }
        return { ok: false, error: 'Wrong PIN' };
      }
      if (!nameHint || !normName(nameHint)) return { ok: false, error: 'Select user before entering PIN' };
      const needle = normName(nameHint);
      const found = matches.find((u) => normName(u.name) === needle) || null;
      if (!found) return { ok: false, error: 'This PIN does not match selected user.' };
      sessionStorage.setItem('spicesentry_failed_login', '0');
      return { ok: true, user: { uid: found.uid, name: found.name, role: found.role, shop: found.shop || null } };
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
  }, [lockoutUntil]);

  /** PIN-only login. Optional nameHint disambiguates when several users share the same PIN. */
  const login = async (pin, nameHint = null) => {
    const result = await authenticateByPinAndName(pin, nameHint);
    if (!result.ok) return result;
    setUser(result.user);
    localStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
    return result;
  };

  const setupBiometric = useCallback(async (pin, nameHint = null) => {
    const result = await authenticateByPinAndName(pin, nameHint);
    if (!result.ok) return result;
    const enrolled = await enrollBiometric(result.user);
    if (!enrolled.ok) return enrolled;
    setUser(result.user);
    localStorage.setItem(SESSION_KEY, JSON.stringify(result.user));
    return { ok: true, user: result.user };
  }, [authenticateByPinAndName, enrollBiometric]);

  const logout = () => {
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
  };

  const addUser = async ({ name, pin, role, shop }) => {
    const uid = name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    const hashed = await hashPin(pin);
    const existing = await getDocs(collection(db, 'users'));
    const dup = existing.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .find((u) => u.active !== false && u.pin === hashed);
    if (dup) throw new Error(`PIN already used by ${dup.name}. Use a unique PIN.`);
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
      const existing = await getDocs(collection(db, 'users'));
      const dup = existing.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .find((u) => u.uid !== uid && u.active !== false && u.pin === payload.pin);
      if (dup) throw new Error(`PIN already used by ${dup.name}. Use a unique PIN.`);
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
      biometricLogin, enrollBiometric, setupBiometric, clearBiometricEnrollment, hasBiometricEnrollment, canUseBiometric: canUseWebAuthn(),
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
