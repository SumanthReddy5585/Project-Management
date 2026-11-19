// Explicit allowlist serializers. Customer payloads never include financials, estimates,
// internal-only fields or collaborator lists. Keep these the only path from DB rows to JSON.
import { fmtDate } from '../lib/http.js';

const num = (d) => (d == null ? null : Number(d));

export function project(p, access, extra = {}) {
  const base = {
    id: p.id, code: p.code, name: p.name, description: p.description, objectives: p.objectives,
    status: p.status, health: p.health, priority: p.priority,
    plannedStart: fmtDate(p.plannedStart), plannedFinish: fmtDate(p.plannedFinish), timezone: p.timezone,
    customerCompanyId: p.customerCompanyId, managerId: p.managerId, directorId: p.directorId ?? null, customerVisible: p.customerVisible,
    role: access?.role, ...extra,
  };
  if (access?.isCustomer) { delete base.customerVisible; delete base.priority; return base; }
  Object.assign(base, { calendarId: p.calendarId, templateId: p.templateId, version: p.version, createdAt: p.createdAt, updatedAt: p.updatedAt });
  if (access?.can('project.financials')) {
    Object.assign(base, { budgetAmount: num(p.budgetAmount), budgetCurrency: p.budgetCurrency, billingEnabled: p.billingEnabled, hourlyRate: num(p.hourlyRate) });
  }
  return base;
}

export function workItem(i, access, extra = {}) {
  const key = extra.code ? `${extra.code}-${i.number}` : String(i.number);
  const base = {
    id: i.id, key, number: i.number, type: i.type, title: i.title, description: i.description, acceptanceCriteria: i.acceptanceCriteria,
    phaseId: i.phaseId, parentId: i.parentId, status: i.status, percentComplete: i.percentComplete,
    plannedStart: fmtDate(i.plannedStart), plannedFinish: fmtDate(i.plannedFinish), sortOrder: i.sortOrder,
  };
  if (access?.isCustomer) return { ...base, ...extra.customer };
  return {
    ...base, assigneeId: i.assigneeId, priority: i.priority, actualStart: fmtDate(i.actualStart), actualFinish: fmtDate(i.actualFinish),
    fixedStart: i.startConstraint === undefined ? undefined : fmtDate(i.startConstraint),
    estimateHours: num(i.estimateHours), customerVisible: i.customerVisible, labels: i.labels, version: i.version,
    createdAt: i.createdAt, updatedAt: i.updatedAt, ...extra.internal,
  };
}

export function phase(ph, access, progress) {
  const base = { id: ph.id, name: ph.name, sortOrder: ph.sortOrder, status: ph.status, plannedStart: fmtDate(ph.plannedStart),
    plannedFinish: fmtDate(ph.plannedFinish), completionCriteria: ph.completionCriteria, progress };
  if (access?.isCustomer) return base;
  return { ...base, ownerId: ph.ownerId, customerVisible: ph.customerVisible, version: ph.version };
}

export const user = (u) => (u ? { id: u.id, name: u.name, email: u.email, title: u.title ?? null } : null);
export const publicUser = (u) => (u ? { id: u.id, name: u.name } : null);

export function comment(c, authorsById) {
  return { id: c.id, body: c.deletedAt ? null : c.body, visibility: c.visibility, author: publicUser(authorsById.get(c.authorId)),
    createdAt: c.createdAt, editedAt: c.editedAt, deleted: Boolean(c.deletedAt) };
}

export function file(f, isCustomer) {
  const base = { id: f.id, name: f.originalName, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt, uploadedById: f.uploadedById };
  return isCustomer ? base : { ...base, visibility: f.visibility };
}

export function ticket(t, isCustomer, extra = {}) {
  const base = {
    id: t.id, number: t.number, subject: t.subject, description: t.description, customerCompanyId: t.customerCompanyId, projectId: t.projectId,
    category: t.category, type: t.type, priority: t.priority, severity: t.severity, status: t.status, requesterId: t.requesterId,
    createdAt: t.createdAt, updatedAt: t.updatedAt, firstResponseAt: t.firstResponseAt, resolvedAt: t.resolvedAt, closedAt: t.closedAt,
    responseDueAt: t.responseDueAt, resolutionDueAt: t.resolutionDueAt, version: t.version,
    csatRating: t.csatRating ?? null, csatComment: t.csatComment ?? null, csatAt: t.csatAt ?? null, ...extra,
  };
  if (isCustomer) return base;
  return { ...base, assigneeId: t.assigneeId, reopenCount: t.reopenCount, tags: t.tags ?? [] };
}
