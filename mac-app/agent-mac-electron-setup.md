# Agent: Mac Electron Setup

> **Role**: Set up the Electron + React + TypeScript project skeleton for macOS.
> **Prerequisites**: Node.js 20+ and npm installed on the Mac dev machine.
> **Reference**: `../ARCHITECTURE.md` §9.2, §10, §12, §13. Also see `../windows-app/agent-windows-electron-setup.md` for the baseline — this file documents Mac-specific deviations.

---

## Deliverables

1. `package.json` — project manifest (Mac build target)
2. `tsconfig.json` / `tsconfig.main.json` / `tsconfig.renderer.json`
3. `vite.config.ts`
4. `electron-builder.yml` — macOS DMG packaging config
5. `src/main/index.ts` — main process with Cmd+L, hiddenInset titlebar, dock handling
6. `src/preload/index.ts` — preload script (identical to Windows)
7. `src/shared/types.ts` — shared types (identical to Windows)
8. `entitlements.mac.plist` / `entitlements.mac.inherit.plist` — macOS code signing

---

## Step 1: package.json

```json
{
  "name": "custom-journal-mac",
  "version": "1.0.0",
  "description": "Custom Journal — macOS Desktop App",
  "main": "dist/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:main\"",
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "build": "tsc -p tsconfig.main.json && vite build",
    "package": "npm run build && electron-builder --mac",
    "start": "electron ."
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "better-sqlite3": "^11.7.0",
    "uuid": "^11.0.0",
    "bcrypt": "^5.1.1"
  },
  "devDependencies": {
    "electron": "^33.0.0",
    "electron-builder": "^25.1.0",
    "@electron/rebuild": "^3.7.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/uuid": "^10.0.0",
    "@types/bcrypt": "^5.0.0",
    "concurrently": "^9.1.0"
  }
}
```

---

## Step 2: TypeScript Configs

Identical to Windows. Create **`tsconfig.json`**, **`tsconfig.main.json`**, **`tsconfig.renderer.json`** with the same content as the Windows agent setup file. Copy them exactly from `../windows-app/agent-windows-electron-setup.md` Steps 2.

---

## Step 3: Vite Config

Identical to Windows. Create **`vite.config.ts`** with the same content as `../windows-app/agent-windows-electron-setup.md` Step 3.

---

## Step 4: Electron Builder — macOS Specific

Create **`electron-builder.yml`**:

```yaml
appId: com.customjournal.app
productName: Custom Journal
copyright: Copyright © 2026

directories:
  output: dist-electron
  buildResources: build

files:
  - dist/**/*
  - node_modules/**/*
  - package.json

mac:
  target:
    - target: dmg
      arch:
        - universal
  icon: build/icon.icns
  category: public.app-category.lifestyle
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: entitlements.mac.plist
  entitlementsInherit: entitlements.mac.inherit.plist
  artifactName: "${productName}-${version}-mac.${ext}"

dmg:
  title: "${productName} ${version}"
  background: build/dmg-background.png
  iconSize: 100
  contents:
    - x: 380
      y: 170
      type: link
      path: /Applications
    - x: 130
      y: 170
      type: file

extraMetadata:
  main: dist/main/index.js
```

Create **`entitlements.mac.plist`**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

Create **`entitlements.mac.inherit.plist`**:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.inherit</key>
  <true/>
</dict>
</plist>
```

### Creating .icns Icon

Place a **1024x1024 PNG** named `icon.png` in the `build/` directory. Then generate `.icns`:

```bash
mkdir -p build/icon.iconset
sips -z 16 16     build/icon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     build/icon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     build/icon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   build/icon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   build/icon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   build/icon.png --out build/icon.iconset/icon_512x512.png
sips -z 1024 1024 build/icon.png --out build/icon.iconset/icon_512x512@2x.png
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset
```

---

## Step 5: Shared Types

Create **`src/shared/types.ts`** — identical to Windows. Copy exactly from `../windows-app/agent-windows-electron-setup.md` Step 5.

---

## Step 6: Preload Script

Create **`src/preload/index.ts`** — identical to Windows. Copy exactly from `../windows-app/agent-windows-electron-setup.md` Step 6.

---

## Step 7: Main Process — macOS Specific

Create **`src/main/index.ts`**:

```typescript
import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { startNetworkMonitor, stopNetworkMonitor } from './networkMonitor.js';
import { closeDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    // ─── Mac-specific: hidden titlebar with inset traffic lights ───
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.icns'),
    show: false,
    title: 'Custom Journal',
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Lock on window blur
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
    }
  });

  // Lock on minimize
  mainWindow.on('minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ───────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  // ─── Mac-specific: Cmd+L to lock ──────────────────────────
  // On macOS, 'CommandOrControl+L' maps to Cmd+L
  globalShortcut.register('CommandOrControl+L', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
      mainWindow.show();
      mainWindow.focus();
    }
  });

  registerIpcHandlers(mainWindow!);
  startNetworkMonitor();
});

// ─── Mac-specific: Don't quit when all windows closed ────────
// macOS apps typically stay running in the dock
app.on('window-all-closed', () => {
  // Do NOT call app.quit() on macOS
  // The app stays in the dock
});

// ─── Mac-specific: Re-create window when dock icon clicked ───
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    registerIpcHandlers(mainWindow!);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopNetworkMonitor();
  closeDatabase();
});
```

Key differences from Windows:
- `titleBarStyle: 'hiddenInset'` — hides the native titlebar, keeps traffic lights
- `trafficLightPosition: { x: 15, y: 15 }` — positions traffic lights cleanly
- `CommandOrControl+L` — maps to Cmd+L on macOS
- `window-all-closed` does NOT quit (standard macOS behavior)
- `activate` event re-creates window when dock icon clicked

---

## Verification Checklist

1. `npm install` then `npx @electron/rebuild`
2. `npm run dev` — app opens with hidden titlebar, traffic lights at top-left
3. Cmd+L → app locks
4. Click away → app locks
5. Close window → app stays in dock
6. Click dock icon → window re-created
7. `npm run package` → produces `.dmg` in `dist-electron/`

> **Next**: Mac UI agent (`agent-mac-ui.md`) and data-sync agent (`agent-mac-data-sync.md`).
