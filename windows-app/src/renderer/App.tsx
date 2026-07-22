import React, { useState, useCallback } from 'react';
import LockScreen from './components/LockScreen';
import Sidebar from './components/Sidebar';
import JournalEditor from './components/JournalEditor';
import Settings from './components/Settings';
import ChatPanel from './components/ChatPanel';
import { useJournals } from './hooks/useJournals';
import { useLock } from './hooks/useLock';
import { useSync } from './hooks/useSync';
import { nowISO } from './lib/utils';

type View = 'journal' | 'settings';

export default function App() {
  const { entries, loading: journalsLoading, create, update, remove, refresh } = useJournals();
  const { locked, hasPin, loading: lockLoading, bioAvailable, unlock, unlockWithBiometric, setPin } = useLock();
  const syncStatus = useSync();

  const [currentView, setCurrentView] = useState<View>('journal');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<'all' | 'single' | null>(null);

  const selectedEntry = entries.find(e => e.id === selectedId) || null;

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
    <div className="app-layout">
      <Sidebar
        entries={entries}
        selectedId={selectedId}
        onSelect={(id) => { setSelectedId(id); setCurrentView('journal'); }}
        onNewEntry={handleNewEntry}
        onOpenSettings={() => setCurrentView('settings')}
        onAskAi={() => setChatMode('all')}
        syncStatus={syncStatus}
      />

      <main className="main-content">
        {currentView === 'settings' && (
          <Settings
            syncStatus={syncStatus}
            onBack={() => setCurrentView('journal')}
          />
        )}

        {currentView === 'journal' && selectedEntry && (
          <JournalEditor
            entry={selectedEntry}
            onSave={handleSave}
            onDelete={handleDelete}
            onAskAi={() => setChatMode('single')}
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

      {chatMode && (
        <ChatPanel
          mode={chatMode}
          entries={entries}
          currentEntry={selectedEntry}
          onClose={() => setChatMode(null)}
        />
      )}
    </div>
  );
}
