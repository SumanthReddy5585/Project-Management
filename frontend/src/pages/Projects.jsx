import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FolderKanban, Search, LayoutGrid, Table2, GanttChart, Check, ChevronRight, ChevronLeft, Users, CalendarDays, Layers, UserCheck } from 'lucide-react';
import { get, post } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useLive } from '../lib/live.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { addDaysISO, todayISO, fmtDate, projectColor, labelize } from '../lib/format.js';
import { ScheduleChip, DaysVar } from '../lib/schedule.jsx';
import { Avatar, Card, Empty, ErrorBox, Field, HealthBadge, Notice, Loading, Modal, Pagination, Segmented, Select, StatusBadge, useToast, fieldErrors, ProjectDot } from '../components/ui.jsx';
import { ProjectCard } from './Home.jsx';

/** Short project code from the name: initials of up to 4 words, or the first 3 letters. */
export const codeFrom = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let c = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 3);
  if (!/^[A-Z]/.test(c)) c = `P${c}`;
  return c.padEnd(2, 'X').slice(0, 6);
};

const STEPS = [['details', 'Project details', Layers], ['team', 'Team', Users], ['review', 'Review & create', Check]];
// After creating, the wizard continues on the project's Plan tab: build tasks, then approve & lock the original plan.

function Steps({ step }) {
  const i = STEPS.findIndex((s) => s[0] === step);
  return (
    <ol className="d-flex gap-2 list-unstyled mb-3 p-0" aria-label="Steps">
      {STEPS.map(([k, label, Icon], n) => (
        <li key={k} className="d-flex align-items-center gap-2 flex-grow-1" aria-current={k === step ? 'step' : undefined}>
          <span className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0" style={{ width: 26, height: 26, fontSize: 12, fontWeight: 700, background: n < i ? 'var(--green)' : n === i ? 'var(--brand)' : 'var(--surface-sunk)', color: n <= i ? '#fff' : 'var(--muted)' }}>{n < i ? <Check size={14} /> : n + 1}</span>
          <span className={`small ${n === i ? 'fw-semibold' : 'text-muted'}`}><Icon size={13} className="me-1" />{label}</span>
          {n < STEPS.length - 1 && <span className="flex-grow-1" style={{ height: 1, background: 'var(--line)' }} />}
        </li>))}
    </ol>
  );
}

export function TeamPicker({ people, team, setTeam, managerId, workload }) {
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))].sort();
  const shown = people.filter((p) => (!dept || p.department === dept) && (!q || `${p.name} ${p.title || ''} ${p.skills?.join(' ') || ''}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = (id) => setTeam((t) => (t[id] ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== id)) : { ...t, [id]: { role: 'MEMBER', allocationPct: 100 } }));
  const wl = new Map((workload || []).map((w) => [w.userId, w]));
  return (
    <>
      <div className="d-flex gap-2 mb-2 flex-wrap align-items-center">
        <div className="search-in position-relative flex-grow-1" style={{ maxWidth: 300 }}><Search size={15} className="position-absolute text-muted" style={{ left: 10, top: 9 }} /><input className="form-control form-control-sm ps-4" placeholder="Search name, designation or skill" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" /></div>
        <div className="d-flex gap-1 flex-wrap">{['', ...depts].map((d) => <button key={d || 'all'} type="button" className={`btn btn-sm ${dept === d ? 'btn-outline-primary' : 'btn-light'}`} onClick={() => setDept(d)}>{d || 'All departments'}</button>)}</div>
        <span className="ms-auto small fw-semibold">{Object.keys(team).length} selected</span>
      </div>
      <div className="border rounded" style={{ maxHeight: 330, overflowY: 'auto' }}>
        <table className="table table-hover mb-0">
          <thead><tr><th style={{ width: 36 }} /><th>Person</th><th>Department</th><th>Current load</th><th style={{ width: 130 }}>Project role</th><th style={{ width: 90 }}>Allocation</th></tr></thead>
          <tbody>{shown.map((p) => {
            const sel = team[p.userId]; const isMgr = p.userId === managerId; const w = wl.get(p.userId);
            return (
              <tr key={p.userId} className={sel || isMgr ? 'table-active' : ''} style={{ cursor: isMgr ? 'default' : 'pointer' }} onClick={() => !isMgr && toggle(p.userId)}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" className="form-check-input" checked={Boolean(sel) || isMgr} disabled={isMgr} onChange={() => toggle(p.userId)} aria-label={`Add ${p.name}`} /></td>
                <td><span className="d-flex align-items-center gap-2"><Avatar sm name={p.name} /><span><span className="fw-semibold d-block small">{p.name}</span><span className="small text-muted">{p.title || labelize(p.role)}</span></span></span></td>
                <td className="small">{p.department || <span className="text-muted">—</span>}</td>
                <td className="small text-nowrap">{w ? <span className={w.pct > 100 ? 'text-danger fw-semibold' : w.pct > 80 ? 'text-warning fw-semibold' : 'text-success'}>{Math.round(w.pct)}% booked</span> : <span className="text-muted">{p.activeProjects ?? 0} project{p.activeProjects === 1 ? '' : 's'}</span>}</td>
                <td onClick={(e) => e.stopPropagation()}>{isMgr ? <span className="pill pill-dark">Project manager</span> : sel ? <select className="form-select form-select-sm" value={sel.role} onChange={(e) => setTeam((t) => ({ ...t, [p.userId]: { ...sel, role: e.target.value } }))} aria-label={`Role for ${p.name}`}>
                  <option value="MEMBER">Member</option>{['ADMIN', 'MANAGER'].includes(p.role) && <option value="MANAGER">Co-manager</option>}<option value="VIEWER">Viewer</option></select> : null}</td>
                <td onClick={(e) => e.stopPropagation()}>{sel && <select className="form-select form-select-sm" value={sel.allocationPct} onChange={(e) => setTeam((t) => ({ ...t, [p.userId]: { ...sel, allocationPct: Number(e.target.value) } }))} aria-label={`Allocation for ${p.name}`}>{[100, 75, 50, 25].map((n) => <option key={n} value={n}>{n}%</option>)}</select>}</td>
              </tr>);
          })}{shown.length === 0 && <tr><td colSpan={6} className="text-center small text-muted p-3">No one matches.</td></tr>}</tbody>
        </table>
      </div>
      <div className="form-text">Members work on tasks and log time; viewers can only see the project. You can change the team any time from the project's Team page.</div>
    </>
  );
}

export function NewProjectDialog({ onClose }) {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const refs = useLoad(() => Promise.all([get('/org/customers'), get('/org/members', { pageSize: 200 }), get('/org/templates'), get('/workload').catch(() => ({ data: [] }))]), []);
  const [customers, members, templates, workload] = refs.data ? refs.data.map((r) => r.data) : [[], [], [], []];
  const [step, setStep] = useState('details');
  const [f, setF] = useState({ name: '', code: '', customerCompanyId: '', plannedStart: todayISO(), plannedFinish: addDaysISO(todayISO(), 90), share: true, templateId: '', managerId: user.id, priority: 'MEDIUM', description: '', objectives: '', budgetAmount: '', budgetCurrency: 'USD', customerContactIds: null });
  const [team, setTeam] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const internal = members.filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE');
  const managers = internal.filter((m) => ['ADMIN', 'MANAGER'].includes(m.role));
  const contacts = members.filter((m) => m.role === 'CUSTOMER' && m.status === 'ACTIVE' && m.customerCompany?.id === f.customerCompanyId);
  const chosenContacts = f.customerContactIds ?? contacts.map((c) => c.userId);
  const tpl = templates.find((t) => t.id === f.templateId) || templates.find((t) => t.isDefault);
  const detailsOk = f.name.trim().length >= 2 && f.plannedFinish >= f.plannedStart && f.managerId;
  const submit = async () => {
    setErr(null); setBusy(true);
    const base = f.code || codeFrom(f.name);
    const body = { name: f.name.trim(), managerId: f.managerId, plannedStart: f.plannedStart, plannedFinish: f.plannedFinish, status: 'DRAFT', priority: f.priority,
      description: f.description || null, objectives: f.objectives || null,
      customerCompanyId: f.customerCompanyId || null, customerVisible: Boolean(f.customerCompanyId && f.share), customerContactIds: f.customerCompanyId ? chosenContacts : [],
      team: Object.entries(team).filter(([id]) => id !== f.managerId).map(([userId, t]) => ({ userId, ...t })), templateId: f.templateId || null,
      ...(f.budgetAmount && { budgetAmount: Number(f.budgetAmount), budgetCurrency: f.budgetCurrency }),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    try {
      for (let i = 0; i < 6; i++) {
        try { const p = await post('/projects', { ...body, code: i ? `${base.slice(0, 8)}${i + 1}` : base }); toast(`${p.name} created with ${body.team.length + 1} people — now build the plan`, 'success'); nav(`/projects/${p.id}/plan`); return; }
        catch (x) { if (!(x.status === 409 && !f.code)) throw x; }
      }
    } catch (x) { setErr(x); if (fieldErrors(x).name || fieldErrors(x).code) setStep('details'); } finally { setBusy(false); }
  };
  const fe = fieldErrors(err);
  const footer = (
    <>
      {step !== 'details' && <button className="btn btn-light me-auto" onClick={() => setStep(step === 'review' ? 'team' : 'details')}><ChevronLeft size={15} /> Back</button>}
      <button className="btn btn-light" onClick={onClose}>Cancel</button>
      {step === 'details' && <button className="btn btn-primary" disabled={!detailsOk} onClick={() => setStep('team')}>Next: choose team <ChevronRight size={15} /></button>}
      {step === 'team' && <button className="btn btn-primary" onClick={() => setStep('review')}>Next: review <ChevronRight size={15} /></button>}
      {step === 'review' && <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create project & build plan'}</button>}
    </>
  );
  const mgrName = internal.find((m) => m.userId === f.managerId)?.name;
  return (
    <Modal open size="lg" onClose={onClose} title="New project" footer={footer}>
      <Steps step={step} />
      <ErrorBox error={err} />
      {refs.loading && !refs.data ? <Loading /> : step === 'details' ? (
        <>
          <div className="row">
            <div className="col-md-8"><Field label="Project name" error={fe.name}>{(id) => <input id={id} className="form-control" placeholder="e.g. Customer portal rollout" value={f.name} onChange={set('name')} autoFocus />}</Field></div>
            <div className="col-md-4"><Field label="Short code" hint="Used in task numbers" error={fe.code}>{(id) => <input id={id} className="form-control text-uppercase" maxLength={10} placeholder={f.name ? codeFrom(f.name) : 'CPR'} value={f.code} onChange={(e) => set('code')(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />}</Field></div>
            <div className="col-md-6"><Field label="Project manager">{(id) => <Select id={id} value={f.managerId} onChange={set('managerId')} disabled={role !== 'ADMIN' && managers.length <= 1} options={managers.map((m) => ({ value: m.userId, label: `${m.name}${m.userId === user.id ? ' (you)' : ''}${m.title ? ` — ${m.title}` : ''}` }))} />}</Field></div>
            <div className="col-md-6"><Field label="Client" hint="Leave empty for an internal project">{(id) => <Select id={id} value={f.customerCompanyId} onChange={(v) => setF((x) => ({ ...x, customerCompanyId: v || '', customerContactIds: null }))} placeholder="Internal project" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>
            <div className="col-6 col-md-3"><Field label="Start date">{(id) => <input id={id} type="date" className="form-control" value={f.plannedStart} onChange={set('plannedStart')} />}</Field></div>
            <div className="col-6 col-md-3"><Field label="Target finish" error={f.plannedFinish < f.plannedStart ? 'Must be after the start' : fe.plannedFinish}>{(id) => <input id={id} type="date" className="form-control" value={f.plannedFinish} min={f.plannedStart} onChange={set('plannedFinish')} />}</Field></div>
            <div className="col-6 col-md-3"><Field label="Priority">{(id) => <Select id={id} value={f.priority} onChange={set('priority')} options={[['LOW', 'Low'], ['MEDIUM', 'Normal'], ['HIGH', 'High'], ['CRITICAL', 'Critical']].map(([v, l]) => ({ value: v, label: l }))} />}</Field></div>
            <div className="col-6 col-md-3"><Field label="Budget (optional)">{(id) => <div className="input-group"><input id={id} type="number" min="0" className="form-control" value={f.budgetAmount} onChange={set('budgetAmount')} /><select className="form-select" style={{ maxWidth: 82 }} value={f.budgetCurrency} onChange={set('budgetCurrency')} aria-label="Currency">{['USD', 'EUR', 'GBP', 'INR', 'AED', 'OMR', 'SAR'].map((c) => <option key={c}>{c}</option>)}</select></div>}</Field></div>
          </div>
          <Field label="Plan template" hint={tpl ? `Creates ${tpl.phases.length} phases: ${tpl.phases.map((p) => p.name).join(' → ')}` : undefined}>{(id) => <Select id={id} value={f.templateId} onChange={set('templateId')} placeholder={`${templates.find((t) => t.isDefault)?.name || 'Standard plan'} (default)`} options={templates.filter((t) => !t.isDefault).map((t) => ({ value: t.id, label: t.name }))} />}</Field>
          <Field label="Goal / objectives" hint="What does success look like? Shown on the project overview.">{(id) => <textarea id={id} rows={2} className="form-control" value={f.objectives} onChange={set('objectives')} placeholder="e.g. Launch the new portal by Q2 and cut support calls by 20%" />}</Field>
        </>
      ) : step === 'team' ? (
        <>
          <p className="small text-muted mb-2">Pick the people who will work on <strong>{f.name}</strong>. <strong>{mgrName}</strong> is the project manager.</p>
          <TeamPicker people={internal} team={team} setTeam={setTeam} managerId={f.managerId} workload={workload} />
          {f.customerCompanyId && contacts.length > 0 && <div className="mt-3"><div className="form-label">Client contacts who can follow the project</div>
            <div className="d-flex flex-wrap gap-2">{contacts.map((c) => { const on = chosenContacts.includes(c.userId); return (
              <label key={c.userId} className={`btn btn-sm ${on ? 'btn-outline-primary' : 'btn-light'}`}><input type="checkbox" className="visually-hidden" checked={on} onChange={() => set('customerContactIds')(on ? chosenContacts.filter((x) => x !== c.userId) : [...chosenContacts, c.userId])} /><Avatar sm name={c.name} /> {c.name}</label>); })}</div></div>}
        </>
      ) : (
        <>
          <Notice>Next: you'll add the tasks and milestones with dates, people and effort, then <b>approve and lock it as the original plan</b>. From then on the project is tracked against that original.</Notice>
          <dl className="props">
            <dt>Project</dt><dd className="fw-semibold">{f.name} <span className="mono">{f.code || codeFrom(f.name)}</span></dd>
            <dt>Client</dt><dd>{customers.find((c) => c.id === f.customerCompanyId)?.name || 'Internal project'}</dd>
            <dt>Dates</dt><dd>{fmtDate(f.plannedStart)} → {fmtDate(f.plannedFinish)}</dd>
            <dt>Plan</dt><dd>{tpl ? `${tpl.name}: ${tpl.phases.length} phases with milestones` : 'Standard plan'}</dd>
            <dt>Manager</dt><dd>{mgrName}</dd>
            <dt>Team</dt><dd>{Object.keys(team).length ? <span className="d-flex flex-wrap gap-2">{Object.entries(team).map(([id, t]) => { const p = internal.find((m) => m.userId === id); return <span key={id} className="pill pill-neutral"><Avatar sm name={p?.name} />{p?.name} · {t.role === 'MANAGER' ? 'Co-manager' : labelize(t.role)}{t.allocationPct < 100 ? ` · ${t.allocationPct}%` : ''}</span>; })}</span> : <span className="text-muted">Only the manager for now</span>}</dd>
            {f.budgetAmount && <><dt>Budget</dt><dd>{Number(f.budgetAmount).toLocaleString()} {f.budgetCurrency}</dd></>}
          </dl>
          {f.customerCompanyId && <div className="form-check form-switch"><input className="form-check-input" type="checkbox" role="switch" id="np-share" checked={f.share} onChange={(e) => set('share')(e.target.checked)} />
            <label className="form-check-label" htmlFor="np-share">Let the client follow this project ({chosenContacts.length} contact{chosenContacts.length === 1 ? '' : 's'}) <span className="text-muted">— they only see what you share</span></label></div>}
        </>
      )}
    </Modal>
  );
}

function PortfolioTimeline({ rows }) {
  const dated = rows.filter((p) => p.plannedStart && p.plannedFinish);
  if (!dated.length) return <Empty title="No dated projects" />;
  const min = new Date(Math.min(...dated.map((p) => Date.parse(p.plannedStart))));
  const max = new Date(Math.max(...dated.map((p) => Date.parse(p.plannedFinish))));
  min.setDate(1); max.setMonth(max.getMonth() + 1, 0);
  const span = max - min;
  const months = []; for (let d = new Date(min); d <= max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(new Date(d));
  const pct = (d) => ((Date.parse(d) - min) / span) * 100;
  const today = pct(todayISO());
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 900 }}>
        <div className="d-flex border-bottom" style={{ background: 'var(--surface-soft)' }}><div style={{ width: 260 }} className="small-caps p-2">Project</div>
          <div className="flex-grow-1 position-relative" style={{ height: 34 }}>{months.map((m) => <span key={m.toISOString()} className="position-absolute small text-muted" style={{ left: `${pct(m.toISOString().slice(0, 10))}%`, top: 8, paddingLeft: 4, borderLeft: '1px solid var(--line)', height: 26 }}>{m.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</span>)}</div></div>
        {dated.map((p) => (
          <div key={p.id} className="d-flex border-bottom align-items-center" style={{ height: 44 }}>
            <div style={{ width: 260 }} className="px-2 truncate"><Link to={`/projects/${p.id}`} className="small fw-semibold text-body d-inline-flex align-items-center gap-2"><ProjectDot code={p.code} />{p.name}</Link></div>
            <div className="flex-grow-1 position-relative" style={{ height: 44 }}>
              {today >= 0 && today <= 100 && <span className="position-absolute" style={{ left: `${today}%`, top: 0, bottom: 0, width: 2, background: 'var(--red)', opacity: 0.4 }} />}
              <Link to={`/projects/${p.id}`} className="position-absolute rounded" title={`${fmtDate(p.plannedStart)} → ${fmtDate(p.plannedFinish)} · ${Math.round(p.progress || 0)}%`}
                style={{ left: `${pct(p.plannedStart)}%`, width: `${Math.max(1, pct(p.plannedFinish) - pct(p.plannedStart))}%`, top: 12, height: 20, background: `${projectColor(p.code)}33`, border: `1px solid ${projectColor(p.code)}`, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${p.progress || 0}%`, background: projectColor(p.code) }} />
              </Link>
            </div>
          </div>))}
      </div>
    </div>
  );
}

export default function Projects() {
  const { can, isCustomer } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [view, setView] = useState('active');
  const [health, setHealth] = useState('');
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('o2.projectsLayout') || 'table'; } catch { return 'table'; } });
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const status = { active: 'ACTIVE,ON_HOLD,DRAFT', done: 'COMPLETED', all: 'DRAFT,ACTIVE,ON_HOLD,COMPLETED,CANCELLED,ARCHIVED' }[view];
  const { data, error, loading, reload } = useLoad(() => get('/projects', { q: dq || undefined, status, health: health || undefined, page, pageSize: 50, sort: 'plannedFinish', dir: 'asc' }), [dq, status, health, page]);
  useLive((e) => e.type === 'work.changed', () => reload({ silent: true }));
  const creating = params.get('new') === '1' && can('project.create');
  const chooseLayout = (v) => { setLayout(v); try { localStorage.setItem('o2.projectsLayout', v); } catch { /* ignore */ } };
  const rows = data?.data || [];
  const sum = useMemo(() => ({ total: rows.length, red: rows.filter((p) => p.health === 'RED').length, amber: rows.filter((p) => p.health === 'AMBER').length, overdue: rows.reduce((s, p) => s + (p.counts?.overdue || 0), 0) }), [rows]);
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">{isCustomer ? 'My projects' : 'Projects'}</h1><div className="sub">{isCustomer ? 'Projects your team has shared with you.' : `${sum.total} project${sum.total === 1 ? '' : 's'}${sum.red ? ` · ${sum.red} off track` : ''}${sum.amber ? ` · ${sum.amber} at risk` : ''}${sum.overdue ? ` · ${sum.overdue} overdue tasks` : ''}`}</div></div>
        {can('project.create') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={16} /> New project</button>}</div>
      <div className="filters">
        <div className="position-relative" style={{ maxWidth: 260 }}><Search size={15} className="position-absolute text-muted" style={{ left: 10, top: 11 }} /><input className="form-control ps-4" placeholder="Search projects" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search projects" /></div>
        {!isCustomer && <Segmented label="Status" value={view} onChange={(v) => { setView(v); setPage(1); }} options={[['active', 'Active'], ['done', 'Completed'], ['all', 'All']]} />}
        {!isCustomer && <select className="form-select" style={{ width: 'auto' }} value={health} onChange={(e) => setHealth(e.target.value)} aria-label="Filter by health"><option value="">Any health</option><option value="GREEN">On track</option><option value="AMBER">At risk</option><option value="RED">Off track</option></select>}
        <div className="ms-auto"><Segmented label="Layout" value={layout} onChange={chooseLayout} options={[['table', 'Table', Table2], ['cards', 'Cards', LayoutGrid], ['timeline', 'Timeline', GanttChart]]} /></div>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <Card><Empty icon={FolderKanban} title={q ? 'No matching projects' : 'Start your first project'} action={can('project.create') && !q && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={16} /> New project</button>}>{q ? 'Try another name.' : isCustomer ? 'Your team will share projects with you here.' : 'Set the dates, pick a plan template and choose your team.'}</Empty></Card>
      ) : layout === 'cards' ? <div className="project-grid">{rows.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        : layout === 'timeline' ? <PortfolioTimeline rows={rows} />
        : (
          <div className="card" style={{ overflow: 'hidden' }}><div className="table-wrap"><table className="table table-hover mb-0">
            <thead><tr><th>Project</th>{!isCustomer && <th>Manager</th>}<th>Status</th><th>Health</th>{!isCustomer && <th title="Working plan compared with the original (approved) plan">Vs original plan</th>}<th style={{ width: 170 }}>Progress</th><th>Tasks</th><th>Milestones</th><th>Finish</th>{!isCustomer && <th>Team</th>}</tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id} className="row-link" onClick={() => nav(`/projects/${p.id}`)}>
                <td><Link to={`/projects/${p.id}`} className="fw-semibold text-body d-inline-flex align-items-center gap-2" onClick={(e) => e.stopPropagation()}><ProjectDot code={p.code} />{p.name}</Link><div className="tk-meta"><span className="mono">{p.code}</span> · {p.customerName || 'Internal'}</div></td>
                {!isCustomer && <td className="small text-nowrap">{p.managerName ? <span className="d-inline-flex align-items-center gap-2"><Avatar sm name={p.managerName} />{p.managerName}</span> : '—'}</td>}
                <td><StatusBadge status={p.status} /></td>
                <td><HealthBadge health={p.health} /></td>
                {!isCustomer && <td className="small text-nowrap">{p.schedule ? <span className="d-inline-flex align-items-center gap-1"><ScheduleChip status={p.schedule.status} /><DaysVar days={p.schedule.finishVariance} /></span> : ['CANCELLED', 'ARCHIVED'].includes(p.status) ? <span className="text-muted">—</span> : <span className="text-muted" title="The plan has not been approved yet">Plan in draft</span>}</td>}
                <td><div className="d-flex align-items-center gap-2"><div className="meter flex-grow-1" style={{ '--pc': projectColor(p.code) }}><span style={{ width: `${p.progress || 0}%` }} /></div><span className="small num">{Math.round(p.progress || 0)}%</span></div></td>
                <td className="small text-nowrap num">{p.counts?.open ?? '—'} open{p.counts?.overdue ? <span className="text-danger fw-semibold"> · {p.counts.overdue} late</span> : ''}</td>
                <td className="small num">{p.milestones ? `${p.milestones.done}/${p.milestones.total}` : '—'}</td>
                <td className="small text-nowrap"><CalendarDays size={12} className="text-muted" /> {fmtDate(p.plannedFinish)}</td>
                {!isCustomer && <td className="small num"><UserCheck size={13} className="text-muted" /> {p.teamSize ?? '—'}</td>}
              </tr>))}</tbody>
          </table></div></div>)}
      <div className="mt-3"><Pagination meta={data?.meta} onPage={setPage} /></div>
      {creating && <NewProjectDialog onClose={() => setParams({})} />}
    </>
  );
}
