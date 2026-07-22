# Agent: Linux Data, Sync & Security

> **Role**: Build the local SQLite database, sync engine, network monitor, and IPC handlers for the Linux Electron app.
> **Prerequisites**: Electron setup and UI agents complete.
> **Reference**: `../ARCHITECTURE.md` §5, §7, §12. See `../windows-app/agent-windows-data-sync.md` for baseline.

---

## Deliverables

1. `src/main/database.ts` — local SQLite database (identical to Windows)
2. `src/main/syncService.ts` — sync engine (identical to Windows)
3. `src/main/networkMonitor.ts` — network monitoring (identical to Windows)
4. `src/main/ipcHandlers.ts` — IPC handlers (identical to Windows + Linux tray sync)

---

## Key Instruction

**Copy ALL code exactly from `../windows-app/agent-windows-data-sync.md`** for these files:
- `src/main/database.ts` — copy verbatim
- `src/main/syncService.ts` — copy verbatim
- `src/main/networkMonitor.ts` — copy verbatim
- `src/main/ipcHandlers.ts` — copy verbatim, THEN apply the Linux-specific modification below

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
13. Start with `--hidden` flag → app starts in tray, hidden
14. `npm run package` → produces `.AppImage` and `.deb` in `dist-electron/`
15. AppImage: `chmod +x` and run → app works
16. `.deb` install: `sudo dpkg -i` → app appears in application launcher
17. App appears in system search (GNOME/KDE Activities, application menu)

> **Linux app is complete.** All three Linux agents have delivered their components.
