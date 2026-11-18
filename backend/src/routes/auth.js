import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { parse } from '../lib/http.js';
import { sha256, randomToken } from '../lib/crypto.js';
import { sendMail } from '../services/mail.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword, burnHash, passwordSchema } from '../auth/passwords.js';
import { createSession, destroySession } from '../auth/session.js';
import { audit } from '../services/audit.js';
import { notify } from '../services/notify.js';
import { matrix } from '../policies/permissions.js';

const r = Router();
const limiter = (max, windowMin = 15, extra = {}) => rateLimit({
  ...extra, windowMs: windowMin * 60000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email || '').toLowerCase()}`,
  handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' }, requestId: req.id }),
});
// Only failed sign-ins count toward the limit (per IP + email).
const loginLimiter = limiter(config.LOGIN_RATE_LIMIT, 15, { skipSuccessfulRequests: true });
const tokenLimiter = limiter(20);

async function mePayload(auth) {
  const [user, org, m] = await Promise.all([
    prisma.user.findUnique({ where: { id: auth.userId } }),
    prisma.organization.findUnique({ where: { id: auth.orgId } }),
    prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: auth.orgId, userId: auth.userId } }, include: { customerCompany: true } }),
  ]);
  return {
    user: { id: user.id, name: user.name, email: user.email, title: user.title, department: user.department, phone: user.phone },
    mustChangePassword: user.mustChangePassword,
    organization: { id: org.id, name: org.name, timezone: org.timezone },
    role: m.role, customerCompany: m.customerCompany ? { id: m.customerCompany.id, name: m.customerCompany.name } : null,
    csrfToken: auth.csrfToken, emailDelivery: config.emailConfigured ? 'CONFIGURED' : 'NOT_CONFIGURED', permissions: matrix,
  };
}

r.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { memberships: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } } } });
  if (!user) { await burnHash(password); throw unauthorized('Invalid email or password'); }
  if (!(await verifyPassword(user.passwordHash, password)) || !user.memberships.length) throw unauthorized('Invalid email or password');
  const m = user.memberships[0];
  await prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
  const s = await createSession(res, { userId: user.id, organizationId: m.organizationId, ip: req.ip, userAgent: req.get('user-agent') });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const auth = { userId: user.id, orgId: m.organizationId, csrfToken: s.csrfToken };
  await audit(prisma, auth, { action: 'auth.login', entityType: 'User', entityId: user.id }, req.ip);
  res.json(await mePayload(auth));
});

r.post('/logout', async (req, res) => {
  if (req.auth) await audit(prisma, req.auth, { action: 'auth.logout', entityType: 'User', entityId: req.auth.userId }, req.ip);
  await destroySession(req, res);
  res.status(204).end();
});

r.get('/me', async (req, res) => {
  if (!req.auth) throw unauthorized();
  res.json(await mePayload(req.auth));
});

async function findInvite(token) {
  const inv = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { organization: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) throw badRequest('This invitation is invalid or has expired');
  return inv;
}

r.get('/invitations/:token', tokenLimiter, async (req, res) => {
  const inv = await findInvite(req.params.token);
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  res.json({ email: inv.email, name: inv.name, role: inv.role, organization: inv.organization.name, existingAccount: Boolean(existing) });
});

r.post('/invitations/accept', tokenLimiter, async (req, res) => {
  const body = parse(z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(1).max(120).optional(), password: z.string().max(200) }), req.body);
  const inv = await findInvite(body.token);
  const existing = await prisma.user.findUnique({ where: { email: inv.email } });
  if (existing) {
    if (!(await verifyPassword(existing.passwordHash, body.password))) throw unauthorized('Enter your existing password to join this organization');
  } else parse(z.object({ password: passwordSchema, name: z.string().trim().min(1) }), body);
  const user = await prisma.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (!claimed.count) throw badRequest('This invitation has already been used');
    const u = existing ?? await tx.user.create({ data: { email: inv.email, name: body.name, passwordHash: await hashPassword(body.password), title: inv.title, department: inv.department } });
    if (existing && (inv.title || inv.department) && !existing.title) await tx.user.update({ where: { id: existing.id }, data: { title: inv.title, department: inv.department } });
    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: inv.organizationId, userId: u.id } },
      create: { organizationId: inv.organizationId, userId: u.id, role: inv.role, customerCompanyId: inv.customerCompanyId },
      update: { role: inv.role, customerCompanyId: inv.customerCompanyId, status: 'ACTIVE' },
    });
    await audit(tx, { orgId: inv.organizationId, userId: u.id }, { action: 'invitation.accepted', entityType: 'Invitation', entityId: inv.id, metadata: { role: inv.role } }, req.ip);
    await notify(tx, { orgId: inv.organizationId, userIds: [inv.invitedById], type: 'invitation.accepted', title: `${u.name} joined ${inv.organization.name}`, link: '/admin/users' });
    return u;
  });
  const s = await createSession(res, { userId: user.id, organizationId: inv.organizationId, ip: req.ip, userAgent: req.get('user-agent') });
  res.status(201).json(await mePayload({ userId: user.id, orgId: inv.organizationId, csrfToken: s.csrfToken }));
});

// Self-service reset request. With email configured the user receives a one-time link (valid 1 hour);
// otherwise org admins are notified and can issue a link from Settings -> Users. The response never
// reveals whether the account exists.
r.post('/password/forgot', tokenLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email().max(200) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { memberships: { where: { status: 'ACTIVE' } } } });
  if (user && user.memberships.length) {
    if (config.emailConfigured) {
      const token = randomToken();
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) } });
      await sendMail({ to: user.email, subject: 'Reset your O2 Support Hub password', heading: 'Reset your password',
        body: `Hi ${user.name},\n\nSomeone asked to reset the password for this account. The link below works once and expires in 1 hour. If it wasn't you, you can ignore this email.`,
        cta: 'Choose a new password', url: `${config.APP_ORIGIN}/reset-password?token=${token}` });
    } else {
      for (const m of user.memberships) {
        const admins = await prisma.membership.findMany({ where: { organizationId: m.organizationId, role: 'ADMIN', status: 'ACTIVE' }, select: { userId: true } });
        await notify(prisma, { orgId: m.organizationId, userIds: admins.map((a) => a.userId), type: 'password.reset_requested', title: `${user.name} requested a password reset`,
          body: 'Issue a reset link from Settings → Users.', link: '/settings/users', dedupeKey: `pwreset:${user.id}:${new Date().toISOString().slice(0, 13)}` });
      }
    }
  }
  res.json({ ok: true, emailDelivery: config.emailConfigured ? 'SENT' : 'NOT_CONFIGURED',
    message: config.emailConfigured ? 'If the account exists, we have emailed a reset link.' : 'If the account exists, your administrator has been notified.' });
});

r.post('/password/reset', tokenLimiter, async (req, res) => {
  const { token, password } = parse(z.object({ token: z.string().min(20).max(200), password: passwordSchema }), req.body);
  const t = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!t || t.usedAt || t.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired');
  await prisma.$transaction(async (tx) => {
    const used = await tx.passwordResetToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!used.count) throw badRequest('This reset link has already been used');
    await tx.user.update({ where: { id: t.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false } });
    await tx.session.deleteMany({ where: { userId: t.userId } }); // revoke all sessions
    await tx.passwordResetToken.updateMany({ where: { userId: t.userId, usedAt: null }, data: { usedAt: new Date() } });
  });
  res.json({ ok: true });
});

// Signed-in user changes their own password (also clears the "must change" flag on admin-created accounts).
// Other sessions are signed out; this one stays.
r.post('/password/change', tokenLimiter, async (req, res) => {
  if (!req.auth) throw unauthorized();
  const b = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }), req.body);
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!(await verifyPassword(user.passwordHash, b.currentPassword))) throw badRequest('Your current password is not correct');
  if (b.currentPassword === b.newPassword) throw badRequest('Choose a password different from the current one');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(b.newPassword), mustChangePassword: false } });
  await prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.auth.sessionId } } });
  await audit(prisma, req.auth, { action: 'auth.password_changed', entityType: 'User', entityId: user.id }, req.ip);
  res.json({ ok: true });
});

// Self-service profile: name and phone. Designation and department are set by an administrator.
r.patch('/profile', async (req, res) => {
  if (!req.auth) throw unauthorized();
  const b = parse(z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().trim().max(40).nullable().optional() }), req.body);
  await prisma.user.update({ where: { id: req.auth.userId }, data: b });
  res.json(await mePayload({ userId: req.auth.userId, orgId: req.auth.orgId, csrfToken: req.auth.csrfToken }));
});

export default r;
