import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

export const config = {
  port: parseInt(process.env.PORT || '3377', 10),
  jwtSecret: process.env.JWT_SECRET || 'change-me-to-random-64-char-string',
  dbPath: path.resolve(PROJECT_ROOT, process.env.DB_PATH || './data/journals.db'),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  jwtExpiresIn: '24h',
  bcryptRounds: 12,
  // ─── AI assistant ──────────────────────────────────────────
  // The OpenAI API key now lives on the server (never on the clients). The
  // desktop apps call POST /api/llm/chat and the server proxies to OpenAI, so
  // the key is stored in exactly one place. Empty string = AI disabled.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
} as const;

// Models the LLM proxy is allowed to forward (guards against clients asking the
// server to spend on an arbitrary/expensive model). Keep in sync with the model
// picker in the desktop apps' ChatPanel/Settings.
export const ALLOWED_LLM_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] as const;

if (config.jwtSecret === 'change-me-to-random-64-char-string' && config.nodeEnv === 'production') {
  console.error('FATAL: JWT_SECRET must be changed in production. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
