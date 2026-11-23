import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Sparkles, CornerDownRight, AlertTriangle } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { setDone, bucketByDue } from '../lib/tasks.js';
import { fmtDate } from '../lib/format.js';
import { CheckButton, DueChip, Empty, ErrorBox, Loading, ProjectChip, StatusBadge, Segmented, useToast, Card } from '../components/ui.jsx';

/** Everything assigned to me, project by project (or by due date). */
export default function MyTasks() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => get('/dashboard'), []);
  const [q, setQ] = useState('');
  const [by, setBy] = useState('project');
  const [closed, setClosed] = useState(() => new Set(['Later']));
  const tasks = useMemo(() => (data?.myTasks || []).filter((t) => !q || `${t.title} ${t.key} ${t.projectName}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const projects = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      const g = m.get(t.projectId) || { id: t.projectId, code: t.projectCode, name: t.projectName, status: t.projectStatus, items: [] };
      g.items.push(t); m.set(t.projectId, g);
    }
    return [...m.values()].map((g) => ({ ...g, overdue: g.items.filter((t) => t.overdue).length, next: g.items.map((t) => t.plannedFinish).filter(Boolean).sort()[0] }))
      .sort((a, b) => b.overdue - a.overdue || (a.next || '9').localeCompare(b.next || '9'));
  }, [tasks]);
  const complete = async (t) => {
    setData((x) => ({ ...x, myTasks: x.myTasks.filter((m) => m.id !== t.id) }));
    try { await setDone(t.projectId, t.id, true); toast(`Done: ${t.title}`, 'success'); } catch (e) { toast(e.message, 'error'); reload(); }
  };
  const toggle = (k) => setClosed((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const row = (t, showProject) => (
    <div key={t.id} className="task-row">
      <CheckButton done={false} label={t.title} onToggle={() => complete(t)} disabled={t.hasSubtasks} />
      <span className="mono small text-muted" style={{ minWidth: 64 }}>{t.key}</span>
      <span className="min-w-0 flex-grow-1">
        <Link to={`/projects/${t.projectId}/list?item=${t.id}`} className="title d-block truncate">{t.title}</Link>
        {t.parentTitle && <span className="small text-muted d-inline-flex align-items-center gap-1"><CornerDownRight size={12} />in {t.parentTitle}</span>}
      </span>
      {showProject && <span className="d-none d-md-inline-flex align-items-center gap-1 small text-muted"><ProjectChip code={t.projectCode} size={18} />{t.projectCode}</span>}
      {t.plannedStart && <span className="small text-muted d-none d-lg-inline">{fmtDate(t.plannedStart)} →</span>}
      {t.status !== 'TODO' && <StatusBadge status={t.status} />}
      <DueChip date={t.plannedFinish} />
    </div>
  );
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Assigned to me</h1><div className="sub">Your open tasks, project by project. Tasks appear once their project's plan is approved.</div></div></div>
      <div className="filters">
        <Segmented label="Group by" value={by} onChange={setBy} options={[['project', 'By project'], ['due', 'By due date']]} />
        <input className="form-control form-control-sm" style={{ maxWidth: 260 }} placeholder="Filter tasks or projects" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" />
        {tasks.length > 0 && <span className="ms-auto small text-muted">{tasks.length} open task{tasks.length === 1 ? '' : 's'} in {projects.length} project{projects.length === 1 ? '' : 's'}</span>}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : tasks.length === 0 ? <Card><Empty icon={Sparkles} title={q ? 'No matching tasks' : "You're all caught up"}>{q ? 'Try another word.' : 'Tasks assigned to you will appear here.'}</Empty></Card>
        : by === 'project' ? (
          <div className="d-flex flex-column gap-3">{projects.map((g) => (
            <section key={g.id} className="card mt-project">
              <button className="mt-project-head" onClick={() => toggle(g.id)} aria-expanded={!closed.has(g.id)}>
                {closed.has(g.id) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <ProjectChip code={g.code} size={28} />
                <span className="text-start min-w-0"><span className="fw-semibold d-block truncate">{g.name}</span><span className="small text-muted mono">{g.code}{g.status === 'ON_HOLD' ? ' · on hold' : ''}</span></span>
                <span className="ms-auto d-flex align-items-center gap-2 small">
                  {g.overdue > 0 && <span className="pill pill-risk"><AlertTriangle size={11} /> {g.overdue} overdue</span>}
                  {g.next && <span className="text-muted d-none d-sm-inline">next due {fmtDate(g.next)}</span>}
                  <span className="n">{g.items.length}</span>
                </span>
              </button>
              {!closed.has(g.id) && <div className="px-2 pb-2">{g.items.map((t) => row(t, false))}
                <Link to={`/projects/${g.id}/list`} className="small fw-semibold d-inline-block mt-1 ms-2">Open {g.code} tasks</Link></div>}
            </section>))}</div>
        ) : bucketByDue(tasks).map(([name, items]) => (
          <section key={name}>
            <button className="group-head" onClick={() => toggle(name)} aria-expanded={!closed.has(name)}>
              {closed.has(name) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<span className={name === 'Overdue' ? 'text-danger' : ''}>{name}</span><span className="n">{items.length}</span></button>
            {!closed.has(name) && items.map((t) => row(t, true))}
          </section>))}
    </>
  );
}
