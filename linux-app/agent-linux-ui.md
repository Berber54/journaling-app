# Agent: Linux UI Components

> **Role**: Build the complete React UI for the Linux Electron app.
> **Prerequisites**: Electron project setup complete (from `agent-linux-electron-setup.md`).
> **Reference**: `../ARCHITECTURE.md` §11 for design system, §12 for IPC channels.

---

## Deliverables

Every renderer file the Windows app has — the complete list is the contents of `../windows-app/src/renderer/`. This **includes the AI Assistant** (`components/ChatPanel.tsx` + `styles/chat.css`), which earlier drafts of this spec omitted.

---

## Key Instruction

**Copy ALL component code exactly from the Windows source (`../windows-app/src/renderer/`)** — every component, hook, utility, and CSS file. The Linux UI is functionally and visually identical to the Windows UI.

Linux uses a **standard window frame** (`frame: true`), just like Windows. There are **no titlebar adjustments** needed (unlike macOS which uses `hiddenInset`).

---

## Linux-Specific CSS Notes

The only minor CSS difference is scrollbar styling. In **`src/renderer/styles/global.css`**, the scrollbar styles from the Windows version work perfectly on Linux since Electron uses Chromium's rendering engine on all platforms. The `::-webkit-scrollbar` selectors work identically.

No additional CSS modifications are needed.

---

## Files to Copy Verbatim from Windows Source

Copy each of these files exactly from `../windows-app/src/renderer/`:

1. `src/renderer/index.html` — HTML entry point
2. `src/renderer/main.tsx` — React entry
3. `src/renderer/App.tsx` — root component
4. `src/renderer/styles/global.css` — full design system (no changes needed)
5. `src/renderer/styles/lock.css` — lock screen styles
6. `src/renderer/styles/sidebar.css` — sidebar styles
7. `src/renderer/styles/editor.css` — editor styles
8. `src/renderer/styles/chat.css` — AI Assistant styles
9. `src/renderer/components/LockScreen.tsx` — PIN lock overlay
10. `src/renderer/components/Sidebar.tsx` — navigation sidebar
11. `src/renderer/components/JournalList.tsx` — journal list
12. `src/renderer/components/JournalEditor.tsx` — create/edit journal
13. `src/renderer/components/DateTimePicker.tsx` — manual date override
14. `src/renderer/components/Settings.tsx` — app settings
15. `src/renderer/components/SyncStatus.tsx` — sync indicator
16. `src/renderer/components/ChatPanel.tsx` — AI Assistant chat panel
17. `src/renderer/hooks/useJournals.ts` — journal CRUD hook
18. `src/renderer/hooks/useLock.ts` — lock state hook
19. `src/renderer/hooks/useSync.ts` — sync status hook
20. `src/renderer/lib/ipc.ts` — IPC wrapper
21. `src/renderer/lib/utils.ts` — utility functions

---

## Verification

1. `npm run dev:renderer` — Vite starts on port 5173
2. Lock screen appears with glassmorphism effect
3. PIN entry works (create and unlock)
4. Sidebar renders with journal entries grouped by month
5. Journal editor with auto-save and date picker
6. Settings panel with server connection and sync controls
7. All animations work: fade-in, slide-in, shake, pulse
8. Scrollbars render with dark theme styling

> **Next**: Data-sync agent (`agent-linux-data-sync.md`).
