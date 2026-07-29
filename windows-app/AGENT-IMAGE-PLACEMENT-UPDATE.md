# Agent: Image Placement Update — Windows Test Pass

> **Role**: Verify (and if needed, fix) the new Google-Docs-style image placement in the Windows app.
> **Status of the code**: already implemented and merged. The renderer files were developed and
> verified on macOS and copied verbatim into `windows-app/src/renderer/`. Nothing has been run on
> Windows yet — that is your job.
> **Reference**: `../ARCHITECTURE.md` §12 (rich text & images), §4.2 (why image *bytes* don't sync).

---

## What changed

Images used to be a gallery strip pinned under the text: an "+ Add image" tile at the bottom of the
editor, thumbnails in a row, no way to say where in the entry an image belonged. They read as
floating randomly in the middle of the entry.

Now an image is a **placed object inside the document**, like in Google Docs:

- an **insert-image icon in the top formatting toolbar** (right of the colour swatches) inserts the
  image at the caret;
- clicking an image selects it — blue outline, four corner resize handles, and a floating bubble
  toolbar above it;
- **dragging** an image moves it: through the text (a caret line shows where it will land) for the
  anchored modes, or freely anywhere on the page for the floating modes;
- the bubble offers the five Google Docs text-behaviour modes, alignment, the current width, and a
  trash button.

| Mode | `data-layout` | Behaviour |
|---|---|---|
| In line with text | `inline` | Sits in the text like one very large character |
| Wrap text | `wrap` | Floats left or right, text flows around it |
| Break text | `break` | Own line, text above and below (**the default on insert**) |
| Behind text | `behind` | Free-positioned, text paints on top (`z-index: -1`) |
| In front of text | `front` | Free-positioned, paints on top of the text (`z-index: 4`) |

Alignment applies to `wrap` (left/right) and `break` (left/centre/right). Dragging a `wrap` image
to the left or right half of the column flips its side automatically.

---

## Files involved

| File | What it holds |
|---|---|
| `src/renderer/lib/docImages.ts` | **New.** The figure model: create/read/write placement, hydrate `src` on load, strip it on save |
| `src/renderer/components/ImageOverlay.tsx` | **New.** Selection ring, resize handles, bubble toolbar (inline SVG icons) |
| `src/renderer/components/JournalEditor.tsx` | Rewired: toolbar button, drag/resize pointer session, selection state, orphan cleanup |
| `src/renderer/styles/editor.css` | `figure.doc-image` layout rules + overlay styling; the old `.editor-image*` gallery styles are gone |

**No main-process, preload, database or IPC changes.** `image:add` / `image:list` / `image:delete`
are unchanged, and so is the `journal_images` table.

### How placement is stored

The bytes stay in `journal_images`. The entry HTML carries only a placeholder:

```html
<figure class="doc-image" data-image-id="…" data-layout="break"
        data-align="center" data-width="55" contenteditable="false"><img alt=""></figure>
```

`src` and the geometry styles are added at load time and stripped again on save, so entries stay
small and sync payloads never carry base64. A consequence worth knowing: **placement syncs, pixels
don't.** On a device that doesn't have the image row, the figure renders as a dashed
"Image not available on this device" box in the right spot.

Entries created before this change kept their images in the old gallery, unreferenced by the HTML.
On first open, those are appended to the end of the document as `break` figures and saved. That
migration is one-way and runs once per entry.

---

## Setup

```powershell
cd windows-app
npm install
npx @electron/rebuild     # better-sqlite3 / bcrypt against Electron's ABI
npm run dev               # Vite on 5173 + Electron
```

If `npm run dev` throws `NODE_MODULE_VERSION … requires …` or `ERR_DLOPEN_FAILED`, the rebuild step
was skipped — see `../ARCHITECTURE.md` §13.3.

Type-check before anything else; the renderer was only compiled on macOS:

```powershell
npx tsc -p tsconfig.renderer.json --noEmit
npm run build
```

---

## Test checklist

Create an entry with several paragraphs of text first — wrapping and dragging need text to interact
with.

**Insert**
1. The toolbar shows a picture icon to the right of the colour swatches. Hover: "Insert image — then drag it where you want it".
2. Put the caret mid-paragraph, click it, pick a PNG. The image lands **at the caret**, on its own line, centred, selected, with the bubble toolbar visible.
3. Select several files at once → all insert in order.
4. Insert with the caret in an empty entry → image lands with a typable line after it.

**Select / deselect**
5. Click the image → outline, four handles, bubble. Click the text → all of it disappears.
6. `Esc` deselects. `Delete` / `Backspace` while selected removes the image.
7. With one image selected, clicking a *second* image moves the selection to it (does not just deselect).

**Layout modes**
8. Each of the five bubble buttons applies, and the active one is highlighted.
9. `Wrap text` → the text flows around the image; alignment buttons show only left/right.
10. `Break text` → left / centre / right alignment all visibly change the position.
11. `Behind text` → **the image must still be visible with the text drawn over it.** If it vanishes, a stacking context is missing — check `isolation: isolate` on `.editor-content` in `editor.css`.
12. `In front of text` → the image covers the text.

**Drag**
13. Drag an `inline`/`wrap`/`break` image: a blue caret line (vertical for inline/wrap, a full-width rule for break) shows the drop point; releasing moves the image there. A small movement under ~4px is treated as a click, not a drag.
14. Drag a `wrap` image across the middle of the column → it flips between float-left and float-right.
15. Drag a `behind`/`front` image → it follows the pointer anywhere, including over the text.
16. Switching from an anchored mode to a floating mode must **not** make the image jump to the corner — it keeps its current position.

**Resize**
17. Drag each of the four corner handles. Width tracks the pointer, the percentage in the bubble updates, aspect ratio is preserved, and it clamps between 8% and 100%.

**Persistence**
18. Wait for "Saved", switch to another entry and back → layout, alignment, size and position all survive.
19. Restart the app → same.
20. Delete an image, wait ~2s, restart → it stays gone (the debounced save reconciles unreferenced rows out of `journal_images`).

**Regression**
21. Bold / italic / underline / colour still work, and the caret does **not** jump to the start of the entry a second after you stop typing.
22. The sidebar preview and "Ask AI about this entry" show entry text with no HTML noise from the figures.
23. Resize the window with an image selected → the overlay stays aligned with the image.

---

## Known limitations (expected, not bugs)

- Image bytes are local to the device; only placement syncs (`../ARCHITECTURE.md` §4.2).
- Dragging does not auto-scroll the entry when you reach the top or bottom edge of the viewport.
- There is no undo for a deleted image beyond re-inserting the file.

> Report anything Windows-specific you had to change back into `../ARCHITECTURE.md` §12, and mirror
> renderer fixes into `../mac-app/` and `../linux-app/` so the three stay identical.
