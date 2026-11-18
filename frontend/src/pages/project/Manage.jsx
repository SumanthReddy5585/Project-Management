import { useState } from 'react';
import { Plus, Trash2, ShieldAlert } from 'lucide-react';
import { get, post, patch, put, del } from '../../api/client.js';
import { useLoad } from '../../lib/hooks.js';
import { fmtDate, labelize } from '../../lib/format.js';
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, Notice, Select, StatusBadge, useToast, fieldErrors, Avatar, Pagination } from '../../components/ui.jsx';
import { TeamPicker } from '../Projects.jsx';
import { useProject } from './Workspace.jsx';

const KINDS = {
  risks: { label: 'Risks', fields: [['title', 'Title'], ['description', 'Description', 'textarea'], ['probability', 'Probability (1–5)', 'score'], ['impact', 'Impact (1–5)', 'score'], ['ownerId', 'Owner', 'person'], ['mitigation', 'Mitigation', 'textarea'], ['status', 'Status', 'reg']],
    cols: (r, n) => [r.title, `${r.probability} × ${r.impact} = ${r.probability * r.impact}`, n(r.ownerId), <StatusBadge status={r.status} key="s" />], head: ['Risk', 'Exposure', 'Owner', 'Status'] },
  issues: { label: 'Issues', fields: [['title', 'Title'], ['description', 'Description', 'textarea'], ['severity', 'Severity (1–5)', 'score'], ['ownerId', 'Owner', 'person'], ['targetDate', 'Target resolution', 'date'], ['status', 'Status', 'reg']],
    cols: (r, n) => [r.title, r.severity, n(r.ownerId), fmtDate(r.targetDate), <StatusBadge status={r.status} key="s" />], head: ['Issue', 'Severity', 'Owner', 'Target', 'Status'] },
  decisions: { label: 'Decisions', fields: [['title', 'Title'], ['context', 'Context', 'textarea'], ['decision', 'Decision', 'textarea'], ['decidedById', 'Decision maker', 'person'], ['decidedOn', 'Date', 'date']],
    cols: (r, n) => [r.title, r.decision, n(r.decidedById), fmtDate(r.decidedOn)], head: ['Decision', 'Outcome', 'By', 'Date'] },
  'change-requests': { label: 'Change requests', fields: [['title', 'Title'], ['scope', 'Scope change', 'textarea'], ['scheduleImpactDays', 'Schedule impact (working days)', 'number'], ['costImpact', 'Cost impact', 'number'], ['reviewerId', 'Reviewer', 'person']],
    cols: (r, n) => [r.title, `${r.scheduleImpactDays > 0 ? '+' : ''}${r.scheduleImpactDays} d`, r.costImpact ?? '—', n(r.reviewerId), <StatusBadge status={r.status} key="s" />], head: ['Change', 'Schedule', 'Cost', 'Reviewer', 'Status'] },
};

const heat = (score) => (score >= 15 ? 'h4' : score >= 10 ? 'h3' : score >= 5 ? 'h2' : 'h1');
function RiskMatrix({ risks, cell, onCell }) {
  const open = risks.filter((r) => r.status !== 'CLOSED');
  const count = (p, i) => open.filter((r) => r.probability === p && r.impact === i).length;
  const high = open.filter((r) => r.probability * r.impact >= 15).length;
  const med = open.filter((r) => { const s = r.probability * r.impact; return s >= 8 && s < 15; }).length;
  return (
    <div className="row g-3 mb-2">
      <div className="col-lg-7"><Card title="Risk heat map">
        <div className="small text-muted mb-2">Open risks by probability and impact. Click a cell to filter the list.</div>
        <div className="riskmx" role="grid" aria-label="Risk matrix">
          <div className="ylab">Probability →</div>
          {[5, 4, 3, 2, 1].map((p) => <div key={p} className="mrow" role="row"><span className="ax">{p}</span>
            {[1, 2, 3, 4, 5].map((i) => { const n = count(p, i); const on = cell && cell[0] === p && cell[1] === i;
              return <button key={i} role="gridcell" className={`mcell ${heat(p * i)} ${on ? 'on' : ''}`} onClick={() => onCell(on ? null : [p, i])} aria-label={`Probability ${p}, impact ${i}: ${n} risk(s)`} title={`P${p} × I${i} = ${p * i}`}>{n || ''}</button>; })}</div>)}
          <div className="mrow"><span className="ax" />{[1, 2, 3, 4, 5].map((i) => <span key={i} className="ax x">{i}</span>)}</div>
          <div className="xlab">Impact →</div>
        </div></Card></div>
      <div className="col-lg-5"><Card title="Exposure summary">
        <div className="d-flex gap-2 mb-3"><div className="mini-kpi risk"><b>{high}</b><span>High (≥15)</span></div><div className="mini-kpi warn"><b>{med}</b><span>Medium (8–14)</span></div><div className="mini-kpi"><b>{open.length - high - med}</b><span>Low</span></div></div>
        <div className="small-caps mb-1">Top risks</div>
        <ul className="list-plain">{[...open].sort((a, b) => b.probability * b.impact - a.probability * a.impact).slice(0, 4).map((r) => <li key={r.id}><span className={`score-chip ${heat(r.probability * r.impact)}`}>{r.probability * r.impact}</span><span className="flex-grow-1 small fw-medium">{r.title}</span></li>)}</ul>
        {open.length === 0 && <div className="small text-muted">No open risks.</div>}
      </Card></div>
    </div>
  );
}

export function Registers() {
  const { project, can, people } = useProject();
  const toast = useToast();
  const [kind, setKind] = useState('risks');
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/registers/${kind}`), [project.id, kind]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const internal = people.filter((p) => p.role !== 'CUSTOMER');
  const nameOf = (id) => internal.find((p) => p.id === id)?.name || '—';
  const K = KINDS[kind];
  const manage = can('register.manage') && !project.readOnly;
  const save = async () => {
    setErr(null);
    const body = Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'id').map(([k, v]) => [k, v === '' ? null : ['probability', 'impact', 'severity', 'scheduleImpactDays'].includes(k) ? Number(v) : k === 'costImpact' && v != null ? Number(v) : v]));
    try { f.id ? await patch(`/projects/${project.id}/registers/${kind}/${f.id}`, body) : await post(`/projects/${project.id}/registers/${kind}`, body); setF(null); reload(); toast('Saved', 'success'); } catch (e) { setErr(e); }
  };
  const decide = async (r, status) => { try { const res = await patch(`/projects/${project.id}/registers/${kind}/${r.id}`, { status }); toast(res.nextStep || `Change request ${status.toLowerCase()}`, 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  const [cell, setCell] = useState(null);
  const rowsShown = kind === 'risks' && cell ? (data?.data || []).filter((r) => r.probability === cell[0] && r.impact === cell[1]) : data?.data;
  const blank = () => Object.fromEntries(K.fields.map(([k, , t]) => [k, t === 'score' ? 3 : t === 'number' ? 0 : t === 'date' ? '' : t === 'reg' ? 'OPEN' : '']));
  return (
    <>
      <div className="d-flex gap-2 mb-3 flex-wrap">{Object.entries(KINDS).map(([k, v]) => <button key={k} className={`btn btn-sm ${k === kind ? 'btn-primary' : 'btn-light'}`} onClick={() => setKind(k)}>{v.label}</button>)}
        {manage && <button className="btn btn-sm btn-outline-primary ms-auto" onClick={() => setF(blank())}><Plus size={14} /> Add</button>}</div>
      {kind === 'change-requests' && <Notice icon={ShieldAlert}>Approving a change request never changes the baseline. Apply the approved changes, then save a new baseline from the Timeline (it is recorded against the change request in the audit log).</Notice>}
      <ErrorBox error={error} />
      {kind === 'risks' && data?.data.length > 0 && <RiskMatrix risks={data.data} cell={cell} onCell={setCell} />}
      {kind === 'risks' && cell && <div className="small mb-1">Showing risks with probability {cell[0]} and impact {cell[1]} · <button className="btn btn-link btn-sm p-0" onClick={() => setCell(null)}>Show all</button></div>}
      <div className="card mt-2">{loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty title={`No ${K.label.toLowerCase()} recorded`} /> : (
        <table className="table table-hover"><thead><tr>{K.head.map((h) => <th key={h}>{h}</th>)}<th /></tr></thead>
          <tbody>{rowsShown.map((r) => <tr key={r.id}>{K.cols(r, nameOf).map((c, i) => <td key={i} className={i === 0 ? 'fw-medium' : 'small'}>{c}</td>)}
            <td className="text-end text-nowrap">{manage && kind === 'change-requests' && ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status) && <><button className="btn btn-sm btn-light me-1" onClick={() => decide(r, 'APPROVED')}>Approve</button><button className="btn btn-sm btn-light me-1" onClick={() => decide(r, 'REJECTED')}>Reject</button></>}
              {manage && !(kind === 'change-requests' && ['APPROVED', 'REJECTED', 'IMPLEMENTED'].includes(r.status)) && <button className="btn btn-sm btn-ghost" onClick={() => setF({ ...Object.fromEntries(K.fields.map(([k]) => [k, r[k] ?? ''])), id: r.id })}>Edit</button>}</td></tr>)}</tbody></table>)}</div>
      {f && <Modal open size="lg" onClose={() => setF(null)} title={`${f.id ? 'Edit' : 'Add'} ${K.label.toLowerCase().replace(/s$/, '')}`} footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
        <ErrorBox error={err} />
        <div className="row">{K.fields.map(([k, label, t]) => <div key={k} className={t === 'textarea' || !t ? 'col-12' : 'col-md-6'}><Field label={label} error={fieldErrors(err)[k]}>{(id) =>
          t === 'textarea' ? <textarea id={id} className="form-control" rows={3} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          : t === 'person' ? <Select id={id} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} placeholder="—" options={internal.map((p) => ({ value: p.id, label: p.name }))} />
          : t === 'reg' ? <Select id={id} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} options={['OPEN', 'IN_PROGRESS', 'CLOSED'].map((s) => ({ value: s, label: labelize(s) }))} />
          : t === 'score' ? <Select id={id} value={String(f[k])} onChange={(v) => setF({ ...f, [k]: Number(v) })} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
          : <input id={id} type={t === 'date' ? 'date' : t === 'number' ? 'number' : 'text'} className="form-control" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field></div>)}</div>
      </Modal>}
    </>
  );
}

export function Team() {
  const { project, can, reload } = useProject();
  const toast = useToast();
  const manage = can('project.members') && !project.readOnly;
  const dir = useLoad(() => (manage ? get('/org/members', { pageSize: 200 }) : Promise.resolve(null)), []);
  const work = useLoad(() => get(`/projects/${project.id}/work-items`, { all: 'true' }), [project.id]);
  const wl = useLoad(() => get('/workload').catch(() => null), []);
  const [adding, setAdding] = useState(null);
  const memberIds = new Set(project.members.map((m) => m.id));
  const candidates = (dir.data?.data || []).filter((m) => m.status === 'ACTIVE' && !memberIds.has(m.userId) && m.role !== 'CUSTOMER');
  const contacts = (dir.data?.data || []).filter((m) => m.status === 'ACTIVE' && !memberIds.has(m.userId) && m.role === 'CUSTOMER' && m.customerCompany?.id === project.customerCompanyId);
  const items = work.data?.data || [];
  const today = new Date().toISOString().slice(0, 10);
  const stats = (id) => { const mine = items.filter((i) => i.assigneeId === id && i.type !== 'MODULE'); const open = mine.filter((i) => !['DONE', 'CANCELLED'].includes(i.status));
    return { open: open.length, done: mine.filter((i) => i.status === 'DONE').length, late: open.filter((i) => i.plannedFinish && i.plannedFinish < today).length, hours: open.reduce((s, i) => s + (Number(i.estimateHours) || 0), 0) }; };
  const load = new Map((wl.data?.data || []).map((w) => [w.userId, w]));
  const setRole = async (m, role, allocationPct = m.allocationPct ?? 100) => { try { await put(`/projects/${project.id}/members/${m.id}`, { role, allocationPct }); reload(); toast('Updated', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const addAll = async () => {
    try { for (const [userId, t] of Object.entries(adding)) await put(`/projects/${project.id}/members/${userId}`, { role: t.role, allocationPct: t.allocationPct }); toast(`${Object.keys(adding).length} added to the project`, 'success'); setAdding(null); reload(); }
    catch (e) { toast(e.message, 'error'); reload(); }
  };
  const internal = project.members.filter((m) => m.role !== 'CUSTOMER');
  const clients = project.members.filter((m) => m.role === 'CUSTOMER');
  return (
    <>
      <Card bodyClass="p-0" title={<>Project team <span className="text-muted fw-normal">· {internal.length}</span></>} actions={manage && <button className="btn btn-sm btn-primary" onClick={() => setAdding({})}><Plus size={14} /> Add people</button>}>
        <div className="table-wrap"><table className="table mb-0">
          <thead><tr><th>Person</th><th>Designation</th><th>Project role</th><th>Allocation</th><th className="text-end">Open tasks</th><th className="text-end">Done</th><th className="text-end">Remaining est.</th><th>Overall load (2 wks)</th><th /></tr></thead>
          <tbody>{internal.map((m) => { const st = stats(m.id); const w = load.get(m.id); const isPm = m.id === project.managerId; return (
            <tr key={m.id}>
              <td><span className="d-flex align-items-center gap-2"><Avatar name={m.name} /><span><span className="fw-semibold d-block">{m.name}{isPm && <span className="pill pill-dark ms-2">PM</span>}</span><span className="small text-muted">{m.email}</span></span></span></td>
              <td className="small">{m.title || '—'}{m.department && <div className="text-muted">{m.department}</div>}</td>
              <td>{manage && !isPm ? <select className="form-select form-select-sm" style={{ width: 130 }} value={m.role} onChange={(e) => setRole(m, e.target.value)} aria-label={`Role of ${m.name}`}><option value="MANAGER">Co-manager</option><option value="MEMBER">Member</option><option value="VIEWER">Viewer</option></select> : <span className="pill pill-neutral">{isPm ? 'Project manager' : labelize(m.role)}</span>}</td>
              <td>{manage ? <select className="form-select form-select-sm" style={{ width: 82 }} value={m.allocationPct ?? 100} onChange={(e) => setRole(m, m.role, Number(e.target.value))} aria-label={`Allocation of ${m.name}`}>{[100, 75, 50, 25, 0].map((n) => <option key={n} value={n}>{n}%</option>)}</select> : `${m.allocationPct ?? 100}%`}</td>
              <td className="text-end num">{st.open}{st.late > 0 && <span className="text-danger small fw-semibold"> ({st.late} late)</span>}</td>
              <td className="text-end num">{st.done}</td>
              <td className="text-end num small">{st.hours ? `${st.hours}h` : '—'}</td>
              <td style={{ minWidth: 140 }}>{w ? <div className="d-flex align-items-center gap-2"><div className="meter flex-grow-1"><span style={{ width: `${Math.min(100, w.pct)}%`, background: w.pct > 100 ? 'var(--red)' : w.pct > 80 ? 'var(--amber)' : 'var(--green)' }} /></div><span className="small num">{Math.round(w.pct)}%</span></div> : <span className="small text-muted">—</span>}</td>
              <td className="text-end">{manage && !isPm && <ConfirmButton className="btn btn-sm btn-ghost btn-icon text-danger" title={`Remove ${m.name}?`} message="They lose access to this project. Their tasks stay assigned so you can reassign them." confirmLabel="Remove" onConfirm={async () => { await del(`/projects/${project.id}/members/${m.id}`); reload(); }}><Trash2 size={14} aria-label="Remove" /></ConfirmButton>}</td>
            </tr>); })}</tbody>
        </table></div>
      </Card>
      {project.customerCompanyId && <Card className="mt-3" title={<>Client contacts <span className="text-muted fw-normal">· {project.customerName}</span></>}>
        {clients.length ? <ul className="list-plain">{clients.map((m) => <li key={m.id}><Avatar sm name={m.name} /><span className="flex-grow-1"><span className="fw-semibold">{m.name}</span> <span className="small text-muted">{m.email}</span></span>
          {manage && <ConfirmButton className="btn btn-sm btn-ghost text-danger" title={`Remove ${m.name}?`} confirmLabel="Remove" onConfirm={async () => { await del(`/projects/${project.id}/members/${m.id}`); reload(); }}>Remove</ConfirmButton>}</li>)}</ul> : <div className="small text-muted">No client contacts on this project.</div>}
        {manage && contacts.length > 0 && <div className="d-flex gap-2 flex-wrap mt-2">{contacts.map((c) => <button key={c.userId} className="btn btn-sm btn-light" onClick={async () => { try { await put(`/projects/${project.id}/members/${c.userId}`, { role: 'CUSTOMER' }); reload(); } catch (e) { toast(e.message, 'error'); } }}><Plus size={13} /> {c.name}</button>)}</div>}
        {!project.customerVisible && <div className="form-text mt-2">Client access is off — turn it on in Settings so contacts can follow the project.</div>}
      </Card>}
      {adding && <Modal open size="lg" onClose={() => setAdding(null)} title="Add people to the project" footer={<><button className="btn btn-light" onClick={() => setAdding(null)}>Cancel</button><button className="btn btn-primary" disabled={!Object.keys(adding).length} onClick={addAll}>Add {Object.keys(adding).length || ''} {Object.keys(adding).length === 1 ? 'person' : 'people'}</button></>}>
        {dir.loading ? <Loading /> : candidates.length ? <TeamPicker people={candidates} team={adding} setTeam={setAdding} managerId={null} workload={wl.data?.data} /> : <Empty title="Everyone is already on this project">Add more people in Settings → Users & roles.</Empty>}
      </Modal>}
    </>
  );
}

export function Activity() {
  const { project } = useProject();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get(`/projects/${project.id}/activity`, { page, pageSize: 40 }), [project.id, page]);
  const say = (e) => {
    const m = e.metadata || {}; const what = e.action.split('.').slice(1).join(' ').replace(/_/g, ' ');
    const target = m.number ? ` #${m.number}` : m.title ? ` "${m.title}"` : '';
    const detail = m.from && m.to ? ` (${labelize(m.from)} → ${labelize(m.to)})` : m.changes ? ` (${Object.keys(m.changes).filter((k) => k !== 'version').join(', ')})` : '';
    return `${what} ${e.entityType === 'WorkItem' ? 'task' : e.entityType === 'Ticket' ? 'ticket' : e.entityType.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}${target}${detail}`;
  };
  return (
    <Card title="Activity" bodyClass="p-0">
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <div className="p-3"><Loading /></div> : data.data.length === 0 ? <Empty title="No activity yet" /> : (
        <ul className="list-plain px-3">{data.data.map((e) => <li key={e.id} className="small"><Avatar sm name={e.actorName} /><span className="flex-grow-1"><strong>{e.actorName}</strong> {say(e)}</span><span className="text-muted text-nowrap" title={new Date(e.createdAt).toLocaleString()}>{fmtDate(e.createdAt)}</span></li>)}</ul>)}
      <div className="px-3 pb-2"><Pagination meta={data?.meta} onPage={setPage} /></div>
    </Card>
  );
}

export function ProjectSettings() {
  const { project: p, reload } = useProject();
  const toast = useToast();
  const refs = useLoad(() => Promise.all([get('/org/calendars'), get('/org/customers'), get('/org/members', { pageSize: 200 })]), []);
  const [f, setF] = useState({ name: p.name, description: p.description || '', objectives: p.objectives || '', plannedStart: p.plannedStart, plannedFinish: p.plannedFinish, priority: p.priority, calendarId: p.calendarId || '', timezone: p.timezone,
    customerVisible: p.customerVisible, budgetAmount: p.budgetAmount ?? '', budgetCurrency: p.budgetCurrency || 'USD', billingEnabled: Boolean(p.billingEnabled), hourlyRate: p.hourlyRate ?? '', managerId: p.managerId });
  const [err, setErr] = useState(null);
  const [cal, customers, members] = refs.data ? refs.data.map((x) => x.data) : [[], [], []];
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try { await patch(`/projects/${p.id}`, { ...f, version: p.version, calendarId: f.calendarId || null, budgetAmount: f.budgetAmount === '' ? null : Number(f.budgetAmount), hourlyRate: f.hourlyRate === '' ? null : Number(f.hourlyRate), description: f.description || null, objectives: f.objectives || null }); toast('Project updated', 'success'); reload(); }
    catch (x) { setErr(x); if (x.status === 409) reload(); }
  };
  const NEXT = { DRAFT: ['ACTIVE', 'CANCELLED'], ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['ACTIVE', 'CANCELLED'], COMPLETED: ['ARCHIVED', 'ACTIVE'], CANCELLED: ['ARCHIVED'], ARCHIVED: [] };
  const setStatus = async (status) => { try { await post(`/projects/${p.id}/status`, { status, version: p.version }); toast(`Project is now ${labelize(status).toLowerCase()}`, 'success'); reload(); } catch (x) { toast(x.message, 'error'); } };
  return (
    <div className="row g-3">
      <div className="col-lg-8"><Card title="Project details"><ErrorBox error={err} />
        <form onSubmit={save} className="row">
          <div className="col-12"><Field label="Name">{(id) => <input id={id} className="form-control" value={f.name} disabled={p.readOnly} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
          <div className="col-12"><Field label="Description">{(id) => <textarea id={id} className="form-control" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field></div>
          <div className="col-12"><Field label="Objectives">{(id) => <textarea id={id} className="form-control" rows={2} value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} />}</Field></div>
          <div className="col-md-4"><Field label="Planned start" hint="Does not move phases or tasks.">{(id) => <input id={id} type="date" className="form-control" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} />}</Field></div>
          <div className="col-md-4"><Field label="Planned finish">{(id) => <input id={id} type="date" className="form-control" value={f.plannedFinish} onChange={(e) => setF({ ...f, plannedFinish: e.target.value })} />}</Field></div>
          <div className="col-md-4"><Field label="Priority">{(id) => <Select id={id} value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((x) => ({ value: x, label: labelize(x) }))} />}</Field></div>
          <div className="col-md-6"><Field label="Project manager">{(id) => <Select id={id} value={f.managerId} onChange={(v) => setF({ ...f, managerId: v })} options={members.filter((m) => ['ADMIN', 'MANAGER'].includes(m.role)).map((m) => ({ value: m.userId, label: m.name }))} />}</Field></div>
          <div className="col-md-6"><Field label="Working calendar">{(id) => <Select id={id} value={f.calendarId} onChange={(v) => setF({ ...f, calendarId: v || '' })} placeholder="Organization default" options={cal.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>
          {p.budgetAmount !== undefined && <><div className="col-md-4"><Field label="Budget">{(id) => <input id={id} type="number" min="0" className="form-control" value={f.budgetAmount} onChange={(e) => setF({ ...f, budgetAmount: e.target.value })} />}</Field></div>
            <div className="col-md-2"><Field label="Currency">{(id) => <input id={id} className="form-control" maxLength={3} value={f.budgetCurrency} onChange={(e) => setF({ ...f, budgetCurrency: e.target.value.toUpperCase() })} />}</Field></div>
            <div className="col-md-3"><Field label="Hourly rate">{(id) => <input id={id} type="number" min="0" className="form-control" value={f.hourlyRate} onChange={(e) => setF({ ...f, hourlyRate: e.target.value })} />}</Field></div>
            <div className="col-md-3 d-flex align-items-center"><div className="form-check form-switch"><input className="form-check-input" type="checkbox" id="sb" checked={f.billingEnabled} onChange={(e) => setF({ ...f, billingEnabled: e.target.checked })} /><label className="form-check-label" htmlFor="sb">Billable time</label></div></div></>}
          <div className="col-12"><div className="form-check form-switch mb-3"><input className="form-check-input" type="checkbox" id="scv" disabled={!p.customerCompanyId} checked={f.customerVisible} onChange={(e) => setF({ ...f, customerVisible: e.target.checked })} /><label className="form-check-label" htmlFor="scv">Shared with customer contacts</label></div></div>
          <div className="col-12"><button className="btn btn-primary" disabled={p.readOnly}>Save changes</button></div>
        </form></Card></div>
      <div className="col-lg-4"><Card title="Lifecycle"><div className="mb-2">Current status: <StatusBadge status={p.status} /></div>
        <div className="d-flex flex-column gap-2">{NEXT[p.status].map((s) => <ConfirmButton key={s} className="btn btn-light" tone={['CANCELLED', 'ARCHIVED'].includes(s) ? 'danger' : 'primary'} title={`Move project to ${labelize(s).toLowerCase()}?`}
          message={s === 'COMPLETED' ? 'All work items must be done or cancelled.' : s === 'ARCHIVED' || s === 'CANCELLED' ? 'The project becomes read-only.' : undefined} confirmLabel={labelize(s)} onConfirm={() => setStatus(s)}>Move to {labelize(s).toLowerCase()}</ConfirmButton>)}
          {NEXT[p.status].length === 0 && <div className="small text-muted">Archived projects are final.</div>}</div></Card></div>
    </div>
  );
}
