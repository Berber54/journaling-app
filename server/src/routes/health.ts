import { type Request, type Response, Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let version = '1.0.0';
try {
  const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')) as { version?: string };
  version = pkg.version ?? version;
} catch {
  // Keep the default version if package.json is unavailable.
}

export const healthRouter = Router();

healthRouter.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    version,
    uptime: Math.floor(process.uptime()),
  });
});
