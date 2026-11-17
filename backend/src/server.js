import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';
import fs from 'node:fs';

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
await prisma.$queryRaw`SELECT 1`.catch((err) => { logger.fatal({ err }, 'database unreachable'); process.exit(1); });

const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT, env: config.NODE_ENV }, 'api listening'));
if (config.JOBS_ENABLED) startJobs();

let closing = false;
async function shutdown(signal) {
  if (closing) return; closing = true;
  logger.info({ signal }, 'shutting down');
  stopJobs();
  const force = setTimeout(() => { logger.error('forced shutdown'); process.exit(1); }, 15000).unref();
  server.close(async () => { await prisma.$disconnect(); clearTimeout(force); process.exit(0); });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
