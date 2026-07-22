import { ipcMain, BrowserWindow } from 'electron';
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
  addImage,
  getImages,
  deleteImage,
} from './database.js';
import { sync, login, register, getSyncStatus, onStatusChange } from './syncService.js';
import { checkBiometricAvailability, verifyBiometric } from './biometric.js';
import { chatWithLLM } from './llmService.js';
import type { ChatMessage } from '../shared/types.js';

const BCRYPT_ROUNDS = 12;

// Debounce timer for sync-after-save
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSync(): void {
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

  // ─── Image Handlers ────────────────────────────────────────

  ipcMain.handle('image:add', (_event, journalId: string, data: string) => {
    return addImage(journalId, data);
  });

  ipcMain.handle('image:list', (_event, journalId: string) => {
    return getImages(journalId);
  });

  ipcMain.handle('image:delete', (_event, id: string) => {
    deleteImage(id);
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

  // ─── Biometric Handlers (Windows Hello) ────────────────────

  ipcMain.handle('biometric:available', () => {
    return checkBiometricAvailability();
  });

  ipcMain.handle('biometric:verify', (_event, reason?: string) => {
    // Bring our window to the foreground first. Windows grants the child
    // PowerShell process the right to foreground the Hello prompt only when
    // it is spawned by the current foreground process — this guarantees that.
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
