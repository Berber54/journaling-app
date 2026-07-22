# Agent: Mac UI Components

> **Role**: Build the complete React UI for the macOS Electron app.
> **Prerequisites**: Electron project setup complete (from `agent-mac-electron-setup.md`).
> **Reference**: `../ARCHITECTURE.md` §11 for design system, §12 for IPC channels.

---

## Deliverables

Same as Windows UI agent — all 19 files. See `../windows-app/agent-windows-ui.md` for the complete file list.

---

## Key Instruction

**Copy ALL component code exactly from `../windows-app/agent-windows-ui.md`** — every component, hook, utility, and CSS file — with the following Mac-specific modifications:

---

## Mac-Specific Modifications

### 1. `src/renderer/styles/global.css`

Add the following Mac-specific CSS **at the end of the file**, after the existing utility classes:

```css
/* ─── macOS-Specific Styles ─────────────────────────────────── */

/* Titlebar drag region — since we use hiddenInset, the top area is draggable */
.sidebar-header {
  -webkit-app-region: drag;
  padding-top: 38px; /* Extra padding for traffic lights */
}

/* All interactive elements must be no-drag */
.sidebar-header button,
.sidebar-header input,
.sidebar-new-btn,
.sidebar-entry,
.sidebar-settings-btn,
.btn,
.input,
.pin-digit,
.editor-title-input,
.editor-content,
.editor-date-btn {
  -webkit-app-region: no-drag;
}

/* macOS scrollbar styling — thinner, auto-hiding */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}

::-webkit-scrollbar-track {
  background: transparent;
}
```

### 2. `src/renderer/components/Sidebar.tsx`

The sidebar component is identical to Windows except the header already gets extra padding from the CSS above. **No code changes needed** — the CSS handles it.

### 3. `src/renderer/components/LockScreen.tsx`

Add drag region to the lock overlay so the window can still be dragged when locked:

```css
/* Add to lock.css */
.lock-overlay {
  -webkit-app-region: drag;
}

.lock-card {
  -webkit-app-region: no-drag;
}
```

### 4. All Other Files

All other files are **identical** to the Windows versions:
- `src/renderer/index.html`
- `src/renderer/main.tsx`
- `src/renderer/App.tsx`
- `src/renderer/components/JournalEditor.tsx`
- `src/renderer/components/JournalList.tsx`
- `src/renderer/components/DateTimePicker.tsx`
- `src/renderer/components/Settings.tsx`
- `src/renderer/components/SyncStatus.tsx`
- `src/renderer/hooks/useJournals.ts`
- `src/renderer/hooks/useLock.ts`
- `src/renderer/hooks/useSync.ts`
- `src/renderer/lib/ipc.ts`
- `src/renderer/lib/utils.ts`
- `src/renderer/styles/editor.css`
- `src/renderer/styles/sidebar.css` (base styles same, Mac CSS additions in global.css)

Copy each of these files verbatim from `../windows-app/agent-windows-ui.md`.

---

## Verification

1. `npm run dev:renderer` — Vite starts on port 5173
2. Lock screen appears with glassmorphism — traffic light area is visible and functional
3. Lock screen overlay is draggable (window can be moved while locked)
4. Sidebar has extra top padding so it doesn't overlap traffic lights
5. All interactive elements are clickable (not blocked by drag region)
6. All components function identically to Windows

> **Next**: Data-sync agent (`agent-mac-data-sync.md`).
