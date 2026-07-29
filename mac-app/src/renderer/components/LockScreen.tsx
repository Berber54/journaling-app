import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../styles/lock.css';

interface LockScreenProps {
  hasPin: boolean;
  bioAvailable: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  onSetPin: (password: string) => Promise<void>;
  onBiometric: () => Promise<boolean>;
}

// Any character on the keyboard is allowed — letters, numbers, and symbols.
const MIN_LENGTH = 6;

function LockMark() {
  return (
    <svg width="42" height="42" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 10 V7 a5 5 0 0 1 10 0 V10"
        fill="none"
        stroke="var(--accent-primary)"
        strokeWidth="2.2"
      />
      <rect x="4.5" y="10" width="15" height="11" fill="var(--accent-primary)" />
      <rect x="11" y="14" width="2" height="4" fill="#0e0e12" />
    </svg>
  );
}

export default function LockScreen({ hasPin, bioAvailable, onUnlock, onSetPin, onBiometric }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);
  const [shaking, setShaking] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const triggerShake = useCallback(() => {
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  }, []);

  const handleBiometric = useCallback(async () => {
    if (bioBusy) return;
    setBioBusy(true);
    setError('');
    try {
      const ok = await onBiometric();
      if (!ok) {
        setError('Fingerprint was cancelled. Enter your password or try again.');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    } finally {
      setBioBusy(false);
    }
  }, [bioBusy, onBiometric]);

  // Focus the field on mount. The fingerprint sensor is NOT auto-prompted —
  // the user must press the "Use fingerprint" button to activate it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resetCreate = useCallback(() => {
    setPassword('');
    setConfirm('');
    setIsConfirming(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (loading) return;

    if (hasPin) {
      // ─── Unlock ───
      if (password.length === 0) return;
      setLoading(true);
      const success = await onUnlock(password);
      setLoading(false);
      if (!success) {
        setError('Incorrect password. Try again.');
        triggerShake();
        setPassword('');
        setTimeout(() => inputRef.current?.focus(), 100);
      }
      return;
    }

    // ─── Create password ───
    if (!isConfirming) {
      if (password.length < MIN_LENGTH) {
        setError(`Password must be at least ${MIN_LENGTH} characters.`);
        triggerShake();
        return;
      }
      setError('');
      setIsConfirming(true);
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    // Confirm step
    if (confirm !== password) {
      setError('Passwords do not match. Start over.');
      triggerShake();
      resetCreate();
      return;
    }
    setLoading(true);
    await onSetPin(password);
    setLoading(false);
  }, [loading, hasPin, password, confirm, isConfirming, onUnlock, onSetPin, triggerShake, resetCreate]);

  const currentValue = hasPin ? password : isConfirming ? confirm : password;
  const setCurrentValue = (v: string) => {
    setError('');
    if (hasPin || !isConfirming) setPassword(v);
    else setConfirm(v);
  };

  const submitDisabled =
    loading ||
    (hasPin && password.length === 0) ||
    (!hasPin && !isConfirming && password.length < MIN_LENGTH) ||
    (!hasPin && isConfirming && confirm.length === 0);

  const buttonLabel = loading
    ? 'Please wait…'
    : hasPin
    ? 'Unlock'
    : isConfirming
    ? 'Create Password'
    : 'Continue';

  const subtitle = hasPin
    ? 'Enter your password to unlock'
    : isConfirming
    ? 'Re-enter your password to confirm'
    : `Create a password (min ${MIN_LENGTH} characters — letters, numbers & symbols)`;

  return (
    <div className="lock-overlay">
      <div className="lock-card">
        <div className="lock-logo"><LockMark /></div>
        <h1 className="lock-title">{hasPin ? 'Welcome Back' : 'Set Up Your Password'}</h1>
        <p className="lock-subtitle">{subtitle}</p>

        <div className={`lock-field ${shaking ? 'animate-shake' : ''} ${error ? 'error' : ''}`}>
          <input
            ref={inputRef}
            type={show ? 'text' : 'password'}
            className="lock-input"
            value={currentValue}
            placeholder={hasPin ? 'Password' : isConfirming ? 'Confirm password' : 'New password'}
            onChange={(e) => setCurrentValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="lock-show-toggle"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
            aria-label={show ? 'Hide password' : 'Show password'}
          >
            {show ? 'HIDE' : 'SHOW'}
          </button>
        </div>

        <div className="lock-error">{error}</div>

        <button className="btn btn-primary lock-btn" onClick={handleSubmit} disabled={submitDisabled}>
          {buttonLabel}
        </button>

        {hasPin && bioAvailable && (
          <>
            <div className="lock-divider"><span>or</span></div>
            <button
              type="button"
              className="btn btn-secondary lock-bio-btn"
              onClick={handleBiometric}
              disabled={bioBusy}
            >
              {bioBusy ? 'Waiting for fingerprint…' : 'Use fingerprint'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
