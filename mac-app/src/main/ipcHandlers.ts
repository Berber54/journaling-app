import { ipcMain, BrowserWindow, app } from 'electron';
import bcrypt from 'bcrypt';
import {
  getAllJournals,
  getJournalById,
  createJournal,
  updateJournal,
  deleteJournal,
  getConfig,
  setConfig,
  getAllConfig,
  addMedia,
  getMedia,
  deleteMedia,
} from './database.js';
import { importFile } from './mediaStore.js';
import { sync, login, register, getSyncStatus, onStatusChange, onJournalsChanged } from './syncService.js';
import { checkBiometricAvailability, verifyBiometric } from './biometric.js';
import { chatWithLLM } from './llmService.js';
import type { ChatMessage } from '../shared/types.js';

const BCRYPT_ROUNDS = 12;

// ─── Mac-specific: dock badge showing the unsynced entry count ───
function updateDockBadge(pendingCount: number): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  app.dock.setBadge(pendingCount > 0 ? pendingCount.toString() : '');
}

// Debounce timer for sync-after-save
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSync(): void {
  // Refresh the badge from the new pending count immediately. A sync that is
  // offline or not yet configured returns before it emits a status change, so
  // waiting on onStatusChange alone would leave the badge stale for exactly
  // the case it exists to show: entries written with no server to send them to.
  updateDockBadge(getSyncStatus().pendingCount);

  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    sync().catch(err => console.error('[ipc] Debounced sync failed:', err));
  }, 3000);
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {

  // ─── Journal Handlers ──────────────────────────────────────

  ipcMain.handle('journal:get-all', () => {
    return getAllJournals();
  });

  ipcMain.handle('journal:get-by-id', (_event, id: string) => {
    return getJournalById(id);
  });

  ipcMain.handle('journal:create', (_event, entry: { title: string; content: string; journal_date: string }) => {
    const created = createJournal(entry);
    debouncedSync();
    return created;
  });

  ipcMain.handle('journal:update', (_event, id: string, updates: any) => {
    const updated = updateJournal(id, updates);
    debouncedSync();
    return updated;
  });

  ipcMain.handle('journal:delete', (_event, id: string) => {
    deleteJournal(id);
    debouncedSync();
  });

  // ─── Media Handlers (images + video) ───────────────────────

  // The renderer hands over a path, not bytes: a video has no business crossing
  // the IPC bridge, and copying it here keeps the entry's own copy stable even
  // if the user later moves or deletes the original file.
  ipcMain.handle('media:add', async (_event, journalId: string, sourcePath: string) => {
    const imported = await importFile(sourcePath);
    const media = addMedia(journalId, imported);
    debouncedSync(); // metadata first, then the bytes follow
    return media;
  });

  ipcMain.handle('media:list', (_event, journalId: string) => {
    return getMedia(journalId);
  });

  ipcMain.handle('media:delete', (_event, id: string) => {
    deleteMedia(id);
    debouncedSync(); // propagate the tombstone so it's removed everywhere
  });

  // ─── Sync Handlers ─────────────────────────────────────────

  ipcMain.handle('sync:trigger', async () => {
    return sync();
  });

  ipcMain.handle('sync:get-status', () => {
    return getSyncStatus();
  });

  // Forward sync status changes to renderer
  onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:on-status-change', status);
    }

    // ─── Mac-specific: Update dock badge with pending count ───
    updateDockBadge(status.pendingCount);
  });

  // Tell the renderer to reload its journal list after a sync pulls new data
  onJournalsChanged(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('journal:changed');
    }
  });

  // ─── Lock Handlers ─────────────────────────────────────────

  ipcMain.handle('lock:lock', () => {
    // The renderer listens for 'lock:lock' event via onLockTriggered
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('lock:lock');
    }
  });

  ipcMain.handle('lock:unlock', async (_event, pin: string) => {
    const pinHash = getConfig('pin_hash');
    if (!pinHash) return { success: false };

    const valid = await bcrypt.compare(pin, pinHash);
    return { success: valid };
  });

  ipcMain.handle('lock:set-pin', async (_event, pin: string) => {
    const hash = await bcrypt.hash(pin, BCRYPT_ROUNDS);
    setConfig('pin_hash', hash);
  });

  ipcMain.handle('lock:has-pin', () => {
    return getConfig('pin_hash') !== null;
  });

  ipcMain.handle('lock:is-locked', () => {
    // The lock state is managed in the renderer; this is a fallback
    return true;
  });

  // ─── Biometric Handlers (Touch ID) ─────────────────────────

  ipcMain.handle('biometric:available', () => {
    return checkBiometricAvailability();
  });

  ipcMain.handle('biometric:verify', (_event, reason?: string) => {
    // Bring our window to the foreground first — the Touch ID prompt is
    // presented by our app, so a backgrounded window would leave the user
    // with no visible prompt to respond to.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
    }
    return verifyBiometric(reason);
  });

  // ─── LLM Handlers (OpenAI) ─────────────────────────────────

  ipcMain.handle('llm:chat', async (_event, params: { model: string; messages: ChatMessage[] }) => {
    return chatWithLLM(params.model, params.messages);
  });

  // ─── Settings Handlers ─────────────────────────────────────

  ipcMain.handle('settings:get', (_event, key: string) => {
    return getConfig(key);
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setConfig(key, value);
  });

  ipcMain.handle('settings:get-all', () => {
    return getAllConfig();
  });

  // ─── Auth Handlers ─────────────────────────────────────────

  ipcMain.handle('auth:login', async (_event, serverUrl: string, username: string, password: string) => {
    return login(serverUrl, username, password);
  });

  ipcMain.handle('auth:register', async (_event, serverUrl: string, username: string, password: string) => {
    return register(serverUrl, username, password);
  });

  ipcMain.handle('auth:is-configured', () => {
    const token = getConfig('auth_token');
    const serverUrl = getConfig('server_url');
    return !!(token && serverUrl);
  });

  // ─── Periodic Sync (every 5 minutes) ──────────────────────

  setInterval(() => {
    sync().catch(err => console.error('[ipc] Periodic sync failed:', err));
  }, 5 * 60 * 1000);

  console.log('[ipc] All handlers registered');
}
