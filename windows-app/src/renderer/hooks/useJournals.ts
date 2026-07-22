import { useState, useEffect, useCallback } from 'react';
import type { JournalEntry } from '../../shared/types';

export function useJournals() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await window.electronAPI.journalGetAll();
    setEntries(all);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = useCallback(async (data: { title: string; content: string; journal_date: string }) => {
    const entry = await window.electronAPI.journalCreate(data);
    setEntries(prev => [entry, ...prev]);
    return entry;
  }, []);

  const update = useCallback(async (id: string, updates: Partial<JournalEntry>) => {
    const entry = await window.electronAPI.journalUpdate(id, updates);
    setEntries(prev => prev.map(e => e.id === id ? entry : e));
    return entry;
  }, []);

  const remove = useCallback(async (id: string) => {
    await window.electronAPI.journalDelete(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  return { entries, loading, refresh, create, update, remove };
}
