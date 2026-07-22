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
} as const;

if (config.jwtSecret === 'change-me-to-random-64-char-string' && config.nodeEnv === 'production') {
  console.error('FATAL: JWT_SECRET must be changed in production. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
