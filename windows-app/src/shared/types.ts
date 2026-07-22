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

// ─── LLM Chat ────────────────────────────────────────────────
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Sync Payloads ───────────────────────────────────────────
export interface SyncRequest {
  lastSyncTimestamp: string | null;
  entries: JournalEntry[];
}

export interface SyncResponse {
  entries: JournalEntry[];
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

  // Images
  imageAdd: (journalId: string, data: string) => Promise<JournalImage>;
  imageList: (journalId: string) => Promise<JournalImage[]>;
  imageDelete: (id: string) => Promise<void>;

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

  // LLM (OpenAI) — chat over journal entries
  llmChat: (params: { model: string; messages: ChatMessage[] }) => Promise<string>;

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
