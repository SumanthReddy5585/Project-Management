import { get, patch } from '../api/client.js';

/** Mark a task done / not done with one click (reads the current version first so edits never collide silently). */
export async function setDone(projectId, itemId, done) {
  const it = await get(`/projects/${projectId}/work-items/${itemId}`);
  return patch(`/projects/${projectId}/work-items/${itemId}`, { status: done ? 'DONE' : 'TODO', version: it.version });
}

/** Bucket open tasks by due date for friendly grouping. */
export function bucketByDue(items, dateOf = (i) => i.plannedFinish) {
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
  const groups = { Overdue: [], Today: [], 'Next 7 days': [], Later: [], 'No due date': [] };
  for (const i of items) {
    const d = dateOf(i);
    if (!d) groups['No due date'].push(i);
    else if (d < today) groups.Overdue.push(i);
    else if (d === today) groups.Today.push(i);
    else if (d <= week) groups['Next 7 days'].push(i);
    else groups.Later.push(i);
  }
  return Object.entries(groups).filter(([, v]) => v.length);
}
