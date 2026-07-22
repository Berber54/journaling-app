# Agent: Linux Electron Setup

> **Role**: Set up the Electron + React + TypeScript project skeleton for Linux.
> **Prerequisites**: Node.js 20+ and npm installed on the Linux dev machine.
> **Reference**: `../ARCHITECTURE.md` §9.2, §10, §12, §13. See `../windows-app/agent-windows-electron-setup.md` for the baseline.

---

## Deliverables

1. `package.json` — project manifest (Linux build target)
2. `tsconfig.json` / `tsconfig.main.json` / `tsconfig.renderer.json`
3. `vite.config.ts`
4. `electron-builder.yml` — Linux AppImage/deb config
5. `src/main/index.ts` — main process with Alt+L, tray icon, .desktop integration
6. `src/preload/index.ts` — preload script (identical to Windows)
7. `src/shared/types.ts` — shared types (identical to Windows)
8. `custom-journal.desktop` — freedesktop .desktop entry

---

## Step 1: package.json

```json
{
  "name": "custom-journal-linux",
  "version": "1.0.0",
  "description": "Custom Journal — Linux Desktop App",
  "main": "dist/main/index.js",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:renderer\" \"npm run dev:main\"",
    "dev:renderer": "vite",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "build": "tsc -p tsconfig.main.json && vite build",
    "package": "npm run build && electron-builder --linux",
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

## Step 2: TypeScript Configs & Vite

Identical to Windows. Create **`tsconfig.json`**, **`tsconfig.main.json`**, **`tsconfig.renderer.json`**, and **`vite.config.ts`** with the same content as `../windows-app/agent-windows-electron-setup.md` Steps 2–3.

---

## Step 3: Electron Builder — Linux Specific

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

linux:
  target:
    - target: AppImage
      arch:
        - x64
        - arm64
    - target: deb
      arch:
        - x64
        - arm64
  icon: build/icons
  category: Office
  desktop:
    Name: Custom Journal
    Comment: Private journaling app with sync
    Categories: Office;Utility;
    StartupWMClass: custom-journal-linux
  artifactName: "${productName}-${version}-linux-${arch}.${ext}"

extraMetadata:
  main: dist/main/index.js
```

### Creating Linux Icons

Create a `build/icons/` directory with PNG icons in the required sizes:

```bash
mkdir -p build/icons

# If you have a 512x512 source icon:
# Using ImageMagick (install with: sudo apt install imagemagick):
for size in 16 32 48 64 128 256 512; do
  convert build/icon.png -resize ${size}x${size} build/icons/${size}x${size}.png
done
```

The directory structure should be:
```
build/icons/
├── 16x16.png
├── 32x32.png
├── 48x48.png
├── 64x64.png
├── 128x128.png
├── 256x256.png
└── 512x512.png
```

---

## Step 4: Desktop Entry File

Create **`custom-journal.desktop`**:

```ini
[Desktop Entry]
Name=Custom Journal
Comment=Private journaling app with sync
Exec=custom-journal %U
Icon=custom-journal
Type=Application
Categories=Office;Utility;
StartupWMClass=custom-journal-linux
StartupNotify=true
Terminal=false
```

> **Note**: When packaged as an AppImage or .deb, electron-builder handles desktop integration automatically via the `linux.desktop` config in `electron-builder.yml`. This standalone `.desktop` file is for manual installation or development.

---

## Step 5: Shared Types & Preload

Create **`src/shared/types.ts`** and **`src/preload/index.ts`** — identical to Windows. Copy from `../windows-app/agent-windows-electron-setup.md` Steps 5–6.

---

## Step 6: Main Process — Linux Specific

Create **`src/main/index.ts`**:

```typescript
import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { startNetworkMonitor, stopNetworkMonitor } from './networkMonitor.js';
import { closeDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// ─── Linux-specific: Set WM_CLASS for proper desktop integration ──
app.setName('Custom Journal');
// Note: app.setAppUserModelId is Windows-only; not needed on Linux

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true, // Standard window frame on Linux
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icons', '256x256.png'),
    show: false,
    title: 'Custom Journal',
  });

  mainWindow.once('ready-to-show', () => {
    // ─── Linux-specific: support --hidden flag for autostart ──
    if (process.argv.includes('--hidden')) {
      // Start minimized to tray
      mainWindow?.hide();
    } else {
      mainWindow?.show();
    }
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

  // ─── Linux-specific: minimize to tray on close ─────────────
  mainWindow.on('close', (event) => {
    if (tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── Linux-specific: System Tray ─────────────────────────────

function createTray(): void {
  const iconPath = path.join(__dirname, '..', '..', 'build', 'icons', '32x32.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('Custom Journal');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    {
      label: 'Sync Now',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync:trigger-from-tray');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray?.destroy();
        tray = null;
        globalShortcut.unregisterAll();
        stopNetworkMonitor();
        closeDatabase();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to show/hide
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// ─── App Lifecycle ───────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Register global shortcut: Alt+L to lock
  globalShortcut.register('Alt+L', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
      mainWindow.show();
      mainWindow.focus();
    }
  });

  registerIpcHandlers(mainWindow!);
  startNetworkMonitor();
});

app.on('window-all-closed', () => {
  // On Linux, quit unless tray is active
  if (!tray) {
    globalShortcut.unregisterAll();
    stopNetworkMonitor();
    closeDatabase();
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
});
```

Key differences from Windows:
- **System tray**: Tray icon with Show/Hide, Sync Now, and Quit menu
- **Close to tray**: Window hides instead of closing when tray is active
- **`--hidden` flag**: Supports starting minimized to tray for autostart
- **WM_CLASS**: Set via `app.setName()` for desktop integration
- **Standard frame**: `frame: true`, no hidden titlebar (Linux WMs handle this)
- **Alt+L**: Same as Windows (`Alt+L`, not `CommandOrControl+L`)
- **Icon path**: Uses PNG icons directory instead of .ico or .icns

---

## Step 7: XDG Autostart Desktop File (Optional)

To enable autostart on login, create this file at `~/.config/autostart/custom-journal.desktop`:

```ini
[Desktop Entry]
Name=Custom Journal
Comment=Private journaling app (autostart)
Exec=/path/to/custom-journal --hidden
Icon=custom-journal
Type=Application
X-GNOME-Autostart-enabled=true
StartupWMClass=custom-journal-linux
Terminal=false
Hidden=false
```

> **Note**: The `--hidden` flag starts the app minimized to the system tray. The path should be updated to wherever the AppImage or installed binary is located. This can be toggled in Settings (stretch goal).

---

## Verification Checklist

1. `npm install` then `npx @electron/rebuild`
2. `npm run dev` — app opens with standard Linux window frame
3. Alt+L → app locks
4. Click away from window → app locks
5. System tray icon appears → right-click shows context menu
6. Click "Show/Hide" in tray → window toggles
7. Close window → app hides to tray (doesn't quit)
8. Click "Quit" in tray → app exits
9. `npm run package` — produces `.AppImage` and `.deb` in `dist-electron/`
10. `.AppImage` is executable and launches correctly
11. App appears in application launcher/search after `.deb` install

> **Next**: Linux UI agent (`agent-linux-ui.md`) and data-sync agent (`agent-linux-data-sync.md`).
