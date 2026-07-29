import {
  getPendingSyncEntries,
  upsertFromServer,
  markEntriesSynced,
  getConfig,
  setConfig,
  getPendingSyncCount,
  getPendingSyncImages,
  getPendingImageCount,
  upsertImageFromServer,
  markImagesSynced,
  IMAGE_BATCH_BYTES,
} from './database.js';
import type { AuthResponse, SyncRequest, SyncResponse, SyncStatus } from '../shared/types.js';

// ─── Sync State ──────────────────────────────────────────────

let isSyncing = false;
let statusCallback: ((status: SyncStatus) => void) | null = null;
let journalsChangedCallback: (() => void) | null = null;

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
    pendingCount: getPendingSyncCount() + getPendingImageCount(),
    syncing: isSyncing,
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

// Images upload a batch at a time (see IMAGE_BATCH_BYTES), so one sync makes as
// many round trips as it takes to drain the queue. Bounded so a client that
// keeps being handed work can still finish and report.
const MAX_SYNC_ROUNDS = 50;

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

  // Both live outside withRetry so a retried attempt keeps what the previous
  // one learned about what this server will accept.
  let batchBytes = IMAGE_BATCH_BYTES;
  const skippedImageIds = new Set<string>();

  try {
    const result = await withRetry(async () => {
      const totals = { sent: 0, sentImages: 0, received: 0, receivedImages: 0, conflicts: 0 };

      for (let round = 0; round < MAX_SYNC_ROUNDS; round++) {
        const lastSyncTimestamp = getConfig('last_sync_timestamp');
        const pendingEntries = getPendingSyncEntries();
        const pendingImages = getPendingSyncImages(batchBytes, skippedImageIds);

        const syncRequest: SyncRequest = {
          lastSyncTimestamp,
          entries: pendingEntries,
          images: pendingImages,
        };

        const response = await apiFetch('/sync', {
          method: 'POST',
          body: JSON.stringify(syncRequest),
        });

        // Too big for this server's upload limit. Halve the batch and try
        // again; once a batch is a single image there is nothing left to split,
        // so park that image and keep the rest of the queue moving.
        if (response.status === 413) {
          if (pendingImages.length > 1) {
            batchBytes = Math.max(1, Math.floor(batchBytes / 2));
            console.warn(
              `[sync] Server rejected the payload as too large — retrying with ` +
                `${(batchBytes / 1024 / 1024).toFixed(1)}MB image batches`
            );
            continue;
          }
          if (pendingImages.length === 1) {
            skippedImageIds.add(pendingImages[0].id);
            console.error(
              `[sync] Image ${pendingImages[0].id} is larger than the server accepts ` +
                `(${(pendingImages[0].data.length / 1024 / 1024).toFixed(1)}MB) — skipping it; ` +
                `everything else will still sync`
            );
            continue;
          }
          throw new Error('Server rejected the sync payload as too large');
        }

        if (!response.ok) {
          const error = await response.json().catch(() => ({} as any));
          throw new Error(error.message || `Sync failed with status ${response.status}`);
        }

        const syncResponse: SyncResponse = await response.json();

        // Apply server entries locally
        for (const entry of syncResponse.entries) {
          upsertFromServer(entry);
        }

        // Apply server images locally (bytes + tombstones)
        for (const image of syncResponse.images ?? []) {
          upsertImageFromServer(image);
        }

        // Mark sent entries as synced
        if (pendingEntries.length > 0) {
          markEntriesSynced(pendingEntries.map(e => e.id));
        }

        // Mark sent images as synced
        if (pendingImages.length > 0) {
          markImagesSynced(pendingImages.map(im => im.id));
        }

        // Update last sync timestamp
        setConfig('last_sync_timestamp', syncResponse.serverTimestamp);

        totals.sent += pendingEntries.length;
        totals.sentImages += pendingImages.length;
        totals.received += syncResponse.entries.length;
        totals.receivedImages += (syncResponse.images ?? []).length;
        totals.conflicts += syncResponse.conflicts.length;

        // Anything still queued goes out in the next round, so a backlog
        // clears in one sync rather than one batch every five minutes.
        if (getPendingImageCount() - skippedImageIds.size <= 0) break;
      }

      return totals;
    });

    console.log(
      `[sync] Complete: sent=${result.sent}(+${result.sentImages} img), ` +
        `received=${result.received}(+${result.receivedImages} img), conflicts=${result.conflicts}` +
        (skippedImageIds.size > 0 ? `, ${skippedImageIds.size} image(s) too large to send` : '')
    );
    isSyncing = false;
    emitStatus();

    // If the server sent entries or images down, tell the renderer to reload
    // its list and re-hydrate the open entry's images.
    if ((result.received > 0 || result.receivedImages > 0) && journalsChangedCallback) {
      journalsChangedCallback();
    }

    // Everything that could sync did, but say so plainly when an image was too
    // big for the server — it stays pending, and the count would otherwise sit
    // there with no explanation.
    if (skippedImageIds.size > 0) {
      return {
        success: false,
        message: `Synced: ${result.sent} sent, ${result.received} received — ` +
          `${skippedImageIds.size} image(s) exceed the server's upload limit and could not be sent`,
      };
    }

    return {
      success: true,
      message: `Synced: ${result.sent} sent, ${result.received} received`,
    };
  } catch (err: any) {
    console.error('[sync] Failed:', err.message);
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
