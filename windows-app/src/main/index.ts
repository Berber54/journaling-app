import { app, BrowserWindow, globalShortcut } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { startNetworkMonitor, stopNetworkMonitor } from './networkMonitor.js';
import { closeDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

// Set app user model ID for Windows taskbar grouping and pinning
app.setName('Journal');
app.setAppUserModelId('com.journal.app');

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Needed for better-sqlite3 in preload
    },
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    title: 'Journal',
  });

  // Show window when ready (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load renderer
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // ─── Lock on window blur (focus loss) ────────────────────
  mainWindow.on('blur', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
    }
  });

  // ─── Lock on minimize ────────────────────────────────────
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

  // Register global shortcut: Alt+L to lock
  globalShortcut.register('Alt+L', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
      // Bring window to front so user sees the lock screen
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Register IPC handlers and start network monitor
  registerIpcHandlers(mainWindow!);
  startNetworkMonitor();
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  stopNetworkMonitor();
  closeDatabase();
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

export { mainWindow };
