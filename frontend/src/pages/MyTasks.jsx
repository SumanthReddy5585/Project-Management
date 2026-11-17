import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { get } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { setDone, bucketByDue } from '../lib/tasks.js';
import { CheckButton, DueChip, Empty, ErrorBox, Loading, ProjectDot, StatusBadge, useToast, Card } from '../components/ui.jsx';

export default function MyTasks() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => get('/dashboard'), []);
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(() => new Set(['Later']));
  const tasks = useMemo(() => (data?.myTasks || []).filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const complete = async (t) => {
    setData((x) => ({ ...x, myTasks: x.myTasks.filter((m) => m.id !== t.id) }));
    try { await setDone(t.projectId, t.id, true); toast(`Done: ${t.title}`, 'success'); } catch (e) { toast(e.message, 'error'); reload(); }
  };
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">My tasks</h1><div className="sub">Everything assigned to you, across all projects.</div></div>
        <input className="form-control" style={{ maxWidth: 260 }} placeholder="Filter tasks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter tasks" /></div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : tasks.length === 0 ? <Card><Empty icon={Sparkles} title={q ? 'No matching tasks' : "You're all caught up"}>{q ? 'Try another word.' : 'Tasks assigned to you will appear here.'}</Empty></Card> : (
        bucketByDue(tasks).map(([name, items]) => (
          <section key={name}>
            <button className="group-head" onClick={() => setClosed((c) => { const n = new Set(c); n.has(name) ? n.delete(name) : n.add(name); return n; })} aria-expanded={!closed.has(name)}>
              {closed.has(name) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}<span className={name === 'Overdue' ? 'text-danger' : ''}>{name}</span><span className="n">{items.length}</span></button>
            {!closed.has(name) && items.map((t) => (
              <div key={t.id} className="task-row">
                <CheckButton done={false} label={t.title} onToggle={() => complete(t)} />
                <Link to={`/projects/${t.projectId}/tasks?item=${t.id}`} className="title">{t.title}</Link>
                <span className="d-none d-md-inline-flex align-items-center gap-1 small text-muted"><ProjectDot code={t.key.split('-')[0]} />{t.key.split('-')[0]}</span>
                {t.status !== 'TODO' && <StatusBadge status={t.status} />}
                <DueChip date={t.plannedFinish} />
              </div>))}
          </section>)))}
    </>
  );
}
