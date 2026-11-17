import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { AppError } from './lib/errors.js';
import { loadSession, requireAuth, csrfGuard } from './auth/session.js';
import authRoutes from './routes/auth.js';
import orgRoutes from './routes/org.js';
import projectRoutes from './routes/projects.js';
import workRoutes from './routes/workItems.js';
import collabRoutes from './routes/collaboration.js';
import fileRoutes from './routes/files.js';
import timeRoutes from './routes/time.js';
import ticketRoutes from './routes/tickets.js';
import deliverableRoutes from './routes/deliverables.js';
import reportRoutes from './routes/reports.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY !== 'false') app.set('trust proxy', /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY);

  app.use((req, res, next) => { req.id = req.get('x-request-id')?.slice(0, 64) || crypto.randomUUID(); res.set('X-Request-Id', req.id); next(); });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, customLogLevel: (_q, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url }), res: (r) => ({ statusCode: r.statusCode }) } }));
  const apiHeaders = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, crossOriginResourcePolicy: { policy: 'same-site' } });
  const webHeaders = helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
    // Only force https when the app is actually served over https; otherwise plain-http access by IP or hostname would break.
    upgradeInsecureRequests: config.cookieSecure ? [] : null } }, strictTransportSecurity: config.cookieSecure });
  const isApi = (p) => p.startsWith('/api') || p === '/health' || p === '/ready';
  app.use((req, res, next) => (isApi(req.path) ? apiHeaders : webHeaders)(req, res, next));
  app.use(cors({ origin: config.corsOrigins, credentials: true, allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'], maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/health', (_q, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_q, res) => {
    try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ready' }); } catch { res.status(503).json({ status: 'unavailable' }); }
  });

  const api = express.Router();
  api.use(loadSession);
  api.use(csrfGuard);
  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/org', orgRoutes);
  api.use('/projects', projectRoutes);
  api.use('/projects/:projectId', workRoutes);
  api.use('/projects/:projectId', deliverableRoutes);
  api.use('/', collabRoutes);
  api.use('/files', fileRoutes);
  api.use('/time', timeRoutes);
  api.use('/tickets', ticketRoutes);
  api.use('/', reportRoutes);
  app.use('/api', api);

  app.use('/api', (_q, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));

  // Single-address local mode: serve the built SPA (frontend/dist) with history fallback.
  if (config.SERVE_WEB_DIR) {
    const dir = path.resolve(config.SERVE_WEB_DIR);
    const index = path.join(dir, 'index.html');
    if (!fs.existsSync(index)) throw new Error(`SERVE_WEB_DIR has no index.html: ${dir}`);
    app.use(express.static(dir, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/).*/, (_q, res) => res.set('Cache-Control', 'no-store').sendFile(index));
  }

  // Centralized error handler: consistent envelope, no stack traces or internals in responses.
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details }, requestId: req.id });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' }, requestId: req.id });
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: `Files must be under ${config.MAX_UPLOAD_MB} MB` }, requestId: req.id });
    if (err?.code === 'P2002') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists' }, requestId: req.id });
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Reference the request id when reporting this.' }, requestId: req.id });
  });
  return app;
}
