export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  journal_date: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// An image travelling over the sync protocol. `data` is a base64 data URL for a
// live image and an empty string for a tombstone (deleted = true).
export interface SyncImage {
  id: string;
  journal_id: string;
  data: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ─── Media (protocol v2) ─────────────────────────────────────
// Photos and videos sync as two separate things: a small metadata record that
// travels in the sync payload below, and the bytes themselves, which move over
// the resumable /api/media endpoints. Nothing ever base64-encodes a file into
// JSON — that was v1, and it could not carry video.

export type MediaKind = 'image' | 'video';

export interface MediaRecord {
  id: string;
  journal_id: string;
  kind: MediaKind;
  /** Content type of the stored bytes, e.g. `image/jpeg`, `video/mp4`. */
  mime: string;
  /** Full size of the finished file. The transfer is complete at this many bytes. */
  bytes: number;
  /** Hex sha256 of the finished file — the integrity check after a transfer. */
  sha256: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** How much of a file the far end already holds — the resume cursor. */
export interface MediaStatus {
  id: string;
  bytes: number;
  uploaded: number;
  complete: boolean;
}

export interface SyncRequest {
  lastSyncTimestamp: string | null;
  entries: JournalEntry[];
  /** v1 clients inline image bytes here. Still accepted, never sent back. */
  images?: SyncImage[];
  media?: MediaRecord[];
}

export interface SyncResponse {
  entries: JournalEntry[];
  /** Always empty from a v2 server: bytes come from /api/media instead. */
  images: SyncImage[];
  media: MediaRecord[];
  serverTimestamp: string;
  conflicts: ConflictRecord[];
}

export interface ConflictRecord {
  entryId: string;
  clientUpdatedAt: string;
  serverUpdatedAt: string;
  resolution: 'server_wins' | 'client_wins';
}

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  expiresAt: string;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface JournalRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  journal_date: string;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface ImageRow {
  id: string;
  user_id: string;
  journal_id: string;
  data: string;
  created_at: string;
  updated_at: string;
  deleted: number;
}

// No transfer cursor is stored: how much of a blob exists is read from the file
// on disk, so there is no second copy of that truth to fall out of step.
export interface MediaRow {
  id: string;
  user_id: string;
  journal_id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  sha256: string;
  created_at: string;
  updated_at: string;
  deleted: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
