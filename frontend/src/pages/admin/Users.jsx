import { useMemo, useState } from 'react';
import { Plus, Copy, KeyRound, Link2, UserPlus, Search, ShieldCheck, Briefcase, Users as UsersIcon, Building2, Mail, CheckCircle2, Stamp } from 'lucide-react';
import { get, post, patch, del } from '../../api/client.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDateTime, fmtRelative, labelize } from '../../lib/format.js';
import { Avatar, Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, Notice, Pagination, Pill, Select, useToast, fieldErrors } from '../../components/ui.jsx';

// Access levels. "Project director" is a manager with the director designation: only directors appear in
// the project director list, and only project managers in the project manager list.
const ROLE_INFO = {
  ADMIN: ['Administrator', 'Everything, including users, settings and every project.', ShieldCheck],
  DIRECTOR: ['Project director', 'Approves project plans, documents and change requests on the projects they direct.', Stamp],
  MANAGER: ['Project manager', 'Builds the plan, runs the team, approves timesheets, sees reports.', Briefcase],
  EMPLOYEE: ['Team member', 'Works on assigned tasks and tickets, logs time.', UsersIcon],
  CUSTOMER: ['Client', 'Portal access: shared projects, their tickets and the help center.', Building2],
};
/** The access tile a member shows as (directors are managers with the designation). */
const levelOf = (m) => (m.role === 'MANAGER' && m.projectDirector ? 'DIRECTOR' : m.role);
const fromLevel = (k) => (k === 'DIRECTOR' ? { role: 'MANAGER', projectDirector: true } : k === 'ADMIN' ? { role: 'ADMIN' } : { role: k, projectDirector: false });
export const DEPARTMENTS = ['Engineering', 'Project Management', 'Quality Assurance', 'Business Analysis', 'Design', 'Support', 'Sales', 'Finance', 'Operations', 'HR'];

function CopyRow({ label, value }) {
  const toast = useToast();
  return (
    <div className="field-row"><span>{label}</span>
      <div className="input-group input-group-sm"><input className="form-control mono" readOnly value={value} aria-label={label} onFocus={(e) => e.target.select()} />
        <button className="btn btn-light" onClick={() => navigator.clipboard?.writeText(value).then(() => toast('Copied', 'success'), () => toast('Copy failed — select and copy it', 'error'))}><Copy size={13} /></button></div></div>
  );
}

function Credentials({ result, onClose }) {
  const text = `Sign in: ${result.signInUrl}\nEmail: ${result.email}\nTemporary password: ${result.temporaryPassword}\nYou'll be asked to choose your own password at first sign-in.`;
  return (
    <Modal open onClose={onClose} title={result.title} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      {result.temporaryPassword ? <>
        <Notice tone="warn">This password is shown <strong>only once</strong>. Share it privately (e.g. in person or a direct message). The person must change it when they first sign in.</Notice>
        <div className="mt-3"><CopyRow label="Sign-in page" value={result.signInUrl} /><CopyRow label="Email" value={result.email} /><CopyRow label="Temp password" value={result.temporaryPassword} /></div>
        <button className="btn btn-sm btn-light mt-2" onClick={() => navigator.clipboard?.writeText(text)}><Copy size={13} /> Copy all as a message</button>
        {result.emailed && <div className="small text-success mt-2"><CheckCircle2 size={13} /> Also emailed to {result.email}.</div>}
      </> : result.url ? <>
        <p className="small">Send this link to the person. It works once and expires in {result.expires}.</p><CopyRow label="Link" value={result.url} />
      </> : <Notice>{result.email} already had an account in another workspace, so they can sign in with their existing password.</Notice>}
    </Modal>
  );
}

function PersonForm({ f, setF, customers, departments, isNew, isSelf }) {
  const fe = {};
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e });
  return (
    <>
      <div className="row">
        <div className="col-md-6"><Field label="Full name">{(id) => <input id={id} className="form-control" value={f.name} onChange={set('name')} autoFocus={isNew} />}</Field></div>
        <div className="col-md-6"><Field label="Work email" error={fe.email}>{(id) => <input id={id} type="email" className="form-control" value={f.email} onChange={set('email')} disabled={!isNew} />}</Field></div>
      </div>
      {f.role !== 'CUSTOMER' && <div className="row">
        <div className="col-md-6"><Field label="Designation" hint="Job title shown across the app">{(id) => <input id={id} className="form-control" placeholder="e.g. Senior Developer" value={f.title} onChange={set('title')} />}</Field></div>
        <div className="col-md-6"><Field label="Department">{(id) => <><input id={id} list="dept-list" className="form-control" placeholder="e.g. Engineering" value={f.department} onChange={set('department')} /><datalist id="dept-list">{departments.map((d) => <option key={d} value={d} />)}</datalist></>}</Field></div>
        <div className="col-md-4"><Field label="Employee ID">{(id) => <input id={id} className="form-control" value={f.employeeId} onChange={set('employeeId')} />}</Field></div>
        <div className="col-md-4"><Field label="Phone">{(id) => <input id={id} className="form-control" value={f.phone} onChange={set('phone')} />}</Field></div>
        <div className="col-md-4"><Field label="Hours per week" hint="Used for capacity planning">{(id) => <input id={id} type="number" min="0" max="80" className="form-control" value={f.weeklyCapacityHours} onChange={set('weeklyCapacityHours')} />}</Field></div>
        <div className="col-12"><Field label="Skills" hint="Comma-separated, e.g. React, SQL, Testing">{(id) => <input id={id} className="form-control" value={f.skills} onChange={set('skills')} />}</Field></div>
      </div>}
      {f.role === 'CUSTOMER' && <div className="row"><div className="col-md-6"><Field label="Phone">{(id) => <input id={id} className="form-control" value={f.phone} onChange={set('phone')} />}</Field></div><div className="col-md-6"><Field label="Designation (optional)">{(id) => <input id={id} className="form-control" value={f.title} onChange={set('title')} />}</Field></div></div>}
      <div className="form-label mt-1">Access level</div>
      <div className="row g-2 mb-2">{Object.entries(ROLE_INFO).map(([k, [label, desc, Icon]]) => {
        const on = levelOf(f) === k;
        return (
          <div key={k} className="col-md-6"><label className={`tile p-2 d-flex gap-2 align-items-start ${on ? 'border-primary' : ''}`} style={{ cursor: isSelf ? 'not-allowed' : 'pointer', boxShadow: on ? '0 0 0 3px var(--brand-ring)' : undefined }}>
            <input type="radio" className="form-check-input mt-1" name="role" checked={on} disabled={isSelf} onChange={() => setF({ ...f, ...fromLevel(k) })} />
            <span><span className="fw-semibold d-flex align-items-center gap-1"><Icon size={14} /> {label}</span><span className="small text-muted d-block">{desc}</span></span></label></div>);
      })}</div>
      {f.role === 'ADMIN' && <div className="form-check mb-3"><input className="form-check-input" type="checkbox" id="adm-dir" checked={Boolean(f.projectDirector)} onChange={(e) => setF({ ...f, projectDirector: e.target.checked })} />
        <label className="form-check-label" htmlFor="adm-dir">This administrator can also be chosen as a project director</label></div>}
      {f.role === 'CUSTOMER' && <Field label="Client company">{(id) => <Select id={id} value={f.customerCompanyId} onChange={set('customerCompanyId')} placeholder="Choose…" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field>}
    </>
  );
}

const blank = { name: '', email: '', title: '', department: '', employeeId: '', phone: '', weeklyCapacityHours: 40, skills: '', role: 'EMPLOYEE', projectDirector: false, customerCompanyId: '', access: 'password' };

export function AdminUsers() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const members = useLoad(() => get('/org/members', { q: dq || undefined, role: role === 'DIRECTOR' ? 'MANAGER' : role || undefined, page, pageSize: 50 }), [dq, page, role]);
  const all = useLoad(() => get('/org/members', { pageSize: 200 }), []);
  const invites = useLoad(() => get('/org/invitations'), []);
  const customers = useLoad(() => get('/org/customers'), []);
  const [adding, setAdding] = useState(null);
  const [edit, setEdit] = useState(null);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const cust = customers.data?.data || [];
  const departments = useMemo(() => [...new Set([...DEPARTMENTS, ...(all.data?.data || []).map((m) => m.department).filter(Boolean)])].sort(), [all.data]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(ROLE_INFO).map((r) => [r, (all.data?.data || []).filter((m) => levelOf(m) === r && m.status === 'ACTIVE').length])), [all.data]);
  const rows = (members.data?.data || []).filter((m) => (!dept || m.department === dept) && (!role || levelOf(m) === role));
  const payload = (f) => ({ name: f.name.trim(), title: f.title || null, department: f.department || null, employeeId: f.employeeId || null, phone: f.phone || null,
    role: f.role, projectDirector: ['ADMIN', 'MANAGER'].includes(f.role) ? Boolean(f.projectDirector) : false, customerCompanyId: f.role === 'CUSTOMER' ? f.customerCompanyId || null : null, ...(f.role !== 'CUSTOMER' && { weeklyCapacityHours: Number(f.weeklyCapacityHours) || 0, skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean) }) });
  const create = async () => {
    setErr(null);
    try {
      if (adding.access === 'password') {
        const r = await post('/org/members', { ...payload(adding), email: adding.email.trim() });
        setResult({ ...r, title: `${adding.name} has been added` });
      } else {
        const r = await post('/org/invitations', { email: adding.email.trim(), name: adding.name || undefined, role: adding.role, customerCompanyId: adding.role === 'CUSTOMER' ? adding.customerCompanyId : undefined, title: adding.title || undefined, department: adding.department || undefined });
        setResult({ title: `Invitation for ${r.email}`, url: r.url, expires: '7 days', email: r.email });
        invites.reload();
      }
      setAdding(null); members.reload(); all.reload();
    } catch (e) { setErr(e); }
  };
  const save = async () => { setErr(null); try { await patch(`/org/members/${edit.userId}`, { ...payload(edit), status: edit.status }); setEdit(null); members.reload(); all.reload(); toast('Saved', 'success'); } catch (e) { setErr(e); } };
  const tempPassword = async (m) => { try { const r = await post(`/org/members/${m.userId}/temp-password`); setResult({ ...r, title: `New temporary password for ${m.name}` }); members.reload(); } catch (e) { toast(e.message, 'error'); } };
  const canCreate = adding && adding.name.trim() && /@/.test(adding.email) && (adding.role !== 'CUSTOMER' || adding.customerCompanyId) && (adding.role === 'CUSTOMER' || adding.access === 'invite' || adding.title.trim());
  return (
    <>
      <div className="page-header"><div><h2 className="h-page">Users & roles</h2><div className="sub">Add your team with their designation and department, then pick them when you set up projects.</div></div>
        <button className="btn btn-primary" onClick={() => { setErr(null); setAdding({ ...blank, customerCompanyId: cust[0]?.id || '' }); }}><UserPlus size={15} /> Add user</button></div>
      <div className="row g-3 mb-3 row-cols-2 row-cols-md-3 row-cols-xl-5">{Object.entries(ROLE_INFO).map(([k, [label, , Icon]]) => (
        <div key={k} className="col"><button className={`tile w-100 text-start ${role === k ? 'border-primary' : ''}`} onClick={() => { setRole(role === k ? '' : k); setPage(1); }}><div className="label"><span className="ic"><Icon size={14} /></span>{label}s</div><div className="value">{counts[k] ?? '—'}</div><div className="hint">{role === k ? 'Showing only these — click to clear' : 'Click to filter'}</div></button></div>))}</div>
      {invites.data?.data.length > 0 && <Card title={<><Mail size={15} /> Pending invitations</>} className="mb-3" bodyClass="p-0"><div className="table-wrap"><table className="table"><thead><tr><th>Email</th><th>Designation</th><th>Role</th><th>Expires</th><th /></tr></thead>
        <tbody>{invites.data.data.map((i) => <tr key={i.id}><td>{i.email}</td><td className="small">{i.title || '—'}</td><td><Pill>{labelize(i.role)}</Pill></td><td className={`small ${i.expired ? 'text-danger' : ''}`}>{i.expired ? 'Expired' : fmtDateTime(i.expiresAt)}</td>
          <td className="text-end"><ConfirmButton className="btn btn-sm btn-ghost text-danger" title="Revoke invitation?" confirmLabel="Revoke" onConfirm={async () => { await del(`/org/invitations/${i.id}`); invites.reload(); }}>Revoke</ConfirmButton></td></tr>)}</tbody></table></div></Card>}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="queue-toolbar">
          <div className="search-in"><Search size={15} /><input className="form-control form-control-sm" placeholder="Search name or email" aria-label="Search users" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select className="form-select form-select-sm" style={{ width: 'auto' }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department"><option value="">All departments</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
          <span className="ms-auto small text-muted">{rows.length} people</span>
        </div>
        <ErrorBox error={members.error} />
        {members.loading && !members.data ? <div className="p-3"><Loading /></div> : rows.length === 0 ? <Empty title="No one matches" /> : <div className="table-wrap"><table className="table table-hover mb-0">
          <thead><tr><th>Person</th><th>Designation</th><th>Department</th><th>Access</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
          <tbody>{rows.map((m) => <tr key={m.userId}>
            <td><span className="d-flex align-items-center gap-2"><Avatar name={m.name} /><span><span className="fw-semibold d-block">{m.name}{m.userId === user.id && <span className="text-muted fw-normal"> (you)</span>}</span><span className="small text-muted">{m.email}</span></span></span></td>
            <td>{m.title || <span className="text-muted small">—</span>}</td>
            <td className="small">{m.role === 'CUSTOMER' ? m.customerCompany?.name : m.department || <span className="text-muted">—</span>}</td>
            <td><Pill tone={m.role === 'ADMIN' ? 'dark' : levelOf(m) === 'DIRECTOR' ? 'warn' : m.role === 'MANAGER' ? 'blue' : m.role === 'CUSTOMER' ? 'sky' : 'neutral'}>{ROLE_INFO[levelOf(m)][0]}</Pill>
              {m.role === 'ADMIN' && m.projectDirector && <div className="small text-muted">also project director</div>}</td>
            <td><Pill tone={m.status === 'ACTIVE' ? 'ok' : 'risk'}>{m.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Pill>{m.mustChangePassword && <div className="small text-muted">Hasn’t set password</div>}</td>
            <td className="small text-muted text-nowrap">{m.lastLoginAt ? fmtRelative(m.lastLoginAt) : 'Never'}</td>
            <td className="text-end text-nowrap"><button className="btn btn-sm btn-light" onClick={() => { setErr(null); setEdit({ ...blank, ...m, title: m.title || '', department: m.department || '', employeeId: m.employeeId || '', phone: m.phone || '', skills: (m.skills || []).join(', '), customerCompanyId: m.customerCompany?.id || '' }); }}>Edit</button>
              {m.userId !== user.id && <ConfirmButton className="btn btn-sm btn-ghost" title={`Reset ${m.name}'s password?`} message="They will be signed out and get a new temporary password, shown once to you." confirmLabel="Reset" tone="primary" onConfirm={() => tempPassword(m)}><KeyRound size={13} /> Reset password</ConfirmButton>}</td></tr>)}</tbody></table></div>}
        <div className="px-3 pb-2"><Pagination meta={members.data?.meta} onPage={setPage} /></div>
      </div>

      {adding && <Modal open size="lg" onClose={() => setAdding(null)} title="Add a user" footer={<><button className="btn btn-light" onClick={() => setAdding(null)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={!canCreate}>{adding.access === 'password' ? 'Create user' : 'Create invitation link'}</button></>}>
        <ErrorBox error={err} />
        <PersonForm f={adding} setF={setAdding} customers={cust} departments={departments} isNew />
        <div className="form-label">How should they get access?</div>
        <div className="d-flex flex-column gap-2">
          <label className="d-flex gap-2 align-items-start"><input type="radio" className="form-check-input mt-1" name="access" checked={adding.access === 'password'} onChange={() => setAdding({ ...adding, access: 'password' })} />
            <span><span className="fw-semibold"><KeyRound size={13} /> Create the account now</span><span className="small text-muted d-block">You get a temporary password to share; they choose their own at first sign-in. Best when email isn’t set up.</span></span></label>
          <label className="d-flex gap-2 align-items-start"><input type="radio" className="form-check-input mt-1" name="access" checked={adding.access === 'invite'} onChange={() => setAdding({ ...adding, access: 'invite' })} />
            <span><span className="fw-semibold"><Link2 size={13} /> Send an invitation link</span><span className="small text-muted d-block">They open the link and set their own password (valid 7 days).</span></span></label>
        </div>
        {adding.access === 'invite' && adding.projectDirector && <Notice tone="info">They join as a project manager. Once they accept, edit them here and choose “Project director”.</Notice>}
      </Modal>}
      {edit && <Modal open size="lg" onClose={() => setEdit(null)} title={`Edit ${edit.name}`} footer={<><button className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!edit.name.trim()}>Save changes</button></>}>
        <ErrorBox error={err} />
        <PersonForm f={edit} setF={setEdit} customers={cust} departments={departments} isSelf={edit.userId === user.id} />
        {(edit.role === 'CUSTOMER') !== (edit.customerCompany != null) && <Notice tone="warn">Switching between client and internal access removes this person from their projects.</Notice>}
        <Field label="Status">{(id) => <Select id={id} value={edit.status} disabled={edit.userId === user.id} onChange={(v) => setEdit({ ...edit, status: v })} options={[{ value: 'ACTIVE', label: 'Active — can sign in' }, { value: 'DISABLED', label: 'Disabled — signed out and blocked' }]} />}</Field>
      </Modal>}
      {result && <Credentials result={result} onClose={() => setResult(null)} />}
    </>
  );
}
