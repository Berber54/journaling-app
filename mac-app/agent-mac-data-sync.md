# Agent: Mac Data, Sync & Security

> **Role**: Build the local SQLite database, sync engine, network monitor, and IPC handlers for the macOS Electron app.
> **Prerequisites**: Electron setup and UI agents complete.
> **Reference**: `../ARCHITECTURE.md` §5, §7, §12. **The Windows app (`../windows-app/src/main/`) is the reference implementation** — copy shared files verbatim from there; this file documents Mac-specific differences only.

---

## Deliverables

1. `src/main/database.ts` — local SQLite database (identical to Windows)
2. `src/main/syncService.ts` — sync engine (identical to Windows)
3. `src/main/networkMonitor.ts` — network monitoring (identical to Windows)
4. `src/main/ipcHandlers.ts` — IPC handlers (identical to Windows + Mac dock badge)
5. `src/main/llmService.ts` — AI Assistant / OpenAI client (identical to Windows)
6. `src/main/biometric.ts` — biometric unlock (**Mac-specific: Touch ID** — see below)

---

## Key Instruction

**Copy ALL code exactly from the Windows source (`../windows-app/src/main/`)** for these files:
- `src/main/database.ts` — copy verbatim
- `src/main/syncService.ts` — copy verbatim
- `src/main/networkMonitor.ts` — copy verbatim
- `src/main/llmService.ts` — copy verbatim (platform-agnostic; just calls the OpenAI HTTP API)
- `src/main/ipcHandlers.ts` — copy verbatim, THEN apply the Mac-specific modification below
- `src/main/biometric.ts` — **do NOT copy verbatim**; the Windows version drives Windows Hello via PowerShell. Replace it with the Touch ID implementation below (same exported function signatures, so `ipcHandlers.ts` works unchanged).

---

## Mac-Specific Modification: Dock Badge

In **`src/main/ipcHandlers.ts`**, add dock badge support for unsynced entries.

Add this import at the top:

```typescript
import { app } from 'electron';
```

Then modify the `onStatusChange` callback (inside `registerIpcHandlers`) to also update the dock badge:

```typescript
  // Forward sync status changes to renderer
  onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:on-status-change', status);
    }

    // ─── Mac-specific: Update dock badge with pending count ───
    if (process.platform === 'darwin' && app.dock) {
      if (status.pendingCount > 0) {
        app.dock.setBadge(status.pendingCount.toString());
      } else {
        app.dock.setBadge('');
      }
    }
  });
```

---

## Mac-Specific: Touch ID (`src/main/biometric.ts`)

The Windows app unlocks with Windows Hello (driven through PowerShell/WinRT). The macOS equivalent is **Touch ID**, which Electron exposes natively via `systemPreferences` — far simpler than the Windows path. Create **`src/main/biometric.ts`** with the same two exported functions the rest of the app expects (`checkBiometricAvailability`, `verifyBiometric`), so `ipcHandlers.ts` and the preload/renderer are identical to Windows:

```typescript
import { systemPreferences } from 'electron';

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
```

> **Note**: `promptTouchID` requires the `NSFaceIDUsageDescription`/Touch ID entitlement context; the `com.apple.security.*` entitlements already configured in `agent-mac-electron-setup.md` cover the hardened-runtime requirements. No extra IPC wiring is needed — `ipcHandlers.ts` already registers `biometric:available` and `biometric:verify` (copied verbatim from Windows).

---

## Final `src/main/index.ts`

The Mac main process file is already complete in `agent-mac-electron-setup.md`. Verify it includes:

1. ✅ `titleBarStyle: 'hiddenInset'` and `trafficLightPosition`
2. ✅ `CommandOrControl+L` shortcut registration (Cmd+L on Mac)
3. ✅ `window-all-closed` handler does NOT quit
4. ✅ `activate` handler re-creates window
5. ✅ Imports and calls `registerIpcHandlers(mainWindow!)`
6. ✅ Imports and calls `startNetworkMonitor()`
7. ✅ `will-quit` handler cleans up shortcuts, network monitor, and database

---

## Verification Checklist

1. `npm run build` — zero TypeScript errors
2. `npm run dev` — app opens with lock screen
3. Set PIN → unlock → create journal entry
4. Cmd+L → app locks
5. Click away from window → app locks
6. Open Settings → connect to server → Login → verify sync fires
7. Create entry offline → reconnect → verify auto-sync
8. Check dock badge: create entries without syncing → badge shows count
9. Close window → app stays in dock → click dock icon → window re-created
10. On a Touch ID Mac: lock → the unlock screen offers Touch ID → verifying unlocks; Cancel falls back to the passphrase
11. Settings → AI Assistant → set OpenAI key → chat panel returns a response
12. `npm run package` → produces `.dmg` in `dist-electron/`

> **macOS app is complete.** All three Mac agents have delivered their components.
