import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { JournalEntry } from '../../shared/types';
import DateTimePicker from './DateTimePicker';
import ImageOverlay, { type Corner, type OverlayRect } from './ImageOverlay';
import {
  type FigureState,
  type ImageAlign,
  type ImageLayout,
  DEFAULT_LAYOUT,
  MAX_WIDTH,
  MIN_WIDTH,
  allFigures,
  createFigure,
  findFigure,
  hydrateImages,
  isFloating,
  readFigure,
  referencedImageIds,
  serializeContent,
  writeFigure,
} from '../lib/docImages';
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

const DRAG_THRESHOLD = 4; // px before a click on an image turns into a drag

interface DragState {
  imageId: string;
  fig: HTMLElement;
  mode: 'flow' | 'free';
  startX: number;
  startY: number;
  grabX: number; // pointer offset inside the figure (free mode)
  grabY: number;
  moved: boolean;
  dropRange: Range | null;
}

interface ResizeState {
  imageId: string;
  fig: HTMLElement;
  corner: Corner;
  startX: number;
  startWidthPx: number;
  columnWidth: number;
}

interface DropIndicator {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function JournalEditor({ entry, onSave, onDelete, onAskAi }: JournalEditorProps) {
  const [title, setTitle] = useState(entry.title);
  const [journalDate, setJournalDate] = useState(entry.journal_date);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<{ rect: OverlayRect; state: FigureState } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [imageCount, setImageCount] = useState(0);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const colorInputRef = useRef<HTMLInputElement | null>(null);

  // id → data: URL for every image belonging to this entry. The document HTML
  // only stores placeholders; the bytes are looked up from here (see docImages).
  const imagesRef = useRef<Map<string, string>>(new Map());
  // The last values we handed to the store, so an entry object echoing back
  // from a save doesn't reset the caret (or a drag) mid-edit.
  const savedRef = useRef({ title: entry.title, content: entry.content, journal_date: entry.journal_date });
  const loadedEntryIdRef = useRef<string | null>(null);
  // Where to drop a newly uploaded image — the file dialog steals the selection.
  const savedRangeRef = useRef<Range | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  const getContent = () => (contentRef.current ? serializeContent(contentRef.current) : '');

  const syncImageCount = useCallback(() => {
    setImageCount(contentRef.current ? allFigures(contentRef.current).length : 0);
  }, []);

  // ─── Overlay geometry ──────────────────────────────────────────
  // The overlay lives inside the scrolling surface, so it tracks the image
  // without listening for scroll — it only has to follow reflow.
  const refreshOverlay = useCallback(() => {
    const root = contentRef.current;
    const surface = surfaceRef.current;
    if (!root || !surface || !selectedImageId) {
      setOverlay(null);
      return;
    }
    const fig = findFigure(root, selectedImageId);
    if (!fig) {
      setOverlay(null);
      return;
    }
    const f = fig.getBoundingClientRect();
    const s = surface.getBoundingClientRect();
    setOverlay({
      rect: { left: f.left - s.left, top: f.top - s.top, width: f.width, height: f.height },
      state: readFigure(fig),
    });
  }, [selectedImageId]);

  useLayoutEffect(() => { refreshOverlay(); }, [refreshOverlay]);

  useEffect(() => {
    if (!selectedImageId) return;
    const onResize = () => refreshOverlay();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(onResize);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
  }, [selectedImageId, refreshOverlay]);

  // ─── Auto-save (1s debounce) ───────────────────────────────────
  const triggerSave = useCallback((newTitle: string, newContent: string, newDate: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus('saving');

    saveTimer.current = setTimeout(async () => {
      savedRef.current = { title: newTitle, content: newContent, journal_date: newDate };
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

      // Drop image rows the document no longer references (deleted figures).
      const stillUsed = referencedImageIds(newContent);
      for (const id of Array.from(imagesRef.current.keys())) {
        if (stillUsed.has(id)) continue;
        imagesRef.current.delete(id);
        try {
          await window.electronAPI.imageDelete(id);
        } catch {
          /* best-effort cleanup — the row is harmless if it lingers */
        }
      }
    }, 1000);
  }, [entry.id, onSave]);

  /** Persist the current surface after a programmatic edit. */
  const commit = useCallback(() => {
    triggerSave(title, getContent(), journalDate);
  }, [triggerSave, title, journalDate]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // ─── Loading an entry into the surface ─────────────────────────
  useEffect(() => {
    const isNewEntry = loadedEntryIdRef.current !== entry.id;

    if (isNewEntry) {
      loadedEntryIdRef.current = entry.id;
      savedRef.current = { title: entry.title, content: entry.content, journal_date: entry.journal_date };
      setTitle(entry.title);
      setJournalDate(entry.journal_date);
      setSaveStatus('saved');
      setSelectedImageId(null);

      let active = true;
      window.electronAPI.imageList(entry.id).then((imgs) => {
        const root = contentRef.current;
        if (!active || !root) return;
        imagesRef.current = new Map(imgs.map((im) => [im.id, im.data]));

        root.innerHTML = toHtml(entry.content);

        // Entries written before images were placeable kept them in a gallery
        // below the text. Re-attach any that the document doesn't reference yet
        // so nothing is lost, then persist the migration.
        const referenced = referencedImageIds(root);
        const strays = imgs.filter((im) => !referenced.has(im.id));
        for (const im of strays) {
          root.appendChild(createFigure(im.id, { layout: DEFAULT_LAYOUT }));
          root.appendChild(document.createElement('br'));
        }

        hydrateImages(root, imagesRef.current);
        syncImageCount();
        if (strays.length > 0) {
          triggerSave(entry.title, serializeContent(root), entry.journal_date);
        }
      });
      return () => { active = false; };
    }

    // Same entry — only take external changes (e.g. a sync pulled a newer
    // version). Our own saves echo back unchanged and must not reset the caret.
    if (entry.title !== savedRef.current.title) {
      savedRef.current.title = entry.title;
      setTitle(entry.title);
    }
    if (entry.journal_date !== savedRef.current.journal_date) {
      savedRef.current.journal_date = entry.journal_date;
      setJournalDate(entry.journal_date);
    }
    if (entry.content !== savedRef.current.content && contentRef.current) {
      savedRef.current.content = entry.content;
      contentRef.current.innerHTML = toHtml(entry.content);
      hydrateImages(contentRef.current, imagesRef.current);
      syncImageCount();
      setSelectedImageId(null);
    }
  }, [entry.id, entry.title, entry.content, entry.journal_date, triggerSave, syncImageCount]);

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

  /** Remember the caret so an upload lands where the user was writing. */
  const rememberSelection = useCallback(() => {
    const root = contentRef.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (root.contains(range.startContainer)) savedRangeRef.current = range.cloneRange();
  }, []);

  // ─── Image upload ──────────────────────────────────────────────
  const handlePickImages = () => {
    rememberSelection();
    fileInputRef.current?.click();
  };

  const insertFigure = (imageId: string) => {
    const root = contentRef.current;
    if (!root) return;
    const fig = createFigure(imageId);
    const range = savedRangeRef.current;

    if (range && root.contains(range.startContainer)) {
      range.deleteContents();
      range.insertNode(fig);
    } else {
      root.appendChild(fig);
    }

    // Always leave somewhere to type after the image.
    if (!fig.nextSibling) fig.after(document.createElement('br'));

    const after = document.createRange();
    after.setStartAfter(fig);
    after.collapse(true);
    savedRangeRef.current = after.cloneRange();

    hydrateImages(root, imagesRef.current);
    syncImageCount();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file

    let lastId: string | null = null;
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const saved = await window.electronAPI.imageAdd(entry.id, dataUrl);
      imagesRef.current.set(saved.id, saved.data ?? dataUrl);
      insertFigure(saved.id);
      lastId = saved.id;
    }

    if (lastId) {
      setSelectedImageId(lastId);
      commit();
    }
  };

  const removeImage = useCallback((imageId: string) => {
    const root = contentRef.current;
    if (!root) return;
    findFigure(root, imageId)?.remove();
    setSelectedImageId(null);
    syncImageCount();
    commit(); // the debounced save reconciles the now-unreferenced image row
  }, [commit, syncImageCount]);

  // ─── Image selection, dragging and resizing ────────────────────
  const figureFromEvent = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Node)) return null;
    const el = target instanceof HTMLElement ? target : target.parentElement;
    return el?.closest<HTMLElement>('figure.doc-image') ?? null;
  };

  const beginDrag = useCallback((imageId: string, clientX: number, clientY: number) => {
    const root = contentRef.current;
    const fig = root ? findFigure(root, imageId) : null;
    if (!fig) return;
    const rect = fig.getBoundingClientRect();
    dragRef.current = {
      imageId,
      fig,
      mode: isFloating(readFigure(fig).layout) ? 'free' : 'flow',
      startX: clientX,
      startY: clientY,
      grabX: clientX - rect.left,
      grabY: clientY - rect.top,
      moved: false,
      dropRange: null,
    };
  }, []);

  const beginResize = useCallback((imageId: string, corner: Corner, clientX: number) => {
    const root = contentRef.current;
    const fig = root ? findFigure(root, imageId) : null;
    if (!fig || !root) return;
    resizeRef.current = {
      imageId,
      fig,
      corner,
      startX: clientX,
      startWidthPx: fig.getBoundingClientRect().width,
      columnWidth: root.clientWidth || 1,
    };
  }, []);

  // A single window-level pointer session drives both dragging and resizing.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const resize = resizeRef.current;
      if (resize) {
        const dx = e.clientX - resize.startX;
        const grow = resize.corner === 'ne' || resize.corner === 'se' ? dx : -dx;
        const width = ((resize.startWidthPx + grow) / resize.columnWidth) * 100;
        writeFigure(resize.fig, { width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) });
        refreshOverlay();
        return;
      }

      const drag = dragRef.current;
      const root = contentRef.current;
      if (!drag || !root) return;

      if (!drag.moved) {
        const far = Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD
          || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD;
        if (!far) return;
        drag.moved = true;
        drag.fig.classList.add('doc-image-dragging');
      }

      if (drag.mode === 'free') {
        const box = root.getBoundingClientRect();
        const x = ((e.clientX - drag.grabX - box.left) / (box.width || 1)) * 100;
        const y = e.clientY - drag.grabY - box.top;
        writeFigure(drag.fig, { x, y: Math.max(0, y) });
        refreshOverlay();
        return;
      }

      // Flow modes: show where in the text the image would land.
      const range = document.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
      if (!range || !root.contains(range.startContainer) || drag.fig.contains(range.startContainer)) return;
      drag.dropRange = range;

      const state = readFigure(drag.fig);
      if (state.layout === 'wrap') {
        const box = root.getBoundingClientRect();
        writeFigure(drag.fig, { align: e.clientX < box.left + box.width / 2 ? 'left' : 'right' });
      }

      const surface = surfaceRef.current;
      if (!surface) return;
      const s = surface.getBoundingClientRect();
      const caret = range.getBoundingClientRect();
      const line = caret.height > 0 ? caret : (range.startContainer.parentElement?.getBoundingClientRect() ?? caret);
      if (state.layout === 'break') {
        const box = root.getBoundingClientRect();
        setDropIndicator({
          left: box.left - s.left,
          top: line.top - s.top,
          width: box.width,
          height: 2,
        });
      } else {
        setDropIndicator({
          left: caret.left - s.left,
          top: line.top - s.top,
          width: 2,
          height: line.height || 20,
        });
      }
    };

    const onUp = () => {
      const resize = resizeRef.current;
      if (resize) {
        resizeRef.current = null;
        refreshOverlay();
        commit();
        return;
      }

      const drag = dragRef.current;
      dragRef.current = null;
      setDropIndicator(null);
      if (!drag) return;

      drag.fig.classList.remove('doc-image-dragging');
      if (!drag.moved) return;

      if (drag.mode === 'flow' && drag.dropRange) {
        const range = drag.dropRange;
        drag.fig.remove();
        range.insertNode(drag.fig);
        if (!drag.fig.nextSibling) drag.fig.after(document.createElement('br'));
      }
      refreshOverlay();
      commit();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [commit, refreshOverlay]);

  const handleContentPointerDown = (e: React.PointerEvent) => {
    const fig = figureFromEvent(e.target);
    if (!fig || !fig.dataset.imageId) {
      if (selectedImageId) setSelectedImageId(null);
      return;
    }
    e.preventDefault(); // don't drop a caret inside the figure
    setSelectedImageId(fig.dataset.imageId);
    beginDrag(fig.dataset.imageId, e.clientX, e.clientY);
  };

  // Deselect on a click elsewhere; Delete/Backspace removes the selected image.
  useEffect(() => {
    if (!selectedImageId) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.doc-image-overlay')) return;
      // Clicking another image is handled by the surface's own pointer handler.
      if (figureFromEvent(target)) return;
      setSelectedImageId(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImageId(null);
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      removeImage(selectedImageId);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedImageId, removeImage]);

  const updateSelectedFigure = useCallback((patch: Partial<FigureState>) => {
    const root = contentRef.current;
    const fig = root && selectedImageId ? findFigure(root, selectedImageId) : null;
    if (!fig || !root) return;

    // Switching to a free-floating layout: seed the offsets from where the
    // image currently sits, so it doesn't jump to the corner.
    if (patch.layout && isFloating(patch.layout) && !isFloating(readFigure(fig).layout)) {
      const box = root.getBoundingClientRect();
      const f = fig.getBoundingClientRect();
      patch = {
        ...patch,
        x: ((f.left - box.left) / (box.width || 1)) * 100,
        y: Math.max(0, f.top - box.top),
      };
    }
    writeFigure(fig, patch);
    refreshOverlay();
    commit();
  }, [selectedImageId, refreshOverlay, commit]);

  // ─── Text editing ──────────────────────────────────────────────
  const handleTitleChange = (value: string) => {
    setTitle(value);
    triggerSave(value, getContent(), journalDate);
  };

  const handleContentInput = () => {
    // A figure can be removed by ordinary editing (select-all + type, undo…).
    if (selectedImageId && contentRef.current && !findFigure(contentRef.current, selectedImageId)) {
      setSelectedImageId(null);
    }
    syncImageCount();
    refreshOverlay();
    triggerSave(title, getContent(), journalDate);
  };

  const handleDateChange = (newDate: string) => {
    setJournalDate(newDate);
    setShowDatePicker(false);
    triggerSave(title, getContent(), newDate);
  };

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

        <span className="editor-tool-divider" />

        <button
          type="button"
          className="editor-tool editor-tool-image"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handlePickImages}
          aria-label="Insert image"
          title="Insert image — then drag it where you want it"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <rect x="1.2" y="2.6" width="13.6" height="10.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <circle cx="5.4" cy="6.3" r="1.25" fill="currentColor" />
            <path d="M2.2 12.1l3.5-3.6 2.6 2.6 2.5-2.1 3 3.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
        </button>
        {imageCount > 0 && (
          <span className="editor-toolbar-hint">Click an image to move, resize or wrap text</span>
        )}
      </div>

      <div className="editor-surface" ref={surfaceRef}>
        <div
          ref={contentRef}
          className="editor-content"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder="Start writing..."
          onInput={handleContentInput}
          onKeyUp={() => { syncActiveFormats(); rememberSelection(); }}
          onMouseUp={() => { syncActiveFormats(); rememberSelection(); }}
          onFocus={syncActiveFormats}
          onBlur={rememberSelection}
          onPointerDown={handleContentPointerDown}
        />

        {dropIndicator && (
          <div
            className="doc-image-drop"
            style={{
              left: dropIndicator.left,
              top: dropIndicator.top,
              width: dropIndicator.width,
              height: dropIndicator.height,
            }}
          />
        )}

        {overlay && selectedImageId && (
          <ImageOverlay
            rect={overlay.rect}
            state={overlay.state}
            onDragStart={(e) => {
              e.preventDefault();
              beginDrag(selectedImageId, e.clientX, e.clientY);
            }}
            onResizeStart={(corner, e) => {
              e.preventDefault();
              e.stopPropagation();
              beginResize(selectedImageId, corner, e.clientX);
            }}
            onLayoutChange={(layout: ImageLayout) => updateSelectedFigure({ layout })}
            onAlignChange={(align: ImageAlign) => updateSelectedFigure({ align })}
            onDelete={() => removeImage(selectedImageId)}
          />
        )}
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
