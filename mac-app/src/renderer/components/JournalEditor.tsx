import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { JournalEntry, JournalImage } from '../../shared/types';
import DateTimePicker from './DateTimePicker';
import '../styles/editor.css';

interface JournalEditorProps {
  entry: JournalEntry;
  onSave: (id: string, updates: Partial<JournalEntry>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAskAi: () => void;
}

// Older entries were stored as plain text (no HTML). Detect that so we can
// preserve their line breaks when loading them into the rich-text surface.
const looksLikeHtml = (s: string) => /<[a-z][\s\S]*>/i.test(s);
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (s: string) =>
  looksLikeHtml(s) ? s : escapeHtml(s).replace(/\n/g, '<br>');

const COLORS = ['#dbe3f4', '#3f6fd6', '#35b57e', '#d6a24a', '#e0596a', '#b98cff'];

export default function JournalEditor({ entry, onSave, onDelete, onAskAi }: JournalEditorProps) {
  const [title, setTitle] = useState(entry.title);
  const [journalDate, setJournalDate] = useState(entry.journal_date);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [images, setImages] = useState<JournalImage[]>([]);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  const getContent = () => contentRef.current?.innerHTML ?? '';

  // Reset state when entry changes. The editable surface is uncontrolled — we
  // push its HTML in imperatively so React re-renders don't reset the caret.
  useEffect(() => {
    setTitle(entry.title);
    setJournalDate(entry.journal_date);
    setSaveStatus('saved');
    if (contentRef.current) {
      contentRef.current.innerHTML = toHtml(entry.content);
    }
  }, [entry.id, entry.title, entry.content, entry.journal_date]);

  // Make foreColor / etc. emit inline CSS spans rather than legacy <font> tags.
  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* not supported — ignore */
    }
  }, []);

  const syncActiveFormats = useCallback(() => {
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      });
    } catch {
      /* selection outside the editor — ignore */
    }
  }, []);

  // Load images for the current entry
  useEffect(() => {
    let active = true;
    window.electronAPI.imageList(entry.id).then((imgs) => {
      if (active) setImages(imgs);
    });
    return () => { active = false; };
  }, [entry.id]);

  const handlePickImages = () => fileInputRef.current?.click();

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await window.electronAPI.imageAdd(entry.id, dataUrl);
    }
    const imgs = await window.electronAPI.imageList(entry.id);
    setImages(imgs);
    e.target.value = ''; // allow re-selecting the same file
  };

  const handleRemoveImage = async (id: string) => {
    await window.electronAPI.imageDelete(id);
    setImages((prev) => prev.filter((im) => im.id !== id));
  };

  // Auto-save with 1s debounce
  const triggerSave = useCallback((newTitle: string, newContent: string, newDate: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus('saving');

    saveTimer.current = setTimeout(async () => {
      try {
        await onSave(entry.id, {
          title: newTitle,
          content: newContent,
          journal_date: newDate,
          updated_at: new Date().toISOString(),
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('offline');
      }
    }, 1000);
  }, [entry.id, onSave]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleTitleChange = (value: string) => {
    setTitle(value);
    triggerSave(value, getContent(), journalDate);
  };

  const handleContentInput = () => {
    triggerSave(title, getContent(), journalDate);
  };

  const handleDateChange = (newDate: string) => {
    setJournalDate(newDate);
    setShowDatePicker(false);
    triggerSave(title, getContent(), newDate);
  };

  // ─── Rich-text formatting ─────────────────────────────────────
  const runCommand = useCallback((command: string, value?: string) => {
    const el = contentRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    syncActiveFormats();
    triggerSave(title, getContent(), journalDate);
  }, [syncActiveFormats, triggerSave, title, journalDate]);

  const handleColorPick = (color: string) => {
    runCommand('foreColor', color);
  };

  const handleDelete = async () => {
    await onDelete(entry.id);
    setShowDeleteDialog(false);
  };

  const formatDisplayDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="editor-container">
      <div className="editor-header">
        <input
          className="editor-title-input"
          type="text"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
        />
      </div>

      <div className="editor-meta">
        <button className="editor-date-btn" onClick={() => setShowDatePicker(true)}>
          {formatDisplayDate(journalDate)}
        </button>
        <span className={`editor-save-status ${saveStatus}`}>
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'offline' && 'Offline — saved locally'}
        </span>
        <button className="editor-ai-btn" onClick={onAskAi} title="Ask the AI about this entry">
          ✦ Ask AI about this entry
        </button>
      </div>

      <div className="editor-toolbar" role="toolbar" aria-label="Text formatting">
        <button
          type="button"
          className={`editor-tool ${activeFormats.bold ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('bold')}
          aria-label="Bold"
          title="Bold (Ctrl+B)"
          style={{ fontWeight: 700 }}
        >
          B
        </button>
        <button
          type="button"
          className={`editor-tool ${activeFormats.italic ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('italic')}
          aria-label="Italic"
          title="Italic (Ctrl+I)"
          style={{ fontStyle: 'italic' }}
        >
          I
        </button>
        <button
          type="button"
          className={`editor-tool ${activeFormats.underline ? 'active' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('underline')}
          aria-label="Underline"
          title="Underline (Ctrl+U)"
          style={{ textDecoration: 'underline' }}
        >
          U
        </button>

        <span className="editor-tool-divider" />

        <div className="editor-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="editor-swatch"
              style={{ background: c }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleColorPick(c)}
              aria-label={`Text color ${c}`}
              title={`Text color ${c}`}
            />
          ))}
          <button
            type="button"
            className="editor-swatch editor-swatch-custom"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => colorInputRef.current?.click()}
            aria-label="Custom text color"
            title="Custom text color"
          >
            +
          </button>
          <input
            ref={colorInputRef}
            type="color"
            className="editor-color-hidden"
            onChange={(e) => handleColorPick(e.target.value)}
          />
        </div>
      </div>

      <div
        ref={contentRef}
        className="editor-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder="Start writing..."
        onInput={handleContentInput}
        onKeyUp={syncActiveFormats}
        onMouseUp={syncActiveFormats}
        onFocus={syncActiveFormats}
      />

      <div className="editor-images">
        {images.map((img) => (
          <div key={img.id} className="editor-image">
            <img src={img.data} alt="" />
            <button
              className="editor-image-remove"
              onClick={() => handleRemoveImage(img.id)}
              aria-label="Remove image"
            >
              ×
            </button>
          </div>
        ))}
        <button className="editor-image-add" onClick={handlePickImages}>
          + Add image
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />

      <div className="editor-footer">
        <button className="btn btn-danger" onClick={() => setShowDeleteDialog(true)}>
          Delete Entry
        </button>
      </div>

      {showDatePicker && (
        <DateTimePicker
          currentDate={journalDate}
          onSave={handleDateChange}
          onCancel={() => setShowDatePicker(false)}
        />
      )}

      {showDeleteDialog && (
        <div className="delete-dialog-overlay">
          <div className="delete-dialog">
            <h3>Delete this entry?</h3>
            <p>This action cannot be undone. The entry will be removed from all devices.</p>
            <div className="delete-dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteDialog(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
