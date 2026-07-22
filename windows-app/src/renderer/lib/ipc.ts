/**
 * Type-safe IPC wrapper.
 * The electronAPI is exposed via the preload script through contextBridge.
 * All calls are available at window.electronAPI.
 * See src/shared/types.ts for the ElectronAPI interface.
 */
export function getAPI() {
  if (!window.electronAPI) {
    throw new Error('electronAPI is not available. Running outside Electron?');
  }
  return window.electronAPI;
}
