import { useState, useEffect, useCallback } from 'react';
import type { SyncStatus } from '../../shared/types';

export function useSync() {
  const [status, setStatus] = useState<SyncStatus>({
    online: false,
    lastSync: null,
    pendingCount: 0,
    syncing: false,
  });

  useEffect(() => {
    // Get initial status
    window.electronAPI.syncGetStatus().then(setStatus);

    // Listen for status changes
    const unsubscribe = window.electronAPI.onSyncStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    return unsubscribe;
  }, []);

  const triggerSync = useCallback(async () => {
    return window.electronAPI.syncTrigger();
  }, []);

  return { ...status, triggerSync };
}
