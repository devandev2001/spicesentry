import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';

const PIN_LENGTH = 4;

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('name');
  const pinRefs = useRef([]);
  const cardRef = useRef(null);

  const scrollCardIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  // Do not focus PIN fields on step change — on phones that opens the keyboard immediately.
  useEffect(() => {
    if (step === 'pin') scrollCardIntoView();
  }, [step, scrollCardIntoView]);

  // When mobile keyboard opens, keep the form visible (iOS / Android)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => scrollCardIntoView();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, [scrollCardIntoView, step]);

  const handleNameSubmit = (e) => {
    e.preventDefault();
    if (!username.trim()) return;
    setError('');
    setStep('pin');
    setPin('');
  };

  const handlePinChange = (idx, value) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = pin.split('');
    newPin[idx] = value.slice(-1);
    const joined = newPin.join('').slice(0, PIN_LENGTH);
    setPin(joined);
    setError('');

    if (value && idx < PIN_LENGTH - 1) {
      pinRefs.current[idx + 1]?.focus();
    }
    if (joined.length === PIN_LENGTH) {
      doLogin(joined);
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
    setPin(text);
    setError('');
    setSubmitting(true);
    login(username.trim(), text)
      .then((result) => {
        if (!result.ok) {
          setError(result.error);
          setPin('');
        }
      })
      .catch(() => {
        setError('Connection failed. Check internet.');
        setPin('');
      })
      .finally(() => setSubmitting(false));
  };

  const doLogin = async (enteredPin) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await login(username.trim(), enteredPin);
      if (!result.ok) {
        setError(result.error);
        setPin('');
      }
    } catch (err) {
      setError('Connection failed. Check internet.');
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    setStep('name');
    setPin('');
    setError('');
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

          {step === 'name' ? (
            <form onSubmit={handleNameSubmit} className="login-form" autoComplete="on">
              <label className="login-label" htmlFor="login-username">Your Name</label>
              <input
                id="login-username"
                name="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your name..."
                className="login-input"
                autoComplete="username"
                autoCapitalize="words"
                enterKeyHint="next"
                inputMode="text"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={!username.trim()}
                className="login-btn"
              >
                Continue
              </button>
            </form>
          ) : (
            <div className="login-form">
              <button type="button" onClick={goBack} className="login-back-btn">
                &larr; <span className="login-back-name">{username}</span>
              </button>
              <label className="login-label" id="login-pin-label">Enter PIN</label>
              <div
                className="pin-input-row"
                onPaste={handlePinPaste}
                role="group"
                aria-labelledby="login-pin-label"
              >
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <input
                    key={i}
                    ref={el => { pinRefs.current[i] = el; }}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={1}
                    value={pin[i] || ''}
                    onChange={e => handlePinChange(i, e.target.value)}
                    onKeyDown={e => handlePinKeyDown(i, e)}
                    onFocus={scrollCardIntoView}
                    className={`pin-box ${pin[i] ? 'filled' : ''} ${error ? 'error' : ''}`}
                    disabled={submitting}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    aria-label={`PIN digit ${i + 1} of ${PIN_LENGTH}`}
                    enterKeyHint={i === PIN_LENGTH - 1 ? 'go' : 'next'}
                  />
                ))}
              </div>
            {submitting && (
              <div className="login-spinner">
                <div className="spinner" />
                <span>Verifying...</span>
              </div>
            )}
          </div>
        )}

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
