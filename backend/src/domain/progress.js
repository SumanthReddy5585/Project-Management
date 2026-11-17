// Effort-weighted progress rollup (see docs/CALCULATIONS.md).
// Leaves = items with no non-cancelled children, excluding MILESTONE items.
// weight = estimateHours when > 0; otherwise the mean estimate of estimated leaves in the
// same scope; when no leaf in scope has an estimate, every leaf weighs 1 (count-based).
// CANCELLED items (and their subtrees) are excluded from numerator and denominator.
// DONE counts as 100% regardless of the stored percentage.

const leafPct = (i) => (i.status === 'DONE' ? 100 : Math.max(0, Math.min(100, i.percentComplete || 0)));
const est = (i) => (i.estimateHours != null && Number(i.estimateHours) > 0 ? Number(i.estimateHours) : null);

export function aggregate(leaves) {
  const live = leaves.filter((l) => l.status !== 'CANCELLED' && l.type !== 'MILESTONE');
  if (!live.length) return { percent: null, method: 'none', leafCount: 0 };
  const estimated = live.map(est).filter((x) => x != null);
  const method = estimated.length ? 'effort' : 'count';
  const fallback = estimated.length ? estimated.reduce((a, b) => a + b, 0) / estimated.length : 1;
  let total = 0; let done = 0;
  for (const l of live) {
    const w = method === 'effort' ? est(l) ?? fallback : 1;
    total += w;
    done += (w * leafPct(l)) / 100;
  }
  return { percent: Math.round((done / total) * 1000) / 10, method, leafCount: live.length, unestimated: live.length - estimated.length };
}

/** Returns { byId: Map(id -> {percent, method}), project, milestones } for a flat item list. */
export function rollup(items) {
  const alive = items.filter((i) => i.status !== 'CANCELLED');
  const kids = new Map();
  for (const i of alive) if (i.parentId) kids.set(i.parentId, [...(kids.get(i.parentId) || []), i]);
  const aliveIds = new Set(alive.map((i) => i.id));
  // drop items whose ancestor is cancelled
  const byIdAll = new Map(items.map((i) => [i.id, i]));
  const reachable = alive.filter((i) => {
    let p = i.parentId;
    while (p) { if (!aliveIds.has(p)) return false; p = byIdAll.get(p)?.parentId; }
    return true;
  });
  const leavesOf = (id) => {
    const c = kids.get(id) || [];
    if (!c.length) return [byIdAll.get(id)];
    return c.flatMap((x) => leavesOf(x.id));
  };
  const byId = new Map();
  for (const i of reachable) {
    const hasKids = (kids.get(i.id) || []).length > 0;
    byId.set(i.id, hasKids ? aggregate(leavesOf(i.id)) : { percent: i.type === 'MILESTONE' ? (i.status === 'DONE' ? 100 : 0) : leafPct(i), method: 'own' });
  }
  const roots = reachable.filter((i) => !i.parentId || !aliveIds.has(i.parentId));
  const allLeaves = roots.flatMap((r) => leavesOf(r.id));
  const ms = reachable.filter((i) => i.type === 'MILESTONE');
  return {
    byId,
    project: aggregate(allLeaves),
    milestones: { total: ms.length, done: ms.filter((m) => m.status === 'DONE').length },
    phase: (phaseId) => aggregate(reachable.filter((i) => i.phaseId === phaseId).filter((i) => !(kids.get(i.id) || []).length)),
  };
}
