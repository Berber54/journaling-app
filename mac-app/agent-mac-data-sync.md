# Agent: Mac Data, Sync & Security

> **Role**: Build the local SQLite database, sync engine, network monitor, and IPC handlers for the macOS Electron app.
> **Prerequisites**: Electron setup and UI agents complete.
> **Reference**: `../ARCHITECTURE.md` §5, §7, §12. See `../windows-app/agent-windows-data-sync.md` for baseline — this file documents Mac-specific differences.

---

## Deliverables

1. `src/main/database.ts` — local SQLite database (identical to Windows)
2. `src/main/syncService.ts` — sync engine (identical to Windows)
3. `src/main/networkMonitor.ts` — network monitoring (identical to Windows)
4. `src/main/ipcHandlers.ts` — IPC handlers (identical to Windows + Mac dock badge)

---

## Key Instruction

**Copy ALL code exactly from `../windows-app/agent-windows-data-sync.md`** for these files:
- `src/main/database.ts` — copy verbatim
- `src/main/syncService.ts` — copy verbatim
- `src/main/networkMonitor.ts` — copy verbatim
- `src/main/ipcHandlers.ts` — copy verbatim, THEN apply the Mac-specific modification below

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
10. `npm run package` → produces `.dmg` in `dist-electron/`

> **macOS app is complete.** All three Mac agents have delivered their components.
