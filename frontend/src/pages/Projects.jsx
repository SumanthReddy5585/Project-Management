import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, FolderKanban, Settings2 } from 'lucide-react';
import { get, post } from '../api/client.js';
import { useLoad, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { addDaysISO, todayISO } from '../lib/format.js';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Pagination, Segmented, Select, useToast, fieldErrors } from '../components/ui.jsx';
import { ProjectCard } from './Home.jsx';

/** Short project code from the name: initials of up to 4 words, or the first 3 letters. */
const codeFrom = (name) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let c = words.length > 1 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 3);
  if (!/^[A-Z]/.test(c)) c = `P${c}`;
  return c.padEnd(2, 'X').slice(0, 6);
};

export function NewProjectDialog({ onClose }) {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const refs = useLoad(() => Promise.all([get('/org/customers'), get('/org/members', { pageSize: 200 }), get('/org/templates')]), []);
  const [customers, members, templates] = refs.data ? refs.data.map((r) => r.data) : [[], [], []];
  const [f, setF] = useState({ name: '', customerCompanyId: '', plannedStart: todayISO(), plannedFinish: addDaysISO(todayISO(), 90), share: true, templateId: '', teamMemberIds: [], customerContactIds: [], managerId: user.id, code: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const internal = members.filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE' && m.userId !== f.managerId);
  const contacts = members.filter((m) => m.role === 'CUSTOMER' && m.status === 'ACTIVE' && m.customerCompany?.id === f.customerCompanyId);
  const toggle = (k, id) => setF((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    const base = f.code || codeFrom(f.name);
    const body = { name: f.name, managerId: f.managerId, plannedStart: f.plannedStart, plannedFinish: f.plannedFinish, status: 'ACTIVE',
      customerCompanyId: f.customerCompanyId || null, customerVisible: Boolean(f.customerCompanyId && f.share),
      customerContactIds: f.customerCompanyId ? (f.customerContactIds.length ? f.customerContactIds : contacts.map((c) => c.userId)) : [],
      teamMemberIds: f.teamMemberIds, templateId: f.templateId || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    try {
      for (let i = 0; i < 6; i++) {
        try { const p = await post('/projects', { ...body, code: i ? `${base.slice(0, 8)}${i + 1}` : base }); toast(`${p.name} created`, 'success'); nav(`/projects/${p.id}`); return; }
        catch (x) { if (!(x.status === 409 && !f.code)) throw x; }
      }
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const fe = fieldErrors(err);
  return (
    <Modal open size="lg" onClose={onClose} title="New project" footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="np" disabled={busy || f.name.trim().length < 2 || f.plannedFinish < f.plannedStart}>{busy ? 'Creating…' : 'Create project'}</button></>}>
      <ErrorBox error={err} />
      <form id="np" onSubmit={submit}>
        <Field label="Project name" error={fe.name}>{(id) => <input id={id} className="form-control form-control-lg" placeholder="Website redesign" value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus />}</Field>
        <div className="row">
          <div className="col-md-6"><Field label="Client" hint="Leave empty for an internal project.">{(id) => <Select id={id} value={f.customerCompanyId} onChange={(v) => setF((x) => ({ ...x, customerCompanyId: v || '', customerContactIds: [] }))} placeholder="Internal project" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>
          <div className="col-6 col-md-3"><Field label="Start">{(id) => <input id={id} type="date" className="form-control" value={f.plannedStart} onChange={(e) => set('plannedStart')(e.target.value)} />}</Field></div>
          <div className="col-6 col-md-3"><Field label="Finish" error={f.plannedFinish < f.plannedStart ? 'Must be after start' : fe.plannedFinish}>{(id) => <input id={id} type="date" className="form-control" value={f.plannedFinish} min={f.plannedStart} onChange={(e) => set('plannedFinish')(e.target.value)} />}</Field></div>
        </div>
        {f.customerCompanyId && <div className="form-check form-switch mb-3"><input className="form-check-input" type="checkbox" role="switch" id="np-share" checked={f.share} onChange={(e) => set('share')(e.target.checked)} />
          <label className="form-check-label" htmlFor="np-share">Let the client follow this project <span className="text-muted">— they only see what you choose to share</span></label></div>}
        <details className="more">
          <summary><Settings2 size={15} /> More options</summary>
          <div className="row">
            <div className="col-md-6"><Field label="Starting plan" hint="Creates phases and milestones for you.">{(id) => <Select id={id} value={f.templateId} onChange={(v) => set('templateId')(v || '')} placeholder="Standard plan" options={templates.map((t) => ({ value: t.id, label: t.name }))} />}</Field></div>
            {role === 'ADMIN' && <div className="col-md-6"><Field label="Project manager">{(id) => <Select id={id} value={f.managerId} onChange={set('managerId')} options={members.filter((m) => ['ADMIN', 'MANAGER'].includes(m.role)).map((m) => ({ value: m.userId, label: m.userId === user.id ? `${m.name} (you)` : m.name }))} />}</Field></div>}
            <div className="col-md-6"><Field label="Short code" hint="Used in task numbers. Leave empty to generate it.">{(id) => <input id={id} className="form-control text-uppercase" maxLength={10} placeholder={f.name ? codeFrom(f.name) : 'WEB'} value={f.code} onChange={(e) => set('code')(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />}</Field></div>
          </div>
          {internal.length > 0 && <fieldset className="mb-3"><legend className="form-label">Team</legend><div className="d-flex flex-wrap gap-2">{internal.map((m) => (
            <label key={m.userId} className={`btn btn-sm ${f.teamMemberIds.includes(m.userId) ? 'btn-outline-primary' : 'btn-light'}`}><input type="checkbox" className="visually-hidden" checked={f.teamMemberIds.includes(m.userId)} onChange={() => toggle('teamMemberIds', m.userId)} />{m.name}</label>))}</div></fieldset>}
          {contacts.length > 1 && <fieldset className="mb-2"><legend className="form-label">Client contacts <span className="text-muted fw-normal">(all by default)</span></legend><div className="d-flex flex-wrap gap-2">{contacts.map((m) => (
            <label key={m.userId} className={`btn btn-sm ${f.customerContactIds.includes(m.userId) ? 'btn-outline-primary' : 'btn-light'}`}><input type="checkbox" className="visually-hidden" checked={f.customerContactIds.includes(m.userId)} onChange={() => toggle('customerContactIds', m.userId)} />{m.name}</label>))}</div></fieldset>}
          <div className="form-text">Budget, billing and calendars can be set later in the project's settings.</div>
        </details>
      </form>
    </Modal>
  );
}

export default function Projects() {
  const { can, isCustomer } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [view, setView] = useState('active');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const status = { active: 'ACTIVE,ON_HOLD,DRAFT', done: 'COMPLETED', all: undefined }[view];
  const { data, error, loading, reload } = useLoad(() => get('/projects', { q: dq || undefined, status, page, pageSize: 24 }), [dq, status, page]);
  const creating = params.get('new') === '1' && can('project.create');
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Projects</h1><div className="sub">{isCustomer ? 'Projects your team has shared with you.' : 'Everything your team is working on.'}</div></div>
        {can('project.create') && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={17} /> New project</button>}</div>
      <div className="filters">
        <input className="form-control" style={{ maxWidth: 280 }} placeholder="Search projects" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Search projects" />
        {!isCustomer && <Segmented label="Show" value={view} onChange={(v) => { setView(v); setPage(1); }} options={[['active', 'Active'], ['done', 'Completed'], ['all', 'All']]} />}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Loading /> : data?.data.length === 0 ? (
        <Card><Empty icon={FolderKanban} title={q ? 'No matching projects' : 'Start your first project'} action={can('project.create') && !q && <button className="btn btn-primary" onClick={() => setParams({ new: '1' })}><Plus size={16} /> New project</button>}>{q ? 'Try another name.' : isCustomer ? 'Your team will share projects with you here.' : 'It takes less than a minute.'}</Empty></Card>
      ) : <div className="project-grid">{data?.data.map((p) => <ProjectCard key={p.id} p={p} />)}</div>}
      <div className="mt-3"><Pagination meta={data?.meta} onPage={setPage} /></div>
      {creating && <NewProjectDialog onClose={() => setParams({})} />}
    </>
  );
}
