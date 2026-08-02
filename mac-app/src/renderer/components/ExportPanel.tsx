import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { JournalEntry, ExportFormat, ExportLayout, ExportResult } from '../../shared/types';
import '../styles/export.css';

interface ExportPanelProps {
  entries: JournalEntry[];
  /** Entries ticked when the panel opens — all of them, or just the open one. */
  initialSelection: string[];
  onClose: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  {
    id: 'markdown',
    label: 'Markdown (.md)',
    hint: 'Titles, dates and your text as headed Markdown. The easiest thing to drop into a chat window.',
  },
  {
    id: 'text',
    label: 'Plain text (.txt)',
    hint: 'No markup at all — just the words, with a title and date above each entry.',
  },
  {
    id: 'json',
    label: 'JSON (.json)',
    hint: 'Every field per entry: plain text, the original HTML, dates and attachment details. For scripts and tooling.',
  },
];

const LAYOUTS: { id: ExportLayout; label: string }[] = [
  { id: 'single', label: 'One file with every entry' },
  { id: 'per-entry', label: 'One file per entry' },
];

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ExportPanel({ entries, initialSelection, onClose }: ExportPanelProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [layout, setLayout] = useState<ExportLayout>('single');
  const [includeMedia, setIncludeMedia] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExportResult | null>(null);

  // Remember the last-used options, the same way the rest of Settings persists.
  useEffect(() => {
    (async () => {
      const [savedFormat, savedLayout, savedMedia] = await Promise.all([
        window.electronAPI.settingsGet('export_format'),
        window.electronAPI.settingsGet('export_layout'),
        window.electronAPI.settingsGet('export_media'),
      ]);
      if (savedFormat === 'markdown' || savedFormat === 'text' || savedFormat === 'json') {
        setFormat(savedFormat);
      }
      if (savedLayout === 'single' || savedLayout === 'per-entry') setLayout(savedLayout);
      if (savedMedia === 'true') setIncludeMedia(true);
    })();
  }, []);

  const visible = useMemo(
    () =>
      [...entries]
        .filter((e) => !e.deleted)
        .sort((a, b) => new Date(b.journal_date).getTime() - new Date(a.journal_date).getTime()),
    [entries]
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>();
    for (const entry of visible) {
      const key = monthLabel(entry.journal_date);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(entry);
    }
    return groups;
  }, [visible]);

  const toggle = (id: string) => {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const run = useCallback(async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // `null` means "everything" to the main process — send it when the whole
      // journal is ticked so the export can't miss an entry written since the
      // panel opened.
      const ids = selected.size === visible.length ? null : [...selected];
      const outcome = await window.electronAPI.exportRun({ ids, format, layout, includeMedia });
      if (!outcome.canceled) {
        setResult(outcome);
        await Promise.all([
          window.electronAPI.settingsSet('export_format', format),
          window.electronAPI.settingsSet('export_layout', layout),
          window.electronAPI.settingsSet('export_media', includeMedia ? 'true' : 'false'),
        ]);
      }
    } catch (err: any) {
      setError(err?.message || 'The export failed.');
    } finally {
      setBusy(false);
    }
  }, [selected, busy, visible.length, format, layout, includeMedia]);

  const formatHint = FORMATS.find((f) => f.id === format)?.hint ?? '';

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel" onClick={(e) => e.stopPropagation()}>
        <div className="export-header">
          <div className="export-header-titles">
            <span className="export-title">Export journals</span>
            <span className="export-subtitle">
              Write entries out as files you can read anywhere or hand to an AI tool of your
              choosing. Nothing leaves this device.
            </span>
          </div>
          <button className="export-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="export-selectbar">
          <span className="export-count">
            {selected.size} of {visible.length} selected
          </span>
          <div className="export-selectbar-actions">
            <button
              className="export-linkbtn"
              onClick={() => { setResult(null); setSelected(new Set(visible.map((e) => e.id))); }}
              disabled={selected.size === visible.length}
            >
              Select all
            </button>
            <button
              className="export-linkbtn"
              onClick={() => { setResult(null); setSelected(new Set()); }}
              disabled={selected.size === 0}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="export-entries">
          {[...grouped.entries()].map(([month, monthEntries]) => (
            <div key={month}>
              <div className="export-month-label">{month}</div>
              {monthEntries.map((entry) => (
                <button
                  key={entry.id}
                  className={`export-entry ${selected.has(entry.id) ? 'selected' : ''}`}
                  onClick={() => toggle(entry.id)}
                  aria-pressed={selected.has(entry.id)}
                >
                  <span className="export-check" aria-hidden="true">✓</span>
                  <span className="export-entry-title">{entry.title || 'Untitled'}</span>
                  <span className="export-entry-date">{shortDate(entry.journal_date)}</span>
                </button>
              ))}
            </div>
          ))}

          {visible.length === 0 && <div className="export-empty">No entries to export yet</div>}
        </div>

        <div className="export-options">
          <label className="export-field">
            Format
            <select
              className="export-select"
              value={format}
              onChange={(e) => { setResult(null); setFormat(e.target.value as ExportFormat); }}
            >
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </label>

          <label className="export-field">
            Layout
            <select
              className="export-select"
              value={layout}
              onChange={(e) => { setResult(null); setLayout(e.target.value as ExportLayout); }}
            >
              {LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="export-field"
            onClick={() => { setResult(null); setIncludeMedia((v) => !v); }}
            style={{
              background: 'none', border: 'none', padding: 0, width: '100%',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span>Include photos and videos</span>
            <span className={`toggle ${includeMedia ? 'on' : ''}`} aria-hidden="true">
              <span className="toggle-knob" />
            </span>
          </button>

          <p className="export-hint">{formatHint}</p>
          <p className="export-hint">
            {includeMedia
              ? 'Attachments are copied into a media/ folder beside the text, so the export is a folder rather than a single file.'
              : 'Attachments are left out — each one becomes a short placeholder in the text.'}
          </p>
        </div>

        {error && <div className="export-error">{error}</div>}

        {result && (
          <div className="export-done">
            <span>
              Exported {result.entryCount} {result.entryCount === 1 ? 'entry' : 'entries'} to{' '}
              {result.fileCount} {result.fileCount === 1 ? 'file' : 'files'}.
            </span>
            <span className="export-done-path">{result.path}</span>
            {result.missingMediaCount > 0 && (
              <span className="export-done-warn">
                {result.missingMediaCount}{' '}
                {result.missingMediaCount === 1 ? 'attachment has' : 'attachments have'} not synced
                to this device yet and could not be included.
              </span>
            )}
            <button
              className="export-linkbtn"
              onClick={() => window.electronAPI.exportReveal(result.path)}
            >
              Show in folder
            </button>
          </div>
        )}

        <div className="export-footer">
          <button
            className="btn btn-primary export-run"
            onClick={run}
            disabled={busy || selected.size === 0}
          >
            {busy
              ? 'Exporting…'
              : `Export ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
