# Agent: Server Project Setup

> **Role**: Set up the Node.js + Express + TypeScript project skeleton for the Raspberry Pi 5 server.
> **Prerequisites**: SSH access to the Raspberry Pi 5 running Raspberry Pi OS Lite 64-bit. Node.js 20 LTS installed.
> **Reference**: `../ARCHITECTURE.md` for full system architecture.

---

## Deliverables

1. `package.json` — project manifest with all dependencies
2. `tsconfig.json` — TypeScript compiler config
3. `.env.example` — environment variable template
4. `src/config.ts` — environment config loader
5. `src/database.ts` — SQLite connection + schema initialization
6. `src/index.ts` — Express server entry point
7. `src/middleware/requestLogger.ts` — HTTP request logger
8. `src/middleware/errorHandler.ts` — global error handler
9. `scripts/install.sh` — automated server install script
10. `scripts/custom-journal.service` — systemd service unit

---

## Step 1: Initialize Project

```bash
mkdir -p /opt/custom-journal
cd /opt/custom-journal
```

Create **`package.json`**:

```json
{
  "name": "custom-journal-server",
  "version": "1.0.0",
  "description": "Custom Journal sync server for Raspberry Pi 5",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "express": "^4.21.0",
    "better-sqlite3": "^11.7.0",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "cors": "^2.8.5",
    "helmet": "^8.0.0",
    "uuid": "^11.0.0",
    "dotenv": "^16.4.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/express": "^5.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/cors": "^2.8.0",
    "@types/uuid": "^10.0.0",
    "tsx": "^4.19.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

---

## Step 2: TypeScript Configuration

Create **`tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 3: Environment Configuration

Create **`.env.example`**:

```env
# Server port (default 3377 — chosen to avoid conflicts with other services)
PORT=3377

# JWT signing secret — CHANGE THIS to a random 64-character string
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=change-me-to-random-64-char-string

# SQLite database path (relative to project root)
DB_PATH=./data/journals.db

# Environment
NODE_ENV=production

# Logging level: debug | info | warn | error
LOG_LEVEL=info
```

Create **`src/config.ts`**:

```typescript
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

// Validate critical config on startup
if (config.jwtSecret === 'change-me-to-random-64-char-string' && config.nodeEnv === 'production') {
  console.error('FATAL: JWT_SECRET must be changed in production. Generate one with:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
```

---

## Step 4: Database Setup

Create **`src/database.ts`**:

```typescript
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';

// Ensure the data directory exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Create and configure the database connection
const db = new Database(config.dbPath);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');

// Set busy timeout to 5 seconds (wait for locks instead of erroring immediately)
db.pragma('busy_timeout = 5000');

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS journals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    journal_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_journals_user_id ON journals(user_id);
  CREATE INDEX IF NOT EXISTS idx_journals_updated_at ON journals(updated_at);
  CREATE INDEX IF NOT EXISTS idx_journals_user_updated ON journals(user_id, updated_at);
`);

console.log(`[database] Connected to SQLite at ${config.dbPath}`);
console.log(`[database] WAL mode enabled, busy_timeout=5000ms`);

export default db;
```

---

## Step 5: Middleware

Create **`src/middleware/requestLogger.ts`**:

```typescript
import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  // Hook into response finish event
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';

    if (config.logLevel === 'debug' || level === 'warn' || config.logLevel === 'info') {
      console.log(
        `[${level}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`
      );
    }
  });

  next();
}
```

Create **`src/middleware/errorHandler.ts`**:

```typescript
import { Request, Response, NextFunction } from 'express';

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export class AppError extends Error {
  public statusCode: number;
  public error: string;

  constructor(statusCode: number, error: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.error = error;
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[error] ${err.name}: ${err.message}`);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.error,
      message: err.message,
      statusCode: err.statusCode,
    } satisfies ApiError);
    return;
  }

  // Unexpected errors
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    statusCode: 500,
  } satisfies ApiError);
}
```

---

## Step 6: Entry Point

Create **`src/index.ts`**:

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import db from './database.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';

// Route imports — these will be created by the API/Auth agent
// import { authRouter } from './routes/auth.js';
// import { journalsRouter } from './routes/journals.js';
// import { syncRouter } from './routes/sync.js';
// import { healthRouter } from './routes/health.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS — allow all origins (desktop apps connect from various IPs)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parser
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Mount routes — uncomment these as agents deliver them
// app.use('/api/auth', authRouter);
// app.use('/api/journals', journalsRouter);
// app.use('/api/sync', syncRouter);
// app.use('/api/health', healthRouter);

// Temporary health check until the health route agent delivers
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// Global error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] Custom Journal API running on port ${config.port}`);
  console.log(`[server] Environment: ${config.nodeEnv}`);
  console.log(`[server] Database: ${config.dbPath}`);
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[server] HTTP server closed');
    db.close();
    console.log('[server] Database connection closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[server] Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## Step 7: Install Script

Create **`scripts/install.sh`**:

```bash
#!/bin/bash
set -euo pipefail

echo "=== Custom Journal Server Installer ==="

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ is required. Current: $(node -v 2>/dev/null || echo 'not installed')"
  echo "Install with: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
echo "✓ Node.js $(node -v) detected"

# Create journal user if it doesn't exist
if ! id "journal" &>/dev/null; then
  echo "Creating 'journal' system user..."
  sudo useradd --system --no-create-home --shell /bin/false journal
  echo "✓ User 'journal' created"
else
  echo "✓ User 'journal' already exists"
fi

# Set up directory
INSTALL_DIR="/opt/custom-journal"
echo "Installing to ${INSTALL_DIR}..."

sudo mkdir -p "${INSTALL_DIR}"
sudo cp -r . "${INSTALL_DIR}/"
cd "${INSTALL_DIR}"

# Install dependencies
echo "Installing npm dependencies..."
sudo npm install --omit=dev
sudo npm run build

# Create data directory
sudo mkdir -p "${INSTALL_DIR}/data"
sudo mkdir -p "${INSTALL_DIR}/logs"

# Set up .env if not exists
if [ ! -f "${INSTALL_DIR}/.env" ]; then
  echo "Creating .env from template..."
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sudo cp .env.example .env
  sudo sed -i "s/change-me-to-random-64-char-string/${JWT_SECRET}/" .env
  echo "✓ Generated random JWT_SECRET"
fi

# Set ownership
sudo chown -R journal:journal "${INSTALL_DIR}"

# Install and enable systemd service
echo "Installing systemd service..."
sudo cp scripts/custom-journal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable custom-journal
sudo systemctl start custom-journal

echo ""
echo "=== Installation Complete ==="
echo "Service status: $(sudo systemctl is-active custom-journal)"
echo "Server URL: http://$(hostname -I | awk '{print $1}'):3377"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status custom-journal    # Check status"
echo "  sudo systemctl restart custom-journal   # Restart server"
echo "  sudo journalctl -u custom-journal -f    # View logs"
```

---

## Step 8: systemd Service File

Create **`scripts/custom-journal.service`**:

```ini
[Unit]
Description=Custom Journal Sync Server
After=network.target
Documentation=https://github.com/your-user/custom-journal

[Service]
Type=simple
User=journal
Group=journal
WorkingDirectory=/opt/custom-journal
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3377

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/custom-journal/data /opt/custom-journal/logs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

---

## Step 9: Create Directory Structure

Run these commands to create the full folder tree:

```bash
cd /opt/custom-journal
mkdir -p src/middleware src/routes src/services src/shared scripts data
```

---

## Verification Checklist

1. **Install dependencies**: `npm install`
2. **Copy .env**: `cp .env.example .env`
3. **Build**: `npm run build` — should compile with zero errors
4. **Start dev**: `npm run dev` — should print "Custom Journal API running on port 3377"
5. **Test health**: `curl http://localhost:3377/api/health` — should return `{"status":"ok","version":"1.0.0","uptime":...}`
6. **Check database**: Verify `data/journals.db` was created and has the correct tables:
   ```bash
   sqlite3 data/journals.db ".tables"
   # Expected output: journals  users
   ```

> **Next**: Hand off to the API/Auth agent (`agent-server-api-auth.md`) to build the route handlers and services.
