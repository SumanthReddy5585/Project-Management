// Production initialization: creates one organization and its first administrator.
// Usage: INIT_ADMIN_PASSWORD='...' node prisma/init-org.js --org "Acme Ltd" --slug acme --email admin@acme.com --name "Ada Admin" [--timezone Asia/Kolkata]
import { parseArgs } from 'node:util';
import { prisma } from '../src/lib/prisma.js';
import { hashPassword, passwordSchema } from '../src/auth/passwords.js';
import { initializeOrganization } from '../src/services/orgSetup.js';

const { values: a } = parseArgs({ options: { org: { type: 'string' }, slug: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, timezone: { type: 'string', default: 'UTC' } } });
const password = process.env.INIT_ADMIN_PASSWORD;
if (!a.org || !a.slug || !a.email || !a.name || !password) { console.error('Required: --org --slug --email --name and INIT_ADMIN_PASSWORD env var'); process.exit(1); }
const pw = passwordSchema.safeParse(password);
if (!pw.success) { console.error('INIT_ADMIN_PASSWORD:', pw.error.issues[0].message); process.exit(1); }
if (await prisma.organization.findUnique({ where: { slug: a.slug } })) { console.error(`Organization "${a.slug}" already exists. Nothing changed.`); process.exit(1); }

await prisma.$transaction(async (tx) => {
  const org = await tx.organization.create({ data: { name: a.org, slug: a.slug, timezone: a.timezone } });
  await initializeOrganization(tx, org.id);
  await tx.workingCalendar.updateMany({ where: { organizationId: org.id }, data: { timezone: a.timezone } });
  const email = a.email.toLowerCase();
  const user = (await tx.user.findUnique({ where: { email } })) ?? await tx.user.create({ data: { email, name: a.name, passwordHash: await hashPassword(password) } });
  await tx.membership.create({ data: { organizationId: org.id, userId: user.id, role: 'ADMIN' } });
  await tx.auditEvent.create({ data: { organizationId: org.id, actorId: user.id, action: 'org.initialized', entityType: 'Organization', entityId: org.id } });
});
console.log(`Organization "${a.org}" created with administrator ${a.email}.`);
await prisma.$disconnect();
