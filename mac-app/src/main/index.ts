import { app, BrowserWindow, globalShortcut, protocol } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { startNetworkMonitor, stopNetworkMonitor } from './networkMonitor.js';
import { closeDatabase } from './database.js';
import { MEDIA_SCHEME_PRIVILEGES, registerMediaProtocol } from './mediaProtocol.js';

// Has to happen before the app is ready, so it sits at module scope.
protocol.registerSchemesAsPrivileged([MEDIA_SCHEME_PRIVILEGES]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

// The window is destroyed when the user closes it and re-created when the dock
// icon is clicked, but `ipcMain.handle()` throws if a channel is registered a
// second time — so the IPC handlers are registered exactly once and given this
// live view of whichever window currently exists.
const activeWindow = new Proxy({} as BrowserWindow, {
  get(_target, prop) {
    if (!mainWindow) {
      // Callers guard with `isDestroyed()` before sending; with no window at
      // all the honest answer is "don't send".
      return prop === 'isDestroyed' ? () => true : undefined;
    }
    const value = (mainWindow as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(mainWindow) : value;
  },
});

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
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
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
  // Before the window exists, so the first paint can already resolve media URLs.
  registerMediaProtocol();

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

  registerIpcHandlers(activeWindow);
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
    // No re-registration: the handlers registered at startup already follow
    // the new window through `activeWindow`.
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopNetworkMonitor();
  closeDatabase();
});

export { mainWindow };
