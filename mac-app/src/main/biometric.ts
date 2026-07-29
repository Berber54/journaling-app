import { systemPreferences } from 'electron';

// ─── Touch ID ────────────────────────────────────────────────
//
// The macOS equivalent of Windows Hello. Electron exposes it natively via
// `systemPreferences`, so no child process or native module is needed.
//
// Everything here is best-effort: any failure resolves to `false` so the
// passphrase path always remains as a fallback.

// Is Touch ID set up and usable on this Mac right now?
export async function checkBiometricAvailability(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    return systemPreferences.canPromptTouchID();
  } catch {
    return false;
  }
}

// Show the Touch ID prompt; resolve true only on successful verification.
// Any cancel/error → false, so the passphrase path always remains a fallback.
export async function verifyBiometric(reason = 'Unlock your journal'): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  try {
    await systemPreferences.promptTouchID(reason);
    return true;
  } catch {
    return false;
  }
}
