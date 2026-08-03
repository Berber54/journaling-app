import React, { useState, useCallback, useEffect } from 'react';
import LockScreen from './components/LockScreen';
import Sidebar from './components/Sidebar';
import JournalEditor from './components/JournalEditor';
import Settings from './components/Settings';
import ExportPanel from './components/ExportPanel';
import { useJournals } from './hooks/useJournals';
import { useLock } from './hooks/useLock';
import { useSync } from './hooks/useSync';
import { useTheme } from './hooks/useTheme';
import { nowISO } from './lib/utils';

type View = 'journal' | 'settings';

/** app_config key holding whether the sidebar is collapsed (local to this device). */
const SIDEBAR_SETTING_KEY = 'sidebar_collapsed';

export default function App() {
  const { entries, loading: journalsLoading, create, update, remove, refresh } = useJournals();
  const { locked, hasPin, loading: lockLoading, bioAvailable, unlock, unlockWithBiometric, setPin } = useLock();
  const syncStatus = useSync();
  const { theme, setTheme } = useTheme();

  const [currentView, setCurrentView] = useState<View>('journal');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Entry ids ticked when the export panel opens; null means the panel is shut.
  const [exportSelection, setExportSelection] = useState<string[] | null>(null);

  const selectedEntry = entries.find(e => e.id === selectedId) || null;

  // Restore the sidebar the way it was left.
  useEffect(() => {
    let active = true;
    window.electronAPI.settingsGet(SIDEBAR_SETTING_KEY).then((value) => {
      if (active) setSidebarCollapsed(value === 'true');
    });
    return () => { active = false; };
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      window.electronAPI.settingsSet(SIDEBAR_SETTING_KEY, next ? 'true' : 'false');
      return next;
    });
  }, []);

  // Ctrl/Cmd + \ toggles the sidebar. Kept off Ctrl+B — that's bold in the editor.
  // Ignored while locked: there is no sidebar to toggle behind the lock screen.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (locked) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === '\\') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar, locked]);

  const openExportAll = useCallback(() => {
    setExportSelection(entries.filter(e => !e.deleted).map(e => e.id));
  }, [entries]);

  const handleNewEntry = useCallback(async () => {
    const entry = await create({
      title: '',
      content: '',
      journal_date: nowISO(),
    });
    setSelectedId(entry.id);
    setCurrentView('journal');
  }, [create]);

  const handleSave = useCallback(async (id: string, updates: any) => {
    await update(id, updates);
  }, [update]);

  const handleDelete = useCallback(async (id: string) => {
    await remove(id);
    setSelectedId(null);
  }, [remove]);

  // Show loading spinner while initializing
  if (lockLoading) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
      }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '16px' }}>Loading...</span>
      </div>
    );
  }

  // Show lock screen
  if (locked) {
    return (
      <LockScreen
        hasPin={hasPin}
        bioAvailable={bioAvailable}
        onUnlock={unlock}
        onSetPin={setPin}
        onBiometric={unlockWithBiometric}
      />
    );
  }

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        entries={entries}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setCurrentView('journal'); }}
        onNewEntry={handleNewEntry}
        onOpenSettings={() => setCurrentView('settings')}
        onExport={openExportAll}
        syncStatus={syncStatus}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      <main className="main-content">
        {currentView === 'settings' && (
          <Settings
            syncStatus={syncStatus}
            onBack={() => setCurrentView('journal')}
            onExport={openExportAll}
            theme={theme}
            onThemeChange={setTheme}
          />
        )}

        {currentView === 'journal' && selectedEntry && (
          <JournalEditor
            entry={selectedEntry}
            onSave={handleSave}
            onDelete={handleDelete}
            onExport={() => setExportSelection([selectedEntry.id])}
          />
        )}

        {currentView === 'journal' && !selectedEntry && (
          <div className="empty-state">
            <span className="empty-state-text">
              Select a journal entry or create a new one
            </span>
          </div>
        )}
      </main>

      {exportSelection && (
        <ExportPanel
          entries={entries}
          initialSelection={exportSelection}
          onClose={() => setExportSelection(null)}
        />
      )}
    </div>
  );
}
