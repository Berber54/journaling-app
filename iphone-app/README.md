# iPhone App — Custom Journal

> **Status**: Deferred — will be developed after the server and desktop apps are complete.

## Planned Tech Stack
- **Language**: Swift 6
- **UI Framework**: SwiftUI
- **Local Storage**: SwiftData / Core Data with SQLite
- **Networking**: URLSession
- **Auth**: Keychain for token storage
- **Sync**: Same REST API + sync protocol as desktop apps (see `../ARCHITECTURE.md`)

## Requirements (Same as Desktop)
- PIN / Face ID / Touch ID lock
- Lock on app background
- Offline-first with background sync
- Manual date override for journal entries
- Journal export — write out all entries or a chosen few as Markdown / plain text / JSON files, so they can be handed to an external AI tool or any other app (see below)
- Rich text with **placed images** — see below
- **Entry list without previews** and **colour themes** — see below
- Push notification support for sync conflicts (stretch goal)

## Entry List and Themes

Two desktop behaviours that the phone has to match in spirit rather than pixel-for-pixel.

**The entry list shows title and date only.** No snippet of the entry body, anywhere — not in the
list, not in a widget, not in a notification. The desktop apps removed content previews deliberately:
the list is on screen while you write, and yesterday's words shouldn't be. Follow the same rule.

The desktop's *collapsible* sidebar has no direct iPhone equivalent — on a phone the list is already
a separate screen. The requirement it encodes is that **the writing surface can be the whole
screen**: no persistent list rail, and nothing that reserves horizontal space next to the editor. On
iPad, where a split view does show both, port the collapse behaviour properly: a toggle in the entry
screen's header, collapsing to an icon rail that still offers new-entry, export and settings, plus
the sync dot.

**Themes.** Six dark palettes ship on desktop: `midnight` (default), `black` (true `#000`, for
OLED — and the one that matters most on a phone), `graphite`, `evergreen`, `plum`, `ember`. Port
them from **`windows-app/src/shared/themes.ts`** (ids, labels) and the `:root[data-theme='…']`
blocks in `windows-app/src/renderer/styles/global.css` (the actual values) — matching ids and
colours, so a user switching between phone and laptop sees the same journal.

Requirements:
- **A picker in Settings**, mirroring the desktop's Appearance section: a swatch per theme, applied
  immediately.
- **Local, not synced.** The desktop stores the choice in `app_config` under `theme` and never puts
  it in the sync payload (`../ARCHITECTURE.md` §4.2, §14). Store it in `UserDefaults` and do the
  same — a phone set to Pure Black must not repaint the desktop.
- **Every surface from the palette.** Define the colours once (a SwiftUI `Environment` value or an
  asset catalogue per theme) and never hard-code a background in a view — the same rule that makes
  the desktop themes a variable swap instead of a rewrite.
- **Pure Black means `#000`.** No elevated-grey cards, no tinted overlays; the lock screen loses its
  coloured glow in that theme too.
- **The launch screen follows the theme**, the way the desktop paints the window's `backgroundColor`
  before the UI loads, so a black install never flashes navy.

## Placed Images

The desktop apps treat an image as an object placed *in* the document, the way Google Docs does —
not as a gallery pinned under the text. The iPhone app has to honour the same document model,
because placement travels in the entry HTML and therefore syncs between devices.

An image is stored in the entry as a placeholder that records where it sits and how text behaves
around it; the bytes live in a separate local table and do **not** sync:

```html
<figure class="doc-image" data-image-id="…" data-layout="break"
        data-align="center" data-width="55" contenteditable="false"><img alt=""></figure>
```

| `data-layout` | Text behaviour |
|---|---|
| `inline` | Image sits in the text like one very large character |
| `wrap` | Floats to `data-align` (left/right), text flows around it |
| `break` | Own line, text above and below; `data-align` = left/centre/right |
| `behind` | Free-positioned at `data-x` (% of column width) / `data-y` (px), text drawn on top |
| `front` | Same free positioning, drawn on top of the text |

`data-width` is a percentage of the writing column, so a layout laid out on a 1200pt desktop window
still renders sensibly on a phone.

Requirements for the iPhone client:
- **Render** all five layouts faithfully — an entry written on the desktop must not reflow into
  nonsense on the phone.
- **Insert** from an image icon in the formatting toolbar, placed at the caret, defaulting to
  `break` + `center` (same default as desktop).
- **Edit placement** with touch: tap to select (selection ring + corner handles + a layout bubble),
  drag to move, pinch or drag a corner to resize. Long-press-to-drag is the natural touch analogue
  of the desktop's 4px drag threshold.
- **Missing bytes are normal.** An entry synced from a desktop references image ids this device has
  never seen. Render a placeholder in the right spot ("Image not available on this device") — never
  drop the figure from the HTML, or the placement is destroyed for every other device.
- **Never strip unknown markup** when saving an entry. Round-trip the HTML you were given.

See `../ARCHITECTURE.md` §12 for the full model, and
`../windows-app/AGENT-IMAGE-PLACEMENT-UPDATE.md` for the behaviour checklist the desktop apps pass.

## Journal Export

The desktop apps can write entries out as files (`../ARCHITECTURE.md` §11). The iPhone app should
offer the same thing through the standard share sheet — the phone equivalent of the desktop's save
dialog — so an export can go to Files, iCloud Drive, Mail, or straight into another app.

Requirements:
- **Select** all entries or a subset, from the entry list (multi-select) and from an open entry.
- **Formats**: Markdown, plain text, JSON. Match the desktop output byte-for-byte where possible —
  the same headings, the same date formatting, the same attachment placeholders — so a journal
  exported from a phone and one exported from a laptop read identically.
- **Render entry HTML to text on device.** `windows-app/src/main/entryText.ts` is the reference
  implementation and is deliberately dependency-free; port its rules rather than inventing new ones.
  Blocks separated by a blank line, `<br>` a single newline, `**bold**`/`*italic*` in Markdown only,
  colour and underline dropped, `<figure>` replaced by a photo/video placeholder.
- **Attachments are optional.** With them on, the export is a folder (or a zip for the share sheet)
  containing `media/`; with them off, each one becomes a short placeholder. A file whose bytes have
  not synced to the phone yet is reported, never silently linked.
- **Ordering**: oldest first, whatever order the user selected them in.
- Entirely local — the export must work with no server reachable.

## Notes
- Will reuse the same server API and sync protocol
- No development work should begin until server API is stable and tested
