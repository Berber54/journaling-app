import React, { useMemo } from 'react';
import type { JournalEntry } from '../../shared/types';
import SyncStatus from './SyncStatus';
import '../styles/sidebar.css';

interface SidebarProps {
  entries: JournalEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewEntry: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
  syncStatus: { online: boolean; lastSync: string | null; pendingCount: number; syncing: boolean };
  /** Hide the entry list, leaving only the icon rail. */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// The shortcut is Ctrl+\ everywhere but macOS, where it's Cmd+\. This file is
// kept identical across the platform apps, so the hint reads the runtime.
const TOGGLE_HINT = navigator.userAgent.includes('Mac') ? 'Cmd+\\' : 'Ctrl+\\';

function getMonthYear(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function Sidebar({
  entries,
  selectedId,
  onSelect,
  onNewEntry,
  onOpenSettings,
  onExport,
  syncStatus,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  // Group entries by month/year
  const grouped = useMemo(() => {
    const groups: Map<string, JournalEntry[]> = new Map();
    const sorted = [...entries]
      .filter(e => !e.deleted)
      .sort((a, b) => new Date(b.journal_date).getTime() - new Date(a.journal_date).getTime());

    for (const entry of sorted) {
      const key = getMonthYear(entry.journal_date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    return groups;
  }, [entries]);

  // Collapsed: an icon rail. Every action from the expanded sidebar is still
  // here — only the entry list is hidden — so collapsing never strands the user.
  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <div className="sidebar-rail">
          <button
            className="sidebar-rail-btn"
            onClick={onToggleCollapse}
            title={`Show entries (${TOGGLE_HINT})`}
            aria-label="Show entries"
            aria-expanded={false}
          >
            »
          </button>
          <div className="sidebar-rail-divider" />
          <button
            className="sidebar-rail-btn primary"
            onClick={onNewEntry}
            title="New entry"
            aria-label="New entry"
          >
            +
          </button>

          <div className="sidebar-rail-spacer" />

          <button
            className="sidebar-rail-btn"
            onClick={onExport}
            title="Export journals"
            aria-label="Export journals"
          >
            ⤓
          </button>
          <button
            className="sidebar-rail-btn"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
          <SyncStatus {...syncStatus} compact />
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-top">
          <h1 className="sidebar-title">Journal</h1>
          <button
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            title={`Hide entries (${TOGGLE_HINT})`}
            aria-label="Hide entries"
            aria-expanded={true}
          >
            «
          </button>
        </div>
        <button className="sidebar-new-btn" onClick={onNewEntry}>
          + New Entry
        </button>
      </div>

      <div className="sidebar-entries">
        {Array.from(grouped.entries()).map(([month, monthEntries]) => (
          <div key={month} className="sidebar-month-group">
            <div className="sidebar-month-label">{month}</div>
            {monthEntries.map((entry) => (
              <div
                key={entry.id}
                className={`sidebar-entry animate-fade-in ${selectedId === entry.id ? 'active' : ''}`}
                onClick={() => onSelect(entry.id)}
              >
                <span className="sidebar-entry-title">
                  {entry.title || 'Untitled'}
                </span>
                <span className="sidebar-entry-date">{formatDate(entry.journal_date)}</span>
                {/* Deliberately no content preview: the list shows title and date
                    only, so an open journal doesn't put your words on screen. */}
              </div>
            ))}
          </div>
        ))}

        {entries.filter(e => !e.deleted).length === 0 && (
          <div className="empty-state" style={{ padding: '40px 16px' }}>
            <span className="empty-state-text">No entries yet</span>
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="sidebar-export-btn" onClick={onExport}>
          ⤓ Export journals
        </button>
        <div className="sidebar-footer-row">
          <button className="sidebar-settings-btn" onClick={onOpenSettings}>
            Settings
          </button>
          <SyncStatus {...syncStatus} />
        </div>
      </div>
    </aside>
  );
}
