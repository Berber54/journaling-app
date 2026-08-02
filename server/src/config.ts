import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Read the .env that sits next to the install, not one relative to whatever
// directory the process happened to start in. A service launched without a
// WorkingDirectory (systemd, pm2, a shell in $HOME) otherwise silently gets no
// .env at all — and because dbPath/mediaPath below are resolved against
// PROJECT_ROOT, the database and media keep working, so the *only* visible
// symptom is that .env-only settings like JWT_SECRET or MAX_MEDIA_BYTES come up
// as their defaults.
const ENV_PATH = path.resolve(PROJECT_ROOT, '.env');
const rootEnv = dotenv.config({ path: ENV_PATH });
// Still honour a .env in the working directory, but only for keys the install's
// own .env didn't define (dotenv never overwrites an already-set variable).
dotenv.config();

// Where the config came from, so startup can say so out loud. Chasing a missing
// key is much easier when the log names the file the server actually read.
export const envFileStatus = rootEnv.error
  ? `no .env found at ${ENV_PATH}`
  : `loaded ${ENV_PATH}`;

export const config = {
  port: parseInt(process.env.PORT || '3377', 10),
  jwtSecret: process.env.JWT_SECRET || 'change-me-to-random-64-char-string',
  dbPath: path.resolve(PROJECT_ROOT, process.env.DB_PATH || './data/journals.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  // ─── Media blobs ───────────────────────────────────────────
  // Photo and video bytes are stored as files, not in SQLite: a video is far
  // too big to hold in a database row (or in a JSON sync payload). Point this
  // at an external disk if the Pi's SD card is small.
  mediaPath: path.resolve(PROJECT_ROOT, process.env.MEDIA_PATH || './data/media'),
  // Largest single file the server will accept, in bytes. Default 2 GB.
  maxMediaBytes: parseInt(process.env.MAX_MEDIA_BYTES || String(2 * 1024 * 1024 * 1024), 10),
  jwtExpiresIn: '24h',
  bcryptRounds: 12,
} as const;

if (config.jwtSecret === 'change-me-to-random-64-char-string' && config.nodeEnv === 'production') {
  console.error('FATAL: JWT_SECRET must be changed in production. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
