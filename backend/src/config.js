import 'dotenv/config';
import './lib/dbUrl.js';
import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  // Render sets RENDER_EXTERNAL_URL automatically; it becomes the default public origin.
  APP_ORIGIN: z.string().url().default(process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173'),
  CORS_ORIGINS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(120),
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: z.string().default('false'),
  UPLOAD_DIR: z.string().default('uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(20),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JOBS_ENABLED: bool.default('true'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('O2 Support Hub <no-reply@o2support.local>'),
  APP_NAME: z.string().default('O2 Support Hub'),
  // 'local' keeps uploads on disk (UPLOAD_DIR); 'db' stores them in Postgres for hosts without a persistent disk.
  STORAGE_DRIVER: z.enum(['local', 'db']).default(process.env.RENDER ? 'db' : 'local'), // Render's free disk is wiped on every deploy
  LOGIN_RATE_LIMIT: z.coerce.number().int().default(10),
  // Optional: absolute path of the built frontend (frontend/dist). When set, the API also serves the web app.
  SERVE_WEB_DIR: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration:', JSON.stringify(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)));
  process.exit(1);
}

const env = parsed.data;
export const config = {
  ...env,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  corsOrigins: (env.CORS_ORIGINS || env.APP_ORIGIN).split(',').map((s) => s.trim()).filter(Boolean),
  emailConfigured: Boolean(env.SMTP_URL),
};

// Plain-HTTP intranet installs (no TLS yet) must opt in explicitly; session cookies are then sent unencrypted.
if (config.isProd && !config.cookieSecure && process.env.ALLOW_INSECURE_HTTP !== 'true') {
  console.error('Refusing to start: COOKIE_SECURE must be true in production (or set ALLOW_INSECURE_HTTP=true for a plain-HTTP internal network).');
  process.exit(1);
}
