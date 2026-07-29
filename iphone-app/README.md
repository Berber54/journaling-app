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
- Push notification support for sync conflicts (stretch goal)

## Notes
- Will reuse the same server API and sync protocol
- No development work should begin until server API is stable and tested
