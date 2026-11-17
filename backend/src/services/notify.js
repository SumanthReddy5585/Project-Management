// In-app notifications are always persisted. Outbound email is not implemented in this build,
// so emailStatus is recorded as NOT_CONFIGURED and the UI says so.
export async function notify(db, { orgId, userIds, type, title, body, link, dedupeKey, exclude }) {
  const ids = [...new Set(userIds.filter(Boolean))].filter((id) => id !== exclude);
  if (!ids.length) return 0;
  const r = await db.notification.createMany({
    data: ids.map((userId) => ({ organizationId: orgId, userId, type, title, body: body?.slice(0, 500), link, emailStatus: 'NOT_CONFIGURED', dedupeKey: dedupeKey ? `${dedupeKey}` : null })),
    skipDuplicates: true,
  });
  return r.count;
}

const MENTION = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/gi;
/** Extract mentioned user ids from `@[Name](uuid)` markup produced by the mention picker. */
export const mentionedIds = (body) => [...body.matchAll(MENTION)].map((m) => m[2]);
