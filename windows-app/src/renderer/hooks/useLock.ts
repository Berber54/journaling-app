import { useState, useEffect, useCallback } from 'react';

export function useLock() {
  const [locked, setLocked] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [loading, setLoading] = useState(true);
  // True when Windows Hello is usable AND the user hasn't turned it off.
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    const init = async () => {
      const pinExists = await window.electronAPI.hasPin();
      setHasPin(pinExists);

      // Biometric is offered only once a password exists (so there is always
      // a fallback credential) and unless the user explicitly disabled it.
      const osBio = await window.electronAPI.biometricAvailable();
      const pref = await window.electronAPI.settingsGet('biometric_enabled');
      setBioAvailable(osBio && pinExists && pref !== 'false');

      setLocked(true); // Always start locked
      setLoading(false);
    };
    init();

    // Listen for lock events from main process
    const unsubscribe = window.electronAPI.onLockTriggered(() => {
      setLocked(true);
    });

    return unsubscribe;
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    const result = await window.electronAPI.unlock(password);
    if (result.success) {
      setLocked(false);
    }
    return result.success;
  }, []);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    const ok = await window.electronAPI.biometricVerify('Unlock your journal');
    if (ok) setLocked(false);
    return ok;
  }, []);

  const setPin = useCallback(async (password: string) => {
    await window.electronAPI.setPin(password);
    setHasPin(true);
    // A password now exists, so re-evaluate whether Hello can be offered.
    const osBio = await window.electronAPI.biometricAvailable();
    const pref = await window.electronAPI.settingsGet('biometric_enabled');
    setBioAvailable(osBio && pref !== 'false');
    setLocked(false);
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
  }, []);

  return { locked, hasPin, loading, bioAvailable, unlock, unlockWithBiometric, setPin, lock };
}
