import React from 'react';
import type { JournalEntry } from '../../shared/types';

interface JournalListProps {
  entries: JournalEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * JournalList is used inside the Sidebar. This component provides
 * the list rendering logic separated from the sidebar layout.
 * The Sidebar component handles the actual rendering inline for simplicity,
 * but this component can be used for alternative list views if needed.
 */
export default function JournalList({ entries, selectedId, onSelect }: JournalListProps) {
  const sorted = [...entries]
    .filter(e => !e.deleted)
    .sort((a, b) => new Date(b.journal_date).getTime() - new Date(a.journal_date).getTime());

  return (
    <div>
      {sorted.map((entry) => (
        <div
          key={entry.id}
          className={`sidebar-entry ${selectedId === entry.id ? 'active' : ''}`}
          onClick={() => onSelect(entry.id)}
        >
          <span className="sidebar-entry-title">{entry.title || 'Untitled'}</span>
          <span className="sidebar-entry-date">
            {new Date(entry.journal_date).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}
