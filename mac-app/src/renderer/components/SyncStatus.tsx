import React from 'react';

interface SyncStatusProps {
  online: boolean;
  lastSync: string | null;
  pendingCount: number;
  syncing: boolean;
  /** Dot only, no label — for the collapsed sidebar rail. */
  compact?: boolean;
}

export default function SyncStatus({ online, lastSync, pendingCount, syncing, compact = false }: SyncStatusProps) {
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
    ? `${label} — last sync: ${new Date(lastSync).toLocaleString()}\n${pendingCount} pending entries`
    : `${label} — never synced`;

  return (
    <div
      title={tooltip}
      aria-label={compact ? `Sync status: ${label}` : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        cursor: 'default',
        // In the rail the dot alone has to carry the meaning, so it gets the
        // tooltip and a hit area rather than being a stray 8px speck.
        ...(compact ? { width: '34px', height: '34px' } : null),
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
      {!compact && label}
    </div>
  );
}
