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

export interface SyncRequest {
  lastSyncTimestamp: string | null;
  entries: JournalEntry[];
  images?: SyncImage[];
}

export interface SyncResponse {
  entries: JournalEntry[];
  images: SyncImage[];
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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
