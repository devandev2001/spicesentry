import React, { useState, useRef, useEffect } from 'react';
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

  useEffect(() => {
    if (step === 'pin' && pinRefs.current[0]) {
      pinRefs.current[0].focus();
    }
  }, [step]);

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

  const doLogin = async (enteredPin) => {
    setSubmitting(true);
    setError('');
    try {
      const result = await login(username.trim(), enteredPin);
      if (!result.ok) {
        setError(result.error);
        setPin('');
        setTimeout(() => pinRefs.current[0]?.focus(), 100);
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
      <div className="login-glow" />

      <div className="login-card">
        <div className="login-logo">
          <img src="/kvs-logo.png" alt="KVS" />
        </div>
        <h1 className="login-title">KVS Spices</h1>
        <p className="login-subtitle">Spice Inventory Tracker</p>

        {step === 'name' ? (
          <form onSubmit={handleNameSubmit} className="login-form">
            <label className="login-label">Your Name</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Enter your name..."
              className="login-input"
              autoFocus
              autoComplete="username"
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
            <button onClick={goBack} className="login-back-btn">
              &larr; {username}
            </button>
            <label className="login-label">Enter PIN</label>
            <div className="pin-input-row">
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <input
                  key={i}
                  ref={el => pinRefs.current[i] = el}
                  type="password"
                  inputMode="numeric"
                  maxLength={1}
                  value={pin[i] || ''}
                  onChange={e => handlePinChange(i, e.target.value)}
                  onKeyDown={e => handlePinKeyDown(i, e)}
                  className={`pin-box ${pin[i] ? 'filled' : ''} ${error ? 'error' : ''}`}
                  disabled={submitting}
                  autoComplete="off"
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

        {error && <div className="login-error">{error}</div>}
      </div>

      <p className="login-footer">Secured access only</p>
    </div>
  );
}
