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
  onAskAi: () => void;
  syncStatus: { online: boolean; lastSync: string | null; pendingCount: number; syncing: boolean };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getMonthYear(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Entries may hold rich-text HTML — show a clean plain-text preview.
function contentPreview(content: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = content;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

export default function Sidebar({ entries, selectedId, onSelect, onNewEntry, onOpenSettings, onAskAi, syncStatus }: SidebarProps) {
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

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Journal</h1>
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
                {entry.content && (
                  <span className="sidebar-entry-preview">
                    {contentPreview(entry.content).substring(0, 60)}
                  </span>
                )}
                {/* Show yellow dot for unsynced entries — data agent will wire this */}
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
        <button className="sidebar-ai-btn" onClick={onAskAi}>
          ✦ Ask AI about all entries
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
