/** Append an audit event. Pass the transaction client when inside a transaction. */
export function audit(db, auth, { action, entityType, entityId, projectId, metadata = {}, visibility = 'INTERNAL' }, ip) {
  return db.auditEvent.create({
    data: { organizationId: auth.orgId, actorId: auth.userId ?? null, action, entityType, entityId: entityId ?? null, projectId: projectId ?? null, metadata, visibility, ip: ip ?? null },
  });
}
