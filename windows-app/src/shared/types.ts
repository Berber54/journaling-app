// ─── Journal Entry ───────────────────────────────────────────
export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  journal_date: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ─── Journal Image ───────────────────────────────────────────
export interface JournalImage {
  id: string;
  journal_id: string;
  data: string; // data: URL (base64-encoded image)
  created_at: string;
}

// An image as it travels over the sync protocol. `data` is empty for a
// tombstone (deleted = true). See ARCHITECTURE §8.
export interface SyncImage {
  id: string;
  journal_id: string;
  data: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

// ─── Media (protocol v2) ─────────────────────────────────────
// Photos and videos are two separate things on the wire: a small metadata
// record that rides along in the sync payload, and the bytes themselves, which
// move over the resumable /api/media endpoints and are stored as files on disk.
// v1 base64'd images into the sync JSON, which could never carry video.

export type MediaKind = 'image' | 'video';

/** The metadata record that syncs. Bytes are transferred separately. */
export interface MediaRecord {
  id: string;
  journal_id: string;
  kind: MediaKind;
  mime: string;
  /** Full size of the finished file; a transfer is complete at this many bytes. */
  bytes: number;
  /** Hex sha256 of the finished file — the integrity check after a transfer. */
  sha256: string;
  created_at: string;
  updated_at: string;
  deleted: boolean;
}

/** How much of a file the far end holds — the resume cursor. */
export interface MediaStatus {
  id: string;
  bytes: number;
  uploaded: number;
  complete: boolean;
}

/** One attachment as the renderer sees it. */
export interface JournalMedia {
  id: string;
  journal_id: string;
  kind: MediaKind;
  mime: string;
  bytes: number;
  /** `journal-media://<id>` — usable straight as an <img>/<video> src. */
  url: string;
  /** False while the bytes are still downloading from the server. */
  available: boolean;
  created_at: string;
}

// ─── Export ──────────────────────────────────────────────────
// Entries leave the app as plain files so they can be handed to anything that
// reads text — an external LLM, another journal, a backup folder. Nothing about
// this touches the server: the local database already holds every entry.

export type ExportFormat = 'markdown' | 'text' | 'json';

/** One file holding every entry, or one file per entry. */
export type ExportLayout = 'single' | 'per-entry';

export interface ExportOptions {
  /** Entry ids to export, or `null` for every (non-deleted) entry. */
  ids: string[] | null;
  format: ExportFormat;
  layout: ExportLayout;
  /** Copy the referenced photos and videos alongside the text. */
  includeMedia: boolean;
}

export interface ExportResult {
  /** True when the user dismissed the save/folder dialog — not an error. */
  canceled: boolean;
  /** The file (single, no media) or the folder that was written. */
  path: string;
  entryCount: number;
  fileCount: number;
  /** Attachments left out because their bytes haven't synced to this device. */
  missingMediaCount: number;
}

// ─── Sync Payloads ───────────────────────────────────────────
export interface SyncRequest {
  lastSyncTimestamp: string | null;
  entries: JournalEntry[];
  /** v1 inlined image bytes here. Sent only by old clients. */
  images?: SyncImage[];
  media?: MediaRecord[];
}

export interface SyncResponse {
  entries: JournalEntry[];
  /** Always empty from a v2 server — bytes come from /api/media instead. */
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

// ─── Auth ────────────────────────────────────────────────────
export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  expiresAt: string;
}

// ─── API Error ───────────────────────────────────────────────
export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ─── Sync Status ─────────────────────────────────────────────
export interface SyncStatus {
  online: boolean;
  lastSync: string | null;
  pendingCount: number;
  syncing: boolean;
  /** Files whose bytes still have to move, in either direction. */
  pendingMediaCount: number;
  /** The transfer currently in flight, for progress display. */
  transfer: MediaTransferProgress | null;
}

export interface MediaTransferProgress {
  id: string;
  kind: MediaKind;
  direction: 'upload' | 'download';
  /** Bytes moved so far, out of `total`. */
  done: number;
  total: number;
}

// ─── IPC Channel Types ──────────────────────────────────────
export interface ElectronAPI {
  // Journals
  journalGetAll: () => Promise<JournalEntry[]>;
  journalGetById: (id: string) => Promise<JournalEntry | null>;
  journalCreate: (entry: { title: string; content: string; journal_date: string }) => Promise<JournalEntry>;
  journalUpdate: (id: string, updates: Partial<JournalEntry>) => Promise<JournalEntry>;
  journalDelete: (id: string) => Promise<void>;
  // Fired (main→renderer) after a sync pulls entries down, so the list reloads.
  onJournalsChanged: (callback: () => void) => () => void;

  // Media (images + video). `sourcePath` is a real path on disk, so a 2 GB
  // video never has to cross the IPC bridge or become a base64 string.
  mediaAdd: (journalId: string, sourcePath: string) => Promise<JournalMedia>;
  mediaList: (journalId: string) => Promise<JournalMedia[]>;
  mediaDelete: (id: string) => Promise<void>;
  /** Filesystem path behind a File from an <input type="file">. */
  mediaPathForFile: (file: File) => string;

  // Sync
  syncTrigger: () => Promise<{ success: boolean; message: string }>;
  syncGetStatus: () => Promise<SyncStatus>;
  onSyncStatusChange: (callback: (status: SyncStatus) => void) => () => void;

  // Lock (the secret is now an arbitrary passphrase, not just digits)
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<{ success: boolean }>;
  setPin: (password: string) => Promise<void>;
  hasPin: () => Promise<boolean>;
  isLocked: () => Promise<boolean>;
  onLockTriggered: (callback: () => void) => () => void;

  // Biometric unlock (Windows Hello — fingerprint / face / device PIN)
  biometricAvailable: () => Promise<boolean>;
  biometricVerify: (reason?: string) => Promise<boolean>;

  // Export — write entries out as files (Markdown / plain text / JSON)
  exportRun: (options: ExportOptions) => Promise<ExportResult>;
  /** Open the OS file manager on a finished export. */
  exportReveal: (target: string) => Promise<void>;

  // Settings
  settingsGet: (key: string) => Promise<string | null>;
  settingsSet: (key: string, value: string) => Promise<void>;
  settingsGetAll: () => Promise<Record<string, string>>;

  // Auth
  authLogin: (serverUrl: string, username: string, password: string) => Promise<AuthResponse>;
  authRegister: (serverUrl: string, username: string, password: string) => Promise<AuthResponse>;
  authIsConfigured: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
