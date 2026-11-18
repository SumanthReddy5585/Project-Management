// Permission matrix — the single source of truth used by every route.
// Org capabilities are checked against Membership.role.
// Project capabilities are checked against the *effective project role*:
//   org ADMIN -> 'ADMIN' on every project in the org;
//   otherwise the ProjectMember.role (MANAGER | MEMBER | VIEWER | CUSTOMER), or no access.
// An org role alone never grants access to a project (except ADMIN).

const ALL_INTERNAL = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

export const ORG_CAPS = {
  'org.manage': ['ADMIN'], // settings, users, invitations, teams, customers, calendars, templates, SLA, categories
  'org.audit': ['ADMIN'],
  'directory.view': ALL_INTERNAL,
  'project.create': ['ADMIN', 'MANAGER'],
  'ticket.create': ['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER'],
  'ticket.viewAll': ALL_INTERNAL, // every internal user works the shared support queue
  'ticket.work': ALL_INTERNAL, // assign, internal notes, status changes
  'workload.view': ['ADMIN', 'MANAGER'],
  'reports.portfolio': ['ADMIN', 'MANAGER'], // managers: only projects they can access
  'time.log': ALL_INTERNAL,
};

export const PROJECT_CAPS = {
  'project.view': ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER', 'CUSTOMER'],
  'project.viewInternal': ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'project.edit': ['ADMIN', 'MANAGER'],
  'project.financials': ['ADMIN', 'MANAGER'],
  'project.members': ['ADMIN', 'MANAGER'],
  'phase.manage': ['ADMIN', 'MANAGER'],
  'work.create': ['ADMIN', 'MANAGER', 'MEMBER'],
  'work.editAny': ['ADMIN', 'MANAGER'],
  'work.editOwn': ['MEMBER'], // only items where the user is assignee or collaborator
  'work.schedule': ['ADMIN', 'MANAGER'], // dependencies, baselines, schedule apply
  'work.delete': ['ADMIN', 'MANAGER'],
  'comment.internal': ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'comment.public': ['ADMIN', 'MANAGER', 'MEMBER', 'CUSTOMER'],
  'file.upload': ['ADMIN', 'MANAGER', 'MEMBER', 'CUSTOMER'], // customer uploads are forced PUBLIC
  'time.log': ['ADMIN', 'MANAGER', 'MEMBER'],
  'time.review': ['ADMIN', 'MANAGER'],
  'deliverable.manage': ['ADMIN', 'MANAGER'],
  'deliverable.review': ['ADMIN', 'MANAGER', 'CUSTOMER'],
  'update.publish': ['ADMIN', 'MANAGER'],
  'register.view': ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
  'register.manage': ['ADMIN', 'MANAGER'],
  'export.csv': ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER'],
};

export const orgCan = (auth, cap) => Boolean(ORG_CAPS[cap]?.includes(auth.orgRole));
export const projectCan = (role, cap) => Boolean(role && PROJECT_CAPS[cap]?.includes(role));

/** Exported for docs and the frontend (UI hides controls; the server still enforces). */
export const matrix = { org: ORG_CAPS, project: PROJECT_CAPS };
