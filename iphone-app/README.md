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
- AI Assistant — chat with OpenAI over your entries (same feature as the desktop apps; key stored in Keychain, request goes device → OpenAI directly, never through the sync server)
- Rich text with **placed images** — see below
- Push notification support for sync conflicts (stretch goal)

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

## Notes
- Will reuse the same server API and sync protocol
- No development work should begin until server API is stable and tested
