import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { AuthContext } from './auth-context';
import { LEDGER_GENERATION_KEY } from './ledger-cache';

const unsupportedBiometric = async () => ({ ok: false, error: 'Use your PIN to sign in. Biometric login needs server verification.' });

function clearLegacySession() {
  localStorage.removeItem('spicesentry_session');
  localStorage.removeItem('spicesentry_biometric');
}
function prepareAccount(user) {
  // Cached inventory belongs to the last authenticated account. Pending writes
  // already have account-specific keys and must survive sign-out.
  const previous = localStorage.getItem('spicesentry_cache_account');
  if (previous !== user.uid) {
    for (const key of ['spice_entries', 'spice_sales', 'spice_shop_loads']) localStorage.removeItem(key);
  }
  localStorage.setItem('spicesentry_cache_account', user.uid);
  clearLegacySession();
  return user;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  useEffect(() => {
    let cancelled = false;
    clearLegacySession();
    api('auth/session').then(({ user }) => {
      if (!cancelled) setUser(prepareAccount(user));
    }).catch(() => { /* The login screen provides account loading and retry feedback. */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    const expired = () => setUser(null);
    const switchedAccount = event => {
      if (event.key === LEDGER_GENERATION_KEY) window.location.reload();
      if (event.key === 'spicesentry_cache_account') setUser(current => current && current.uid !== event.newValue ? null : current);
    };
    window.addEventListener('spicesentry-session-expired', expired);
    window.addEventListener('storage', switchedAccount);
    return () => { cancelled = true; window.removeEventListener('spicesentry-session-expired', expired); window.removeEventListener('storage', switchedAccount); };
  }, []);
  const fetchUsers = useCallback(async () => {
    const { users } = await api(user?.role === 'owner' ? 'admin/users' : 'auth/users');
    setUsers(users);
    return users;
  }, [user?.role]);
  const login = async (pin, uidOrName) => {
    try {
      const accounts = users.length ? users : (await api('auth/users')).users;
      const selected = accounts.find(account => account.uid === uidOrName) || accounts.find(account => account.name === uidOrName);
      if (!selected) return { ok: false, error: 'Select an available account.' };
      const { user } = await api('auth/login', { uid: selected.uid, pin });
      setUser(prepareAccount(user));
      return { ok: true, user };
    } catch (error) { return { ok: false, error: error.message }; }
  };
  const logout = async () => {
    await api('auth/logout', {});
    clearLegacySession();
    setUser(null);
    setUsers([]);
  };
  const changeUser = async (action, uid, data) => {
    const result = await api('admin/users', { action, uid, data });
    if (result.user?.uid === user?.uid) setUser(result.user);
    await fetchUsers();
  };
  return <AuthContext.Provider value={{
    user, loading, users, isOwner: user?.role === 'owner', login, logout, fetchUsers,
    addUser: data => changeUser('create', undefined, data),
    updateUser: (uid, data) => changeUser('update', uid, data),
    removeUser: uid => changeUser('delete', uid),
    resetPin: (uid, pin) => changeUser('update', uid, { pin }),
    changePin: async (currentPin, newPin) => { const { user } = await api('auth/pin', { currentPin, newPin }); setUser(user); },
    canUseBiometric: false, hasBiometricEnrollment: false,
    biometricLogin: unsupportedBiometric, enrollBiometric: unsupportedBiometric, setupBiometric: unsupportedBiometric,
    clearBiometricEnrollment: async () => { clearLegacySession(); return { ok: true }; },
  }}>{children}</AuthContext.Provider>;
}
