import { net } from 'electron';
import { getConfig } from './database.js';
import { setOnlineStatus } from './syncService.js';

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

/**
 * Start monitoring network connectivity.
 * - Checks Electron's net.online
 * - Polls server /api/health every 30 seconds
 */
export function startNetworkMonitor(): void {
  if (isRunning) return;
  isRunning = true;

  // Initial check
  checkConnectivity();

  // Poll every 30 seconds
  healthCheckInterval = setInterval(checkConnectivity, 30000);

  console.log('[network] Monitor started');
}

export function stopNetworkMonitor(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  isRunning = false;
  console.log('[network] Monitor stopped');
}

async function checkConnectivity(): Promise<void> {
  // First check: is the system online at all?
  if (!net.online) {
    setOnlineStatus(false);
    return;
  }

  // Second check: can we reach the server?
  const serverUrl = getConfig('server_url');
  if (!serverUrl) {
    setOnlineStatus(false);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    setOnlineStatus(response.ok);
  } catch {
    setOnlineStatus(false);
  }
}
