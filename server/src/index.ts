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

const app = express();

app.use(helmet());

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(requestLogger);

app.use('/api/auth', authRouter);
app.use('/api/journals', journalsRouter);
app.use('/api/health', healthRouter);
app.use('/api/sync', syncRouter);

app.use(errorHandler);

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] Custom Journal API running on port ${config.port}`);
  console.log(`[server] Environment: ${config.nodeEnv}`);
  console.log(`[server] Database: ${config.dbPath}`);
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
