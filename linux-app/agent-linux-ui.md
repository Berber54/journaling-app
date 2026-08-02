# Agent: Linux UI Components

> **Role**: Build the complete React UI for the Linux Electron app.
> **Prerequisites**: Electron project setup complete (from `agent-linux-electron-setup.md`).
> **Reference**: `../ARCHITECTURE.md` §14 for the design system, §15 for IPC channels.

---

## Deliverables

Every renderer file the Windows app has — the complete list is the contents of `../windows-app/src/renderer/`. This **includes journal export** (`components/ExportPanel.tsx` + `styles/export.css`).

> Earlier drafts of this spec listed an AI Assistant (`ChatPanel.tsx` + `chat.css`). That feature has been removed from the product; the export panel took its place in the sidebar and the editor header. Do not port it.

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
7. `src/renderer/styles/editor.css` — editor styles (includes the placed-image rules)
8. `src/renderer/styles/export.css` — export panel styles
9. `src/renderer/components/LockScreen.tsx` — PIN lock overlay
10. `src/renderer/components/Sidebar.tsx` — navigation sidebar
11. `src/renderer/components/JournalList.tsx` — journal list
12. `src/renderer/components/JournalEditor.tsx` — create/edit journal
13. `src/renderer/components/DateTimePicker.tsx` — manual date override
14. `src/renderer/components/Settings.tsx` — app settings
15. `src/renderer/components/SyncStatus.tsx` — sync indicator
16. `src/renderer/components/ExportPanel.tsx` — export panel (entry picker + format options)
17. `src/renderer/components/ImageOverlay.tsx` — image selection ring, resize handles, layout bubble
18. `src/renderer/hooks/useJournals.ts` — journal CRUD hook
19. `src/renderer/hooks/useLock.ts` — lock state hook
20. `src/renderer/hooks/useSync.ts` — sync status hook
21. `src/renderer/lib/ipc.ts` — IPC wrapper
22. `src/renderer/lib/utils.ts` — utility functions
23. `src/renderer/lib/docImages.ts` — placed-image model (figure placeholders, hydrate/serialize)

---

## Images Are Placed Objects, Not a Gallery

Do **not** reintroduce the old image strip (`.editor-images`, `.editor-image-add`, an "+ Add image"
tile below the text). It was replaced because images had no relationship to the text around them.
Images now work like Google Docs: an **insert-image icon in the top toolbar** drops the image at the
caret, and from there it is dragged, resized and given a text-wrapping mode.

The five modes, from the bubble toolbar that appears when an image is selected:

| Mode | `data-layout` | Behaviour |
|---|---|---|
| In line with text | `inline` | Sits in the text like one very large character |
| Wrap text | `wrap` | Floats left or right, text flows around it |
| Break text | `break` | Own line, text above and below (**the default on insert**) |
| Behind text | `behind` | Free-positioned, text paints on top |
| In front of text | `front` | Free-positioned, paints on top of the text |

Two things must survive the copy, or the feature breaks in ways that are easy to miss:

- **`.editor-content` keeps `position: relative` *and* `isolation: isolate`.** The "behind text"
  mode uses `z-index: -1`; without its own stacking context the image sinks behind the opaque
  `.main-content` background and disappears entirely.
- **The overlay lives inside `.editor-surface`, not the scroll container.** That is what keeps the
  selection ring and handles glued to the image while the entry scrolls.

Placement lives in the entry HTML (`<figure class="doc-image" data-image-id … data-layout …>`); the
bytes stay in the `journal_images` table and are patched in at load time. See `../ARCHITECTURE.md`
§12. No main-process, preload or IPC work is involved — `image:add` / `image:list` / `image:delete`
are unchanged.

Chromium renders identically on Linux, so **no Linux-specific changes are needed here**. The one
thing to confirm on a Linux box is pointer behaviour under your compositor (X11 and Wayland both):
drag, drop and corner-resize all run on `pointerdown`/`pointermove`/`pointerup`.

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
9. Toolbar image icon inserts a picture at the caret, selected, on its own line
10. Clicking an image shows the outline, four corner handles and the layout bubble
11. Dragging an image shows a blue drop caret and moves it through the text; "behind"/"front"
    images follow the pointer freely
12. Corner handles resize; the percentage in the bubble tracks the drag
13. A "behind text" image stays visible with text drawn over it (not swallowed by the background)
14. Layout, size and position survive switching entries and restarting the app

> The full per-behaviour checklist lives in `../windows-app/AGENT-IMAGE-PLACEMENT-UPDATE.md` — the
> Linux app should pass it identically.

> **Next**: Data-sync agent (`agent-linux-data-sync.md`).
