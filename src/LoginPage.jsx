import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const PIN_LENGTH = 4;

export default function LoginPage() {
  const { login, setupBiometric, fetchUsers, biometricLogin, canUseBiometric, hasBiometricEnrollment } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bioSubmitting, setBioSubmitting] = useState(false);
  const [bioSetupSubmitting, setBioSetupSubmitting] = useState(false);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const pinRefs = useRef([]);
  const cardRef = useRef(null);

  const scrollCardIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => scrollCardIntoView();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [scrollCardIntoView]);

  useEffect(() => {
    fetchUsers().then((list) => {
      const active = (list || []).filter((u) => u.active !== false);
      setUsers(active);
      if (active.length === 1) setSelectedUser(active[0]);
    });
  }, [fetchUsers]);

  const clearPin = useCallback(() => {
    setPin('');
  }, []);

  const runLogin = useCallback(
    async (pinStr) => {
      setSubmitting(true);
      setError('');
      try {
        if (!selectedUser?.name) {
          setError('Please select who is logging in.');
          return;
        }
        const result = await login(pinStr, selectedUser.name);
        if (result.ok) {
          return;
        }
        setError(result.error || 'Could not sign in');
        clearPin();
      } catch {
        setError('Connection failed. Check internet.');
        clearPin();
      } finally {
        setSubmitting(false);
      }
    },
    [login, clearPin, selectedUser],
  );

  const handlePinChange = (idx, value) => {
    if (!/^\d*$/.test(value)) return;
    setError('');
    if (value) {
      const d = value.slice(-1);
      const next = idx < pin.length ? pin.slice(0, idx) + d + pin.slice(idx + 1) : (pin + d).slice(0, PIN_LENGTH);
      setPin(next);
      if (idx < PIN_LENGTH - 1) pinRefs.current[idx + 1]?.focus();
      if (next.length === PIN_LENGTH) runLogin(next);
    } else if (idx < pin.length) {
      setPin(pin.slice(0, idx) + pin.slice(idx + 1));
      if (idx > 0) pinRefs.current[idx - 1]?.focus();
    }
  };

  const handlePinKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) {
      pinRefs.current[idx - 1]?.focus();
    }
  };

  const handlePinPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (text.length !== PIN_LENGTH) return;
    setError('');
    setPin(text);
    requestAnimationFrame(() => {
      const f = Math.min(text.length, PIN_LENGTH - 1);
      pinRefs.current[f]?.focus();
    });
    runLogin(text);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length !== PIN_LENGTH || submitting) return;
    runLogin(pin);
  };

  const canSubmit = pin.length === PIN_LENGTH && !submitting && !!selectedUser?.name;
  const canUseBioButton = canUseBiometric && hasBiometricEnrollment && !submitting && !bioSubmitting;
  const canSetupBioButton = canUseBiometric && !hasBiometricEnrollment && !submitting && !bioSetupSubmitting && !!selectedUser?.name && pin.length === PIN_LENGTH;

  const handleBiometric = async () => {
    if (!canUseBioButton) return;
    setBioSubmitting(true);
    setError('');
    const result = await biometricLogin();
    if (!result.ok) setError(result.error || 'Biometric verification failed.');
    setBioSubmitting(false);
  };

  const handleSetupBiometric = async () => {
    if (!canSetupBioButton) return;
    setBioSetupSubmitting(true);
    setError('');
    const result = await setupBiometric(pin, selectedUser.name);
    if (!result.ok) setError(result.error || 'Biometric setup failed.');
    setBioSetupSubmitting(false);
  };

  return (
    <div className="login-page">
      <div className="login-glow" aria-hidden="true" />

      <div className="login-scroll" data-login-scroll>
        <div className="login-card" ref={cardRef}>
          <div className="login-logo">
            <img src="/kvs-logo.png" alt="" width={80} height={80} decoding="async" />
          </div>
          <h1 className="login-title">KVS Spices</h1>
          <p className="login-subtitle">Spice Inventory Tracker</p>

          <form onSubmit={handleSubmit} className="login-form login-form-pin" autoComplete="off">
            <div className="login-pin-intro">
              <h2 className="login-pin-heading">Sign in</h2>
              <p className="login-pin-desc" id="login-pin-desc">
                Select who is logging in, then enter 4-digit PIN.
              </p>
            </div>
            <div className="login-disambig" role="region" aria-label="Select user">
              <p className="login-disambig-label">Select User</p>
              <div className="login-disambig-chips">
                {users.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    className="login-disambig-chip"
                    style={selectedUser?.uid === u.uid ? { borderColor: 'var(--amber)', background: 'var(--bg-high)' } : undefined}
                    onClick={() => { setSelectedUser(u); setError(''); }}
                  >
                    {u.role === 'owner' ? `Admin • ${u.name}` : u.name}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`login-pin-shell ${error ? 'login-pin-shell--error' : ''}`}
              onPaste={handlePinPaste}
            >
              <div
                className="pin-input-row"
                role="group"
                aria-labelledby="login-pin-label"
                aria-describedby="login-pin-desc"
              >
                <span id="login-pin-label" className="sr-only">
                  PIN, {PIN_LENGTH} digits
                </span>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      pinRefs.current[i] = el;
                    }}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={pin[i] || ''}
                    onChange={(e) => handlePinChange(i, e.target.value)}
                    onKeyDown={(e) => handlePinKeyDown(i, e)}
                    onFocus={scrollCardIntoView}
                    className={`pin-box ${pin[i] ? 'filled' : ''} ${error ? 'error' : ''}`}
                    disabled={submitting}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${i + 1} of ${PIN_LENGTH}`}
                    enterKeyHint={i === PIN_LENGTH - 1 ? 'go' : 'next'}
                  />
                ))}
              </div>
              <div className="login-pin-meter" aria-hidden="true">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <span key={i} className={`login-pin-dot ${i < pin.length ? 'on' : ''}`} />
                ))}
              </div>
            </div>

            <button type="submit" className="login-btn login-btn-pin" disabled={!canSubmit}>
              {submitting ? 'Signing in…' : 'Unlock'}
            </button>

            {canUseBiometric && !hasBiometricEnrollment && (
              <button
                type="button"
                className="login-btn login-btn-pin"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--rim)', color: 'var(--text-1)', boxShadow: 'none' }}
                disabled={!canSetupBioButton}
                onClick={handleSetupBiometric}
              >
                {bioSetupSubmitting ? 'Setting up…' : 'Set up Face/Fingerprint'}
              </button>
            )}

            {canUseBiometric && hasBiometricEnrollment && (
              <button
                type="button"
                className="login-btn login-btn-pin"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--rim)', color: 'var(--text-1)', boxShadow: 'none' }}
                disabled={!canUseBioButton}
                onClick={handleBiometric}
              >
                {bioSubmitting ? 'Verifying…' : 'Use Face/Fingerprint'}
              </button>
            )}

            {submitting && (
              <div className="login-spinner">
                <div className="spinner" />
                <span>Verifying…</span>
              </div>
            )}
          </form>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <p className="login-footer">Secured access only</p>
      </div>
    </div>
  );
}
