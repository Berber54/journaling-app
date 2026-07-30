import {
  getPendingSyncEntries,
  upsertFromServer,
  markEntriesSynced,
  getConfig,
  setConfig,
  getPendingSyncCount,
  getPendingSyncMedia,
  getPendingMediaCount,
  getPendingTransferCount,
  upsertMediaFromServer,
  markMediaSynced,
} from './database.js';
import { transferMedia } from './mediaTransfer.js';
import type {
  AuthResponse,
  MediaTransferProgress,
  SyncRequest,
  SyncResponse,
  SyncStatus,
} from '../shared/types.js';

// ─── Sync State ──────────────────────────────────────────────

let isSyncing = false;
let statusCallback: ((status: SyncStatus) => void) | null = null;
let journalsChangedCallback: (() => void) | null = null;
let currentTransfer: MediaTransferProgress | null = null;

export function onStatusChange(callback: (status: SyncStatus) => void): void {
  statusCallback = callback;
}

// Fired after a sync pulls entries down from the server so the renderer can
// re-query its local DB. Without this, entries created on another device (or
// pulled on first login) wouldn't appear in the UI until the app restarts.
export function onJournalsChanged(callback: () => void): void {
  journalsChangedCallback = callback;
}

function emitStatus(): void {
  if (statusCallback) {
    statusCallback(getSyncStatus());
  }
}

export function getSyncStatus(): SyncStatus {
  return {
    online: isOnline,
    lastSync: getConfig('last_sync_timestamp'),
    pendingCount: getPendingSyncCount() + getPendingMediaCount(),
    syncing: isSyncing,
    pendingMediaCount: getPendingTransferCount(),
    transfer: currentTransfer,
  };
}

// ─── Network State ───────────────────────────────────────────

let isOnline = false;

export function setOnlineStatus(online: boolean): void {
  const wasOffline = !isOnline;
  isOnline = online;
  emitStatus();

  // Trigger sync when coming back online
  if (online && wasOffline) {
    console.log('[sync] Back online — triggering sync');
    sync().catch(err => console.error('[sync] Auto-sync failed:', err));
  }
}

// ─── API Helpers ─────────────────────────────────────────────

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const serverUrl = getConfig('server_url');
  if (!serverUrl) throw new Error('Server URL not configured');

  const token = getConfig('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle expired token
  if (response.status === 401) {
    const refreshed = await refreshAuthToken();
    if (refreshed) {
      headers['Authorization'] = `Bearer ${getConfig('auth_token')}`;
      return fetch(url, { ...options, headers });
    }
    throw new Error('Authentication expired. Please login again in Settings.');
  }

  return response;
}

async function refreshAuthToken(): Promise<boolean> {
  try {
    const serverUrl = getConfig('server_url');
    const token = getConfig('auth_token');
    if (!serverUrl || !token) return false;

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (response.ok) {
      const data: AuthResponse = await response.json();
      setConfig('auth_token', data.token);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Retry Helper ────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.log(`[sync] Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ─── Main Sync Function ─────────────────────────────────────

/**
 * One sync is two phases:
 *
 *   1. Metadata — entries and media records go up and down in a single JSON
 *      request. These are small, so there is nothing to batch: a media record is
 *      a couple of hundred bytes whether it describes a thumbnail or a film.
 *   2. Bytes — any photo or video that is on one side and not the other is
 *      transferred over /api/media, resumably, a chunk at a time.
 *
 * Phase 1 first, always: the transfer layer needs both ends to agree on what
 * files are supposed to exist before it can move any of them.
 */
export async function sync(): Promise<{ success: boolean; message: string }> {
  if (isSyncing) return { success: false, message: 'Sync already in progress' };
  if (!isOnline) return { success: false, message: 'Offline' };

  const serverUrl = getConfig('server_url');
  const token = getConfig('auth_token');
  if (!serverUrl || !token) {
    return { success: false, message: 'Not configured — set up server connection in Settings' };
  }

  isSyncing = true;
  emitStatus();

  try {
    // ─── Phase 1: metadata ───────────────────────────────────
    const result = await withRetry(async () => {
      const lastSyncTimestamp = getConfig('last_sync_timestamp');
      const pendingEntries = getPendingSyncEntries();
      const pendingMedia = getPendingSyncMedia();

      const syncRequest: SyncRequest = {
        lastSyncTimestamp,
        entries: pendingEntries,
        // Present even when empty: it is how the server knows this client speaks
        // v2 and should be answered with media records rather than base64.
        media: pendingMedia,
      };

      const response = await apiFetch('/sync', {
        method: 'POST',
        body: JSON.stringify(syncRequest),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({} as any));
        throw new Error(error.message || `Sync failed with status ${response.status}`);
      }

      const syncResponse: SyncResponse = await response.json();

      if (syncResponse.media === undefined) {
        // A v1 server silently drops the media field. Nothing here will work
        // until it is upgraded, and saying so beats syncing entries in silence
        // while every photo and video quietly stays put.
        throw new Error(
          'Server is running an older version that cannot sync photos or video — update the server'
        );
      }

      for (const entry of syncResponse.entries) {
        upsertFromServer(entry);
      }

      for (const record of syncResponse.media) {
        upsertMediaFromServer(record);
      }

      if (pendingEntries.length > 0) {
        markEntriesSynced(pendingEntries.map((e) => e.id));
      }

      if (pendingMedia.length > 0) {
        markMediaSynced(pendingMedia.map((m) => m.id));
      }

      setConfig('last_sync_timestamp', syncResponse.serverTimestamp);

      return {
        sent: pendingEntries.length,
        sentMedia: pendingMedia.length,
        received: syncResponse.entries.length,
        receivedMedia: syncResponse.media.length,
        conflicts: syncResponse.conflicts.length,
      };
    });

    // ─── Phase 2: bytes ──────────────────────────────────────
    // Deliberately outside withRetry: each transfer already resumes from where
    // it stopped, so retrying the whole pass would only repeat that work.
    const transfer = await transferMedia(apiFetch, (progress) => {
      currentTransfer = progress;
      emitStatus();
    });
    currentTransfer = null;

    console.log(
      `[sync] Complete: sent=${result.sent} entries/${result.sentMedia} media, ` +
        `received=${result.received} entries/${result.receivedMedia} media, ` +
        `conflicts=${result.conflicts}, files up=${transfer.uploaded} down=${transfer.downloaded}` +
        (transfer.deferred > 0 ? `, ${transfer.deferred} deferred` : '') +
        (transfer.rejected.length > 0 ? `, ${transfer.rejected.length} rejected` : '')
    );

    isSyncing = false;
    emitStatus();

    // Tell the renderer to reload whenever anything arrived — including bytes,
    // so a video that has just finished downloading starts playing instead of
    // staying a placeholder.
    const arrived = result.received > 0 || result.receivedMedia > 0 || transfer.downloaded > 0;
    if (arrived && journalsChangedCallback) {
      journalsChangedCallback();
    }

    if (transfer.rejected.length > 0) {
      return {
        success: false,
        message:
          `Synced ${result.sent} sent, ${result.received} received — ` +
          `${transfer.rejected.length} file(s) the server would not accept ` +
          `(over its per-file limit)`,
      };
    }

    return {
      success: true,
      message:
        `Synced: ${result.sent} sent, ${result.received} received` +
        (transfer.uploaded + transfer.downloaded > 0
          ? `, ${transfer.uploaded + transfer.downloaded} file(s) transferred`
          : '') +
        (transfer.deferred > 0 ? `, ${transfer.deferred} still to transfer` : ''),
    };
  } catch (err: any) {
    console.error('[sync] Failed:', err.message);
    currentTransfer = null;
    isSyncing = false;
    emitStatus();
    return { success: false, message: err.message };
  }
}

// ─── Auth Functions ──────────────────────────────────────────

export async function login(serverUrl: string, username: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Login failed');
  }

  const data: AuthResponse = await response.json();
  setConfig('server_url', serverUrl);
  setConfig('auth_token', data.token);
  setConfig('auth_user_id', data.userId);
  setConfig('username', username);

  // Trigger initial sync
  setTimeout(() => sync().catch(console.error), 500);

  return data;
}

export async function register(serverUrl: string, username: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Registration failed');
  }

  const data: AuthResponse = await response.json();
  setConfig('server_url', serverUrl);
  setConfig('auth_token', data.token);
  setConfig('auth_user_id', data.userId);
  setConfig('username', username);

  // Push any entries written before the account existed (and pull anything the
  // server already has for this account).
  setTimeout(() => sync().catch(console.error), 500);

  return data;
}
