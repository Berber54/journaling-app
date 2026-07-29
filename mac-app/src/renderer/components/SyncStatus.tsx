import React from 'react';

interface SyncStatusProps {
  online: boolean;
  lastSync: string | null;
  pendingCount: number;
  syncing: boolean;
}

export default function SyncStatus({ online, lastSync, pendingCount, syncing }: SyncStatusProps) {
  let dotColor = 'var(--success)';    // green = synced
  let label = 'Synced';

  if (syncing) {
    dotColor = 'var(--accent-primary)';
    label = 'Syncing...';
  } else if (!online) {
    dotColor = 'var(--danger)';        // red = offline
    label = 'Offline';
  } else if (pendingCount > 0) {
    dotColor = 'var(--warning)';       // yellow = pending
    label = `${pendingCount} pending`;
  }

  const tooltip = lastSync
    ? `Last sync: ${new Date(lastSync).toLocaleString()}\n${pendingCount} pending entries`
    : 'Never synced';

  return (
    <div
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        cursor: 'default',
      }}
    >
      <span
        className={syncing ? 'animate-pulse' : ''}
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: dotColor,
          display: 'inline-block',
          transition: 'background 0.3s ease',
        }}
      />
      {label}
    </div>
  );
}
