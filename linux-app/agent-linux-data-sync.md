# Agent: Linux Data, Sync & Security

> **Role**: Build the local SQLite database, sync engine, network monitor, and IPC handlers for the Linux Electron app.
> **Prerequisites**: Electron setup and UI agents complete.
> **Reference**: `../ARCHITECTURE.md` §5, §7, §12. **The Windows app (`../windows-app/src/main/`) is the reference implementation** — copy shared files verbatim from there; this file documents Linux-specific differences only.

---

## Deliverables

1. `src/main/database.ts` — local SQLite database (identical to Windows)
2. `src/main/syncService.ts` — sync engine (identical to Windows)
3. `src/main/networkMonitor.ts` — network monitoring (identical to Windows)
4. `src/main/ipcHandlers.ts` — IPC handlers (identical to Windows + Linux tray sync)
5. `src/main/exportService.ts` + `src/main/entryText.ts` — journal export (identical to Windows)
6. `src/main/biometric.ts` — biometric unlock (**Linux-specific stub** — see below)

---

## Key Instruction

**Copy ALL code exactly from the Windows source (`../windows-app/src/main/`)** for these files:
- `src/main/database.ts` — copy verbatim
- `src/main/syncService.ts` — copy verbatim
- `src/main/networkMonitor.ts` — copy verbatim
- `src/main/entryText.ts` — copy verbatim (pure string handling, no platform surface at all)
- `src/main/exportService.ts` — copy verbatim (`dialog`, `shell` and `node:fs` only; the save and folder pickers resolve to the GTK/portal dialogs on Linux with no code change)
- `src/main/ipcHandlers.ts` — copy verbatim, THEN apply the Linux-specific modification below
- `src/main/biometric.ts` — **do NOT copy verbatim**; the Windows version drives Windows Hello via PowerShell. Replace it with the Linux stub below (same exported function signatures, so `ipcHandlers.ts` works unchanged).

---

## Linux-Specific Modification: Tray Sync Handler

In **`src/main/ipcHandlers.ts`**, add a handler for the tray "Sync Now" button. Add this inside the `registerIpcHandlers` function, after the existing sync handlers:

```typescript
  // ─── Linux-specific: Handle sync trigger from tray context menu ──
  const { ipcMain: ipc } = require('electron');
  // The tray sends 'sync:trigger-from-tray' when "Sync Now" is clicked
  // Listen for it in the renderer and trigger sync
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.on('ipc-message', (_event: any, channel: string) => {
      if (channel === 'sync:trigger-from-tray') {
        sync().catch(err => console.error('[ipc] Tray sync failed:', err));
      }
    });
  }
```

> **Note**: The tray "Sync Now" button sends a message to the renderer via `webContents.send('sync:trigger-from-tray')`. The main process listens for this in `ipcHandlers.ts` to trigger a sync. Alternatively, you can handle it directly in `src/main/index.ts` by importing and calling `sync()` from the tray menu click handler (which is simpler). The tray setup in `agent-linux-electron-setup.md` already calls `mainWindow.webContents.send('sync:trigger-from-tray')` — you can replace that with a direct `sync()` call:

In **`src/main/index.ts`**, update the tray Sync Now handler to call sync directly:

```typescript
import { sync } from './syncService.js';

// In createTray(), update the Sync Now menu item:
{
  label: 'Sync Now',
  click: () => {
    sync().catch(err => console.error('[tray] Sync failed:', err));
  },
},
```

This is cleaner than routing through IPC.

---

## Linux-Specific: Biometric Stub (`src/main/biometric.ts`)

The Windows app unlocks with Windows Hello, and macOS uses Touch ID. Linux has **no standard, universally available biometric API** (fingerprint support via PAM/fprintd is distro- and hardware-specific and not exposed to Electron). To keep the app **consistent** — same interface, same IPC channels, same renderer — provide a stub that simply reports biometrics as unavailable, so the app cleanly falls back to the passphrase everywhere:

```typescript
// Linux has no standard biometric API (no equivalent to Windows Hello / Touch ID).
// These stubs keep the same interface as the Windows/Mac versions so ipcHandlers.ts,
// the preload, and the renderer are all identical — biometrics simply report
// unavailable and the passphrase path is always used.
export async function checkBiometricAvailability(): Promise<boolean> {
  return false;
}

export async function verifyBiometric(_reason = 'Unlock your journal'): Promise<boolean> {
  return false;
}
```

> **Note**: Because `checkBiometricAvailability()` returns `false`, the renderer never offers a biometric button on Linux — the lock screen shows the passphrase entry only. No IPC or UI changes are needed; `ipcHandlers.ts` still registers `biometric:available` / `biometric:verify` verbatim from Windows.

---

## Final `src/main/index.ts`

The Linux main process file is already complete in `agent-linux-electron-setup.md`. Add the sync import and update the tray handler as shown above. The final version should include:

1. ✅ `frame: true` (standard Linux window frame)
2. ✅ `Alt+L` shortcut registration
3. ✅ System tray with Show/Hide, Sync Now, Quit
4. ✅ Close-to-tray behavior
5. ✅ `--hidden` flag support for autostart
6. ✅ Imports and calls `registerIpcHandlers(mainWindow!)`
7. ✅ Imports and calls `startNetworkMonitor()`
8. ✅ `will-quit` handler cleans up everything
9. ✅ Tray "Sync Now" calls `sync()` directly

---

## Verification Checklist

1. `npm run build` — zero TypeScript errors
2. `npm run dev` — app opens with lock screen
3. Set PIN → unlock → create journal entry
4. Alt+L → app locks
5. Click away from window → app locks
6. System tray icon appears with context menu
7. Tray → "Sync Now" triggers sync (check console)
8. Close window → app hides to tray (doesn't quit)
9. Tray → "Show/Hide" toggles window visibility
10. Tray → "Quit" exits the app completely
11. Open Settings → connect to server → Login → verify sync fires
12. Create entry offline → reconnect → verify auto-sync
13. Sidebar → "Export journals" → pick a few entries → Markdown, one file → the file lands where the save dialog said and opens as readable text; repeat with "Include photos and videos" on and confirm the folder holds `media/` with the real files
14. Lock screen shows passphrase entry only (no biometric button — expected on Linux)
15. Start with `--hidden` flag → app starts in tray, hidden
16. `npm run package` → produces `.AppImage` and `.deb` in `dist-electron/`
17. AppImage: `chmod +x` and run → app works
18. `.deb` install: `sudo dpkg -i` → app appears in application launcher
19. App appears in system search (GNOME/KDE Activities, application menu)

> **Linux app is complete.** All three Linux agents have delivered their components.
