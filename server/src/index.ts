import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import db from './database.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { journalsRouter } from './routes/journals.js';
import { syncRouter } from './routes/sync.js';
import { llmRouter } from './routes/llm.js';
import { mediaRouter } from './routes/media.js';
import { migrateLegacyImages } from './services/mediaMigration.js';

const app = express();

app.use(helmet());

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Media bytes are streamed straight to disk by this router, so it is mounted
// ahead of the JSON parser — a 2 GB video must never be buffered into memory as
// a request body, whatever content type it arrives with.
app.use(requestLogger);
app.use('/api/media', mediaRouter);

// Sync itself is JSON, and since v2 it carries only entries and media metadata.
// The generous limit is what still lets a legacy v1 client push base64 images.
app.use(express.json({ limit: '50mb' }));

app.use('/api/auth', authRouter);
app.use('/api/journals', journalsRouter);
app.use('/api/health', healthRouter);
app.use('/api/sync', syncRouter);
app.use('/api/llm', llmRouter);

app.use(errorHandler);

// Lift any v1 base64 images into the blob store before accepting traffic, so a
// client can never sync against a half-migrated set of media rows.
await migrateLegacyImages();

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] Custom Journal API running on port ${config.port}`);
  console.log(`[server] Environment: ${config.nodeEnv}`);
  console.log(`[server] Database: ${config.dbPath}`);
  console.log(`[server] Media blobs: ${config.mediaPath} (max ${config.maxMediaBytes} bytes per file)`);
});

function shutdown(signal: string): void {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('[server] HTTP server closed');
    db.close();
    console.log('[server] Database connection closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[server] Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
