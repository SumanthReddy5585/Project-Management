// In-app notifications are always persisted and pushed live. When SMTP is configured an email copy
// is queued after the transaction commits (emailStatus PENDING -> SENT/FAILED by the mail job).
import { publish } from './events.js';
import { config } from '../config.js';
export async function notify(db, { orgId, userIds, type, title, body, link, dedupeKey, exclude }) {
  const ids = [...new Set(userIds.filter(Boolean))].filter((id) => id !== exclude);
  if (!ids.length) return 0;
  const r = await db.notification.createMany({
    data: ids.map((userId) => ({ organizationId: orgId, userId, type, title, body: body?.slice(0, 500), link, emailStatus: config.emailConfigured ? 'PENDING' : 'NOT_CONFIGURED', dedupeKey: dedupeKey ? `${dedupeKey}` : null })),
    skipDuplicates: true,
  });
  // push after the surrounding transaction has had a chance to commit
  setTimeout(() => publish({ orgId, type: 'notification', userIds: ids, title }), 50);
  return r.count;
}

const MENTION = /@\[([^\]]{1,80})\]\(([0-9a-f-]{36})\)/gi;
/** Extract mentioned user ids from `@[Name](uuid)` markup produced by the mention picker. */
export const mentionedIds = (body) => [...body.matchAll(MENTION)].map((m) => m[2]);
