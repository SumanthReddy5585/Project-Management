import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { randomToken, sha256, safeEqual } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export const COOKIE = config.cookieSecure ? '__Host-sid' : 'sid';
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: config.SESSION_TTL_HOURS * 3600 * 1000 });

export async function createSession(res, { userId, organizationId, ip, userAgent }) {
  const token = randomToken();
  const session = await prisma.session.create({
    data: { tokenHash: sha256(token), userId, organizationId, csrfToken: randomToken(24), ip, userAgent: userAgent?.slice(0, 300),
      expiresAt: new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000) },
  });
  res.cookie(COOKIE, token, cookieOpts());
  return session;
}

export async function destroySession(req, res) {
  if (req.auth?.sessionId) await prisma.session.deleteMany({ where: { id: req.auth.sessionId } });
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
}

/** Loads req.auth when a valid session cookie is present. Never throws for anonymous requests. */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  const now = Date.now();
  const idleMs = config.SESSION_IDLE_MINUTES * 60000;
  if (!s || s.expiresAt.getTime() < now || now - s.lastSeenAt.getTime() > idleMs) {
    if (s) await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    res.clearCookie(COOKIE, { path: '/' });
    return next();
  }
  const m = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: s.organizationId, userId: s.userId } } });
  if (!m || m.status !== 'ACTIVE') { await prisma.session.delete({ where: { id: s.id } }); return next(); }
  if (now - s.lastSeenAt.getTime() > 60000) await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
  req.auth = {
    sessionId: s.id, csrfToken: s.csrfToken, userId: s.userId, orgId: s.organizationId, orgRole: m.role,
    customerCompanyId: m.customerCompanyId, isCustomer: m.role === 'CUSTOMER', user: { id: s.user.id, name: s.user.name, email: s.user.email },
  };
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.auth) throw unauthorized();
  next();
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * CSRF: session cookies are SameSite=Lax; additionally every state-changing request from an
 * authenticated session must echo the per-session token in X-CSRF-Token (synchronizer token),
 * and any request carrying an Origin header must come from an allowed origin.
 */
export function csrfGuard(req, _res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.get('origin');
  // Same-origin requests (page and API on the same scheme+host+port, whatever the hostname) are always allowed;
  // a cross-site page cannot make the browser send a Host header matching its own Origin.
  const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
  if (origin && !sameOrigin && !config.corsOrigins.includes(origin) && origin !== config.APP_ORIGIN) {
    throw forbidden(`Requests from ${origin} are not allowed. Open the app at ${config.APP_ORIGIN}, or add this address to CORS_ORIGINS.`);
  }
  if (req.auth && !safeEqual(req.get('x-csrf-token') || '', req.auth.csrfToken)) throw forbidden('Invalid or missing CSRF token');
  next();
}
