import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ElectronAPI } from '../shared/types.js';

const electronAPI: ElectronAPI = {
  // ─── Journals ──────────────────────────────────────────────
  journalGetAll: () => ipcRenderer.invoke('journal:get-all'),
  journalGetById: (id: string) => ipcRenderer.invoke('journal:get-by-id', id),
  journalCreate: (entry) => ipcRenderer.invoke('journal:create', entry),
  journalUpdate: (id, updates) => ipcRenderer.invoke('journal:update', id, updates),
  journalDelete: (id) => ipcRenderer.invoke('journal:delete', id),
  onJournalsChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('journal:changed', handler);
    return () => ipcRenderer.removeListener('journal:changed', handler);
  },

  // ─── Media (images + video) ────────────────────────────────
  mediaAdd: (journalId: string, sourcePath: string) =>
    ipcRenderer.invoke('media:add', journalId, sourcePath),
  mediaList: (journalId: string) => ipcRenderer.invoke('media:list', journalId),
  mediaDelete: (id: string) => ipcRenderer.invoke('media:delete', id),
  // The renderer can't read a path off a File any more (Electron removed
  // File.path), and shouldn't: this hands the main process the path so the bytes
  // never travel through IPC.
  mediaPathForFile: (file: File) => webUtils.getPathForFile(file),

  // ─── Sync ──────────────────────────────────────────────────
  syncTrigger: () => ipcRenderer.invoke('sync:trigger'),
  syncGetStatus: () => ipcRenderer.invoke('sync:get-status'),
  onSyncStatusChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => callback(status);
    ipcRenderer.on('sync:on-status-change', handler);
    return () => ipcRenderer.removeListener('sync:on-status-change', handler);
  },

  // ─── Lock ──────────────────────────────────────────────────
  lock: () => ipcRenderer.invoke('lock:lock'),
  unlock: (pin: string) => ipcRenderer.invoke('lock:unlock', pin),
  setPin: (pin: string) => ipcRenderer.invoke('lock:set-pin', pin),
  hasPin: () => ipcRenderer.invoke('lock:has-pin'),
  isLocked: () => ipcRenderer.invoke('lock:is-locked'),
  onLockTriggered: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('lock:lock', handler);
    return () => ipcRenderer.removeListener('lock:lock', handler);
  },

  // ─── Biometric (Windows Hello) ─────────────────────────────
  biometricAvailable: () => ipcRenderer.invoke('biometric:available'),
  biometricVerify: (reason?: string) => ipcRenderer.invoke('biometric:verify', reason),

  // ─── Export ────────────────────────────────────────────────
  exportRun: (options) => ipcRenderer.invoke('export:run', options),
  exportReveal: (target: string) => ipcRenderer.invoke('export:reveal', target),

  // ─── Settings ──────────────────────────────────────────────
  settingsGet: (key: string) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  settingsGetAll: () => ipcRenderer.invoke('settings:get-all'),

  // ─── Auth ──────────────────────────────────────────────────
  authLogin: (serverUrl, username, password) =>
    ipcRenderer.invoke('auth:login', serverUrl, username, password),
  authRegister: (serverUrl, username, password) =>
    ipcRenderer.invoke('auth:register', serverUrl, username, password),
  authIsConfigured: () => ipcRenderer.invoke('auth:is-configured'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
