import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';
import { sendMail } from '../services/mail.js';
import { parse, listQuery, pageArgs, paged, dateOnly, toDate, fmtDate, uuid, partialNoDefaults } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { requireOrg } from '../policies/access.js';
import { audit } from '../services/audit.js';
import { hashPassword } from '../auth/passwords.js';

const r = Router();
const admin = (req) => requireOrg(req.auth, 'org.manage');
const inOrg = async (model, id, orgId, what) => {
  const row = await prisma[model].findFirst({ where: { id, organizationId: orgId } });
  if (!row) throw notFound(what);
  return row;
};

r.get('/', async (req, res) => {
  const org = await prisma.organization.findUnique({ where: { id: req.auth.orgId } });
  res.json({ id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, settings: req.auth.isCustomer ? {} : org.settings });
});

r.patch('/', async (req, res) => {
  admin(req);
  const body = parse(z.object({ name: z.string().trim().min(2).max(120).optional(), timezone: z.string().max(60).optional() }), req.body);
  if (body.timezone && !Intl.supportedValuesOf('timeZone').includes(body.timezone)) throw badRequest('Unknown timezone');
  const org = await prisma.organization.update({ where: { id: req.auth.orgId }, data: body });
  await audit(prisma, req.auth, { action: 'org.updated', entityType: 'Organization', entityId: org.id, metadata: body }, req.ip);
  res.json(org);
});

// ----- Directory & members -----
r.get('/members', async (req, res) => {
  requireOrg(req.auth, 'directory.view');
  const q = parse(listQuery.extend({ role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER']).optional(), customerCompanyId: uuid.optional() }), req.query);
  const where = { organizationId: req.auth.orgId, ...(q.role && { role: q.role }), ...(q.customerCompanyId && { customerCompanyId: q.customerCompanyId }),
    ...(q.q && { user: { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }] } }) };
  const isAdmin = req.auth.orgRole === 'ADMIN';
  const [rows, total] = await Promise.all([
    prisma.membership.findMany({ where, include: { user: { include: { teamMembers: { include: { team: true } },
      _count: { select: { projectMembers: { where: { role: { not: 'CUSTOMER' }, project: { organizationId: req.auth.orgId, status: { in: ['ACTIVE', 'DRAFT', 'ON_HOLD'] } } } } } } } }, customerCompany: true }, orderBy: { user: { name: 'asc' } }, ...pageArgs(q) }),
    prisma.membership.count({ where }),
  ]);
  res.json(paged(rows.map((m) => ({
    userId: m.userId, name: m.user.name, email: m.user.email, title: m.user.title, department: m.user.department, phone: m.user.phone, employeeId: m.user.employeeId, role: m.role, status: m.status,
    skills: m.user.skills, weeklyCapacityHours: Number(m.user.weeklyCapacityHours), teams: m.user.teamMembers.map((t) => ({ id: t.team.id, name: t.team.name })),
    customerCompany: m.customerCompany ? { id: m.customerCompany.id, name: m.customerCompany.name } : null,
    activeProjects: m.role === 'CUSTOMER' ? undefined : m.user._count.projectMembers,
    ...(isAdmin && { lastLoginAt: m.user.lastLoginAt, mustChangePassword: m.user.mustChangePassword }),
  })), total, q));
});

r.patch('/members/:userId', async (req, res) => {
  admin(req);
  const body = parse(z.object({
    role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    title: z.string().max(120).nullable().optional(), skills: z.array(z.string().max(40)).max(30).optional(),
    name: z.string().trim().min(1).max(120).optional(), department: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(), employeeId: z.string().trim().max(40).nullable().optional(),
    weeklyCapacityHours: z.number().min(0).max(80).optional(), customerCompanyId: uuid.nullable().optional(),
  }), req.body);
  const m = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: req.auth.orgId, userId: req.params.userId } } });
  if (!m) throw notFound('Member');
  if (m.userId === req.auth.userId && (body.role && body.role !== 'ADMIN' || body.status === 'DISABLED')) throw badRequest('You cannot demote or disable yourself');
  const nextRole = body.role ?? m.role;
  const nextCompany = body.customerCompanyId !== undefined ? body.customerCompanyId : m.customerCompanyId;
  if (nextRole === 'CUSTOMER' && !nextCompany) throw badRequest('Customer users must belong to a customer company');
  if (nextCompany) await inOrg('customerCompany', nextCompany, req.auth.orgId, 'Customer company');
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { role: body.role, status: body.status, customerCompanyId: nextRole === 'CUSTOMER' ? nextCompany : null } });
    const { title, skills, weeklyCapacityHours, name, department, phone, employeeId } = body;
    const profile = Object.fromEntries(Object.entries({ title, skills, weeklyCapacityHours, name, department, phone, employeeId }).filter(([, v]) => v !== undefined));
    if (Object.keys(profile).length) await tx.user.update({ where: { id: m.userId }, data: profile });
    if (body.status === 'DISABLED' || (body.role && body.role !== m.role)) await tx.session.deleteMany({ where: { userId: m.userId, organizationId: req.auth.orgId } });
    // Role change to/from CUSTOMER invalidates incompatible project memberships.
    if (body.role && (body.role === 'CUSTOMER') !== (m.role === 'CUSTOMER')) {
      await tx.projectMember.deleteMany({ where: { userId: m.userId, project: { organizationId: req.auth.orgId } } });
    }
    await audit(tx, req.auth, { action: 'member.updated', entityType: 'User', entityId: m.userId, metadata: body }, req.ip);
  });
  res.json({ ok: true });
});

// Admin adds a person directly (no email round-trip): the account gets a one-time temporary password
// that is shown once to the admin and must be changed at first sign-in. Existing users of another
// organization are simply added as members (their password is unchanged).
const memberBody = z.object({
  name: z.string().trim().min(1).max(120), email: z.string().email().max(200).transform((s) => s.toLowerCase()),
  title: z.string().trim().max(120).optional().nullable(), department: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(), employeeId: z.string().trim().max(40).optional().nullable(),
  role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER']), customerCompanyId: uuid.optional().nullable(),
  weeklyCapacityHours: z.number().min(0).max(80).optional(), skills: z.array(z.string().max(40)).max(30).optional(),
});
const tempPassword = () => `O2-${randomToken(9).replace(/[-_]/g, 'x')}${Math.floor(Math.random() * 90 + 10)}`;
r.post('/members', async (req, res) => {
  admin(req);
  const b = parse(memberBody, req.body);
  if (b.role === 'CUSTOMER' && !b.customerCompanyId) throw badRequest('Choose the client company for this user');
  if (b.role !== 'CUSTOMER') b.customerCompanyId = null;
  if (b.customerCompanyId) await inOrg('customerCompany', b.customerCompanyId, req.auth.orgId, 'Customer company');
  const existing = await prisma.user.findUnique({ where: { email: b.email }, include: { memberships: { where: { organizationId: req.auth.orgId } } } });
  if (existing?.memberships.length) throw conflict('This person is already a member');
  const password = existing ? null : tempPassword();
  const profile = { title: b.title || null, department: b.department || null, phone: b.phone || null, employeeId: b.employeeId || null,
    ...(b.weeklyCapacityHours != null && { weeklyCapacityHours: b.weeklyCapacityHours }), ...(b.skills && { skills: b.skills }) };
  const user = await prisma.$transaction(async (tx) => {
    const u = existing ?? await tx.user.create({ data: { email: b.email, name: b.name, passwordHash: await hashPassword(password), mustChangePassword: true, ...profile } });
    await tx.membership.create({ data: { organizationId: req.auth.orgId, userId: u.id, role: b.role, customerCompanyId: b.customerCompanyId } });
    await audit(tx, req.auth, { action: 'member.created', entityType: 'User', entityId: u.id, metadata: { email: b.email, role: b.role, title: b.title } }, req.ip);
    return u;
  });
  const signIn = `${config.APP_ORIGIN}/login`;
  const mail = password ? await sendMail({ to: b.email, subject: `Your ${config.APP_NAME} account`, heading: `Welcome to ${config.APP_NAME}, ${b.name.split(' ')[0]}`,
    body: `${req.auth.user.name} created an account for you.\n\nEmail: ${b.email}\nTemporary password: ${password}\n\nYou'll be asked to choose your own password the first time you sign in.`, cta: 'Sign in', url: signIn }) : { sent: false };
  res.status(201).json({ userId: user.id, email: b.email, name: user.name, existingAccount: Boolean(existing), temporaryPassword: password, signInUrl: signIn, emailed: mail.sent });
});

// Admin issues a new one-time temporary password (shown once); the user must change it at next sign-in.
r.post('/members/:userId/temp-password', async (req, res) => {
  admin(req);
  const m = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: req.auth.orgId, userId: req.params.userId } }, include: { user: true } });
  if (!m) throw notFound('Member');
  if (m.userId === req.auth.userId) throw badRequest('Use "Change password" for your own account');
  const password = tempPassword();
  await prisma.$transaction([
    prisma.user.update({ where: { id: m.userId }, data: { passwordHash: await hashPassword(password), mustChangePassword: true } }),
    prisma.session.deleteMany({ where: { userId: m.userId } }),
  ]);
  await audit(prisma, req.auth, { action: 'member.temp_password_issued', entityType: 'User', entityId: m.userId }, req.ip);
  res.status(201).json({ email: m.user.email, temporaryPassword: password, signInUrl: `${config.APP_ORIGIN}/login` });
});

r.post('/members/:userId/reset-link', async (req, res) => {
  admin(req);
  const m = await prisma.membership.findUnique({ where: { organizationId_userId: { organizationId: req.auth.orgId, userId: req.params.userId } } });
  if (!m) throw notFound('Member');
  const token = randomToken();
  await prisma.passwordResetToken.create({ data: { userId: m.userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 3600 * 1000) } });
  await audit(prisma, req.auth, { action: 'member.reset_link_issued', entityType: 'User', entityId: m.userId }, req.ip);
  // Returned once to the admin; only its hash is stored.
  res.status(201).json({ url: `${config.APP_ORIGIN}/reset-password?token=${token}`, expiresInMinutes: 60 });
});

// ----- Invitations -----
r.get('/invitations', async (req, res) => {
  admin(req);
  const rows = await prisma.invitation.findMany({ where: { organizationId: req.auth.orgId, acceptedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ data: rows.map(({ tokenHash, ...i }) => ({ ...i, expired: i.expiresAt < new Date() })) });
});

r.post('/invitations', async (req, res) => {
  admin(req);
  const body = parse(z.object({ email: z.string().email().max(200).transform((s) => s.toLowerCase()), name: z.string().trim().max(120).optional(),
    role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER']), customerCompanyId: uuid.optional(),
    title: z.string().trim().max(120).optional(), department: z.string().trim().max(80).optional() }), req.body);
  if (body.role === 'CUSTOMER' && !body.customerCompanyId) throw badRequest('Choose the customer company for this user');
  if (body.role !== 'CUSTOMER') delete body.customerCompanyId;
  if (body.customerCompanyId) await inOrg('customerCompany', body.customerCompanyId, req.auth.orgId, 'Customer company');
  const existing = await prisma.membership.findFirst({ where: { organizationId: req.auth.orgId, user: { email: body.email } } });
  if (existing) throw conflict('This person is already a member');
  const token = randomToken();
  const inv = await prisma.$transaction(async (tx) => {
    await tx.invitation.updateMany({ where: { organizationId: req.auth.orgId, email: body.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const i = await tx.invitation.create({ data: { ...body, organizationId: req.auth.orgId, tokenHash: sha256(token), invitedById: req.auth.userId, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    await audit(tx, req.auth, { action: 'invitation.created', entityType: 'Invitation', entityId: i.id, metadata: { email: body.email, role: body.role } }, req.ip);
    return i;
  });
  const url = `${config.APP_ORIGIN}/accept-invite?token=${token}`;
  const mail = await sendMail({ to: inv.email, subject: `You're invited to ${config.APP_NAME}`, heading: `${req.auth.user.name} invited you to ${config.APP_NAME}`,
    body: `Hi${body.name ? ` ${body.name}` : ''},\n\nYou've been invited to join as ${body.role === 'CUSTOMER' ? 'a client' : body.role.toLowerCase()}. Click below to set your password and sign in. The invitation expires in 7 days.`,
    cta: 'Accept invitation', url });
  res.status(201).json({ id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, url, emailDelivery: mail.sent ? 'SENT' : config.emailConfigured ? 'FAILED' : 'NOT_CONFIGURED' });
});

r.delete('/invitations/:id', async (req, res) => {
  admin(req);
  const n = await prisma.invitation.updateMany({ where: { id: req.params.id, organizationId: req.auth.orgId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!n.count) throw notFound('Invitation');
  await audit(prisma, req.auth, { action: 'invitation.revoked', entityType: 'Invitation', entityId: req.params.id }, req.ip);
  res.status(204).end();
});

// ----- Teams -----
r.get('/teams', async (req, res) => {
  requireOrg(req.auth, 'directory.view');
  const teams = await prisma.team.findMany({ where: { organizationId: req.auth.orgId }, include: { members: { include: { user: true } } }, orderBy: { name: 'asc' } });
  res.json({ data: teams.map((t) => ({ id: t.id, name: t.name, description: t.description, members: t.members.map((m) => ({ id: m.user.id, name: m.user.name })) })) });
});
const teamBody = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(), memberIds: z.array(uuid).max(200).optional() });
async function setTeamMembers(tx, teamId, ids, orgId) {
  if (!ids) return;
  const valid = await tx.membership.findMany({ where: { organizationId: orgId, userId: { in: ids }, role: { not: 'CUSTOMER' } }, select: { userId: true } });
  if (valid.length !== new Set(ids).size) throw badRequest('Teams can only contain internal members of this organization');
  await tx.teamMember.deleteMany({ where: { teamId } });
  await tx.teamMember.createMany({ data: valid.map((v) => ({ teamId, userId: v.userId })) });
}
r.post('/teams', async (req, res) => {
  admin(req);
  const { memberIds, ...b } = parse(teamBody, req.body);
  const t = await prisma.$transaction(async (tx) => {
    const team = await tx.team.create({ data: { ...b, organizationId: req.auth.orgId } });
    await setTeamMembers(tx, team.id, memberIds, req.auth.orgId);
    await audit(tx, req.auth, { action: 'team.created', entityType: 'Team', entityId: team.id }, req.ip);
    return team;
  });
  res.status(201).json(t);
});
r.patch('/teams/:id', async (req, res) => {
  admin(req);
  await inOrg('team', req.params.id, req.auth.orgId, 'Team');
  const { memberIds, ...b } = parse(partialNoDefaults(teamBody), req.body);
  await prisma.$transaction(async (tx) => {
    await tx.team.update({ where: { id: req.params.id }, data: b });
    await setTeamMembers(tx, req.params.id, memberIds, req.auth.orgId);
  });
  res.json({ ok: true });
});

// ----- Customer companies -----
r.get('/customers', async (req, res) => {
  if (req.auth.isCustomer) {
    const c = await prisma.customerCompany.findFirst({ where: { id: req.auth.customerCompanyId, organizationId: req.auth.orgId } });
    return res.json({ data: c ? [{ id: c.id, name: c.name }] : [] });
  }
  const rows = await prisma.customerCompany.findMany({ where: { organizationId: req.auth.orgId }, orderBy: { name: 'asc' },
    include: { _count: { select: { projects: true, tickets: true, memberships: true } } } });
  res.json({ data: rows.map((c) => ({ id: c.id, name: c.name, domain: c.domain, notes: c.notes, projects: c._count.projects, tickets: c._count.tickets, contacts: c._count.memberships })) });
});
const customerBody = z.object({ name: z.string().trim().min(1).max(120), domain: z.string().max(120).optional().nullable(), notes: z.string().max(2000).optional().nullable() });
r.post('/customers', async (req, res) => {
  admin(req);
  const c = await prisma.customerCompany.create({ data: { ...parse(customerBody, req.body), organizationId: req.auth.orgId } });
  await audit(prisma, req.auth, { action: 'customer.created', entityType: 'CustomerCompany', entityId: c.id }, req.ip);
  res.status(201).json(c);
});
r.patch('/customers/:id', async (req, res) => {
  admin(req);
  await inOrg('customerCompany', req.params.id, req.auth.orgId, 'Customer company');
  res.json(await prisma.customerCompany.update({ where: { id: req.params.id }, data: parse(partialNoDefaults(customerBody), req.body) }));
});

// ----- Working calendars -----
const fmtCal = (c) => ({ ...c, holidays: (c.holidays || []).map((h) => ({ id: h.id, date: fmtDate(h.date), name: h.name })) });
r.get('/calendars', async (req, res) => {
  const rows = await prisma.workingCalendar.findMany({ where: { organizationId: req.auth.orgId }, include: { holidays: { orderBy: { date: 'asc' } } }, orderBy: { name: 'asc' } });
  res.json({ data: rows.map(fmtCal) });
});
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const calBody = z.object({ name: z.string().trim().min(1).max(80), timezone: z.string().max(60), workDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  dayStart: hhmm, dayEnd: hhmm, isDefault: z.boolean().optional(), holidays: z.array(z.object({ date: dateOnly, name: z.string().trim().min(1).max(80) })).max(400).optional() });
async function saveCalendar(req, id) {
  admin(req);
  const b = parse(id ? partialNoDefaults(calBody) : calBody, req.body);
  if (b.timezone && !Intl.supportedValuesOf('timeZone').includes(b.timezone) && b.timezone !== 'UTC') throw badRequest('Unknown timezone');
  if (b.dayStart && b.dayEnd && b.dayEnd <= b.dayStart) throw badRequest('Day end must be after day start');
  const { holidays, ...data } = b;
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) await tx.workingCalendar.updateMany({ where: { organizationId: req.auth.orgId }, data: { isDefault: false } });
    const cal = id ? await tx.workingCalendar.update({ where: { id }, data }) : await tx.workingCalendar.create({ data: { ...data, organizationId: req.auth.orgId } });
    if (holidays) {
      await tx.holiday.deleteMany({ where: { calendarId: cal.id } });
      await tx.holiday.createMany({ data: holidays.map((h) => ({ calendarId: cal.id, date: toDate(h.date), name: h.name })), skipDuplicates: true });
    }
    await audit(tx, req.auth, { action: id ? 'calendar.updated' : 'calendar.created', entityType: 'WorkingCalendar', entityId: cal.id }, req.ip);
    return fmtCal(await tx.workingCalendar.findUnique({ where: { id: cal.id }, include: { holidays: { orderBy: { date: 'asc' } } } }));
  });
}
r.post('/calendars', async (req, res) => res.status(201).json(await saveCalendar(req)));
r.patch('/calendars/:id', async (req, res) => { await inOrg('workingCalendar', req.params.id, req.auth.orgId, 'Calendar'); res.json(await saveCalendar(req, req.params.id)); });

// ----- Project templates -----
r.get('/templates', async (req, res) => {
  if (req.auth.isCustomer) return res.json({ data: [] });
  const rows = await prisma.projectTemplate.findMany({ where: { organizationId: req.auth.orgId }, include: { phases: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
  res.json({ data: rows });
});
const tplBody = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional().nullable(), isDefault: z.boolean().optional(),
  phases: z.array(z.object({ name: z.string().trim().min(1).max(120), durationDays: z.number().int().min(1).max(365), completionCriteria: z.string().max(1000).optional().nullable(),
    milestones: z.array(z.string().trim().min(1).max(120)).max(10).default([]), deliverables: z.array(z.string().trim().min(1).max(120)).max(10).default([]) })).min(1).max(30) });
async function saveTemplate(req, id) {
  admin(req);
  const { phases, ...data } = parse(id ? partialNoDefaults(tplBody) : tplBody, req.body);
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) await tx.projectTemplate.updateMany({ where: { organizationId: req.auth.orgId }, data: { isDefault: false } });
    const t = id ? await tx.projectTemplate.update({ where: { id }, data }) : await tx.projectTemplate.create({ data: { ...data, organizationId: req.auth.orgId } });
    if (phases) {
      await tx.templatePhase.deleteMany({ where: { templateId: t.id } });
      await tx.templatePhase.createMany({ data: phases.map((p, i) => ({ ...p, templateId: t.id, sortOrder: i })) });
    }
    await audit(tx, req.auth, { action: id ? 'template.updated' : 'template.created', entityType: 'ProjectTemplate', entityId: t.id }, req.ip);
    return tx.projectTemplate.findUnique({ where: { id: t.id }, include: { phases: { orderBy: { sortOrder: 'asc' } } } });
  });
}
r.post('/templates', async (req, res) => res.status(201).json(await saveTemplate(req)));
r.patch('/templates/:id', async (req, res) => { await inOrg('projectTemplate', req.params.id, req.auth.orgId, 'Template'); res.json(await saveTemplate(req, req.params.id)); });

// ----- Ticket configuration -----
r.get('/ticket-settings', async (req, res) => {
  const [categories, sla] = await Promise.all([
    prisma.ticketCategory.findMany({ where: { organizationId: req.auth.orgId }, orderBy: { name: 'asc' } }),
    prisma.slaPolicy.findMany({ where: { organizationId: req.auth.orgId } }),
  ]);
  res.json({ categories: categories.map((c) => c.name), sla: req.auth.isCustomer ? [] : sla });
});
r.put('/ticket-settings', async (req, res) => {
  admin(req);
  const b = parse(z.object({ categories: z.array(z.string().trim().min(1).max(60)).min(1).max(50),
    sla: z.array(z.object({ priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']), responseMinutes: z.number().int().min(5).max(100000), resolutionMinutes: z.number().int().min(5).max(500000), calendarId: uuid.nullable().optional() })) }), req.body);
  for (const s of b.sla) { if (s.resolutionMinutes < s.responseMinutes) throw badRequest('Resolution target must be at least the response target'); if (s.calendarId) await inOrg('workingCalendar', s.calendarId, req.auth.orgId, 'Calendar'); }
  await prisma.$transaction(async (tx) => {
    await tx.ticketCategory.deleteMany({ where: { organizationId: req.auth.orgId } });
    await tx.ticketCategory.createMany({ data: [...new Set(b.categories)].map((name) => ({ organizationId: req.auth.orgId, name })) });
    for (const s of b.sla) await tx.slaPolicy.upsert({ where: { organizationId_priority: { organizationId: req.auth.orgId, priority: s.priority } }, create: { ...s, organizationId: req.auth.orgId }, update: s });
    await audit(tx, req.auth, { action: 'ticket_settings.updated', entityType: 'Organization', entityId: req.auth.orgId }, req.ip);
  });
  res.json({ ok: true });
});

// ----- Audit log -----
r.get('/audit', async (req, res) => {
  requireOrg(req.auth, 'org.audit');
  const q = parse(listQuery.extend({ entityType: z.string().max(40).optional(), actorId: uuid.optional() }), req.query);
  const where = { organizationId: req.auth.orgId, ...(q.entityType && { entityType: q.entityType }), ...(q.actorId && { actorId: q.actorId }), ...(q.q && { action: { contains: q.q } }) };
  const [rows, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }), prisma.auditEvent.count({ where })]);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.actorId).filter(Boolean) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json(paged(rows.map((e) => ({ ...e, actorName: names.get(e.actorId) ?? null })), total, q));
});

export default r;
