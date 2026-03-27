import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const PIN_MIN = 4;
const PIN_MAX = 6;

export default function LoginPage() {
  const { login } = useAuth();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ambiguousCandidates, setAmbiguousCandidates] = useState(null);
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

  const clearPin = useCallback(() => {
    setPin('');
    setAmbiguousCandidates(null);
  }, []);

  const runLogin = useCallback(
    async (pinStr, nameHint = null) => {
      setSubmitting(true);
      setError('');
      try {
        const result = await login(pinStr, nameHint);
        if (result.ok) {
          setAmbiguousCandidates(null);
          return;
        }
        if (result.needsName && result.candidates?.length) {
          setAmbiguousCandidates(result.candidates);
          setError(result.error || 'Choose your account');
          return;
        }
        setAmbiguousCandidates(null);
        setError(result.error || 'Could not sign in');
        clearPin();
      } catch {
        setError('Connection failed. Check internet.');
        clearPin();
        setAmbiguousCandidates(null);
      } finally {
        setSubmitting(false);
      }
    },
    [login, clearPin],
  );

  const handlePinChange = (idx, value) => {
    if (!/^\d*$/.test(value)) return;
    setAmbiguousCandidates(null);
    setError('');
    if (value) {
      const d = value.slice(-1);
      if (idx > pin.length) {
        pinRefs.current[pin.length]?.focus();
        return;
      }
      const next =
        idx < pin.length ? pin.slice(0, idx) + d + pin.slice(idx + 1) : (pin + d).slice(0, PIN_MAX);
      setPin(next);
      if (idx < PIN_MAX - 1) pinRefs.current[idx + 1]?.focus();
      if (next.length === PIN_MAX) runLogin(next);
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
    const text = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, PIN_MAX);
    if (text.length < PIN_MIN) return;
    setAmbiguousCandidates(null);
    setError('');
    setPin(text);
    requestAnimationFrame(() => {
      const f = Math.min(text.length, PIN_MAX - 1);
      pinRefs.current[f]?.focus();
    });
    runLogin(text);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length < PIN_MIN || submitting) return;
    runLogin(pin);
  };

  const pickCandidate = (name) => {
    if (!pin || pin.length < PIN_MIN || submitting) return;
    runLogin(pin, name);
  };

  const canSubmit = pin.length >= PIN_MIN && pin.length <= PIN_MAX && !submitting;

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
                Enter your {PIN_MIN}–{PIN_MAX}-digit PIN. No name needed unless your team shares the same PIN.
              </p>
            </div>

            <div
              className={`login-pin-shell ${error && !ambiguousCandidates ? 'login-pin-shell--error' : ''}`}
              onPaste={handlePinPaste}
            >
              <div
                className="pin-input-row pin-input-row--six"
                role="group"
                aria-labelledby="login-pin-label"
                aria-describedby="login-pin-desc"
              >
                <span id="login-pin-label" className="sr-only">
                  PIN, {PIN_MIN} to {PIN_MAX} digits
                </span>
                {Array.from({ length: PIN_MAX }).map((_, i) => (
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
                    className={`pin-box pin-box--round ${pin[i] ? 'filled' : ''} ${error && !ambiguousCandidates ? 'error' : ''}`}
                    disabled={submitting}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`Digit ${i + 1} of ${PIN_MAX}`}
                    enterKeyHint={i === PIN_MAX - 1 ? 'go' : 'next'}
                  />
                ))}
              </div>
              <div className="login-pin-meter" aria-hidden="true">
                {Array.from({ length: PIN_MAX }).map((_, i) => (
                  <span key={i} className={`login-pin-dot ${i < pin.length ? 'on' : ''}`} />
                ))}
              </div>
            </div>

            {ambiguousCandidates && ambiguousCandidates.length > 0 && (
              <div className="login-disambig" role="region" aria-label="Choose your account">
                <p className="login-disambig-label">Who are you?</p>
                <div className="login-disambig-chips">
                  {ambiguousCandidates.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="login-disambig-chip"
                      disabled={submitting}
                      onClick={() => pickCandidate(name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <button type="button" className="login-disambig-clear" onClick={clearPin} disabled={submitting}>
                  Clear PIN and start over
                </button>
              </div>
            )}

            <button type="submit" className="login-btn login-btn-pin" disabled={!canSubmit}>
              {submitting ? 'Signing in…' : 'Unlock'}
            </button>

            {submitting && !ambiguousCandidates && (
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
