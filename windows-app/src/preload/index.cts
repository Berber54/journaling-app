import { contextBridge, ipcRenderer } from 'electron';
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

  // ─── Images ────────────────────────────────────────────────
  imageAdd: (journalId: string, data: string) => ipcRenderer.invoke('image:add', journalId, data),
  imageList: (journalId: string) => ipcRenderer.invoke('image:list', journalId),
  imageDelete: (id: string) => ipcRenderer.invoke('image:delete', id),

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

  // ─── LLM (OpenAI) ──────────────────────────────────────────
  llmChat: (params) => ipcRenderer.invoke('llm:chat', params),

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
