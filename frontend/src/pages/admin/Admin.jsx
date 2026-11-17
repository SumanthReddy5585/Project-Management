import { useState } from 'react';
import { Plus, Copy, KeyRound, Trash2, Save } from 'lucide-react';
import { get, post, patch, put, del } from '../../api/client.js';
import { useLoad, useDebounced } from '../../lib/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtDateTime, fmtRelative, labelize } from '../../lib/format.js';
import { Card, ConfirmButton, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Pagination, Pill, Select, useToast, fieldErrors } from '../../components/ui.jsx';

const ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE', 'CUSTOMER'];
const TZ = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();

function CopyLink({ url, label }) {
  const toast = useToast();
  return <div className="input-group input-group-sm"><input className="form-control mono" readOnly value={url} aria-label={label} onFocus={(e) => e.target.select()} />
    <button className="btn btn-light" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Copied', 'success'), () => toast('Copy failed — select and copy manually', 'error'))}><Copy size={13} /> Copy</button></div>;
}

export function AdminUsers() {
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const members = useLoad(() => get('/org/members', { q: dq || undefined, page, pageSize: 25 }), [dq, page]);
  const invites = useLoad(() => get('/org/invitations'), []);
  const customers = useLoad(() => get('/org/customers'), []);
  const [inv, setInv] = useState(null);
  const [link, setLink] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  const sendInvite = async () => { setErr(null); try { const r = await post('/org/invitations', { ...inv, customerCompanyId: inv.role === 'CUSTOMER' ? inv.customerCompanyId : undefined, name: inv.name || undefined }); setInv(null); setLink({ title: `Invitation for ${r.email}`, url: r.url, note: 'Valid for 7 days, single use.' }); invites.reload(); } catch (e) { setErr(e); } };
  const saveMember = async () => { setErr(null); try { await patch(`/org/members/${edit.userId}`, { role: edit.role, status: edit.status, title: edit.title || null, weeklyCapacityHours: Number(edit.weeklyCapacityHours), skills: edit.skills.split(',').map((s) => s.trim()).filter(Boolean), customerCompanyId: edit.role === 'CUSTOMER' ? edit.customerCompanyId : null }); setEdit(null); members.reload(); toast('Member updated', 'success'); } catch (e) { setErr(e); } };
  const resetLink = async (m) => { try { const r = await post(`/org/members/${m.userId}/reset-link`); setLink({ title: `Password reset link for ${m.name}`, url: r.url, note: `Expires in ${r.expiresInMinutes} minutes, single use. Share it with the person securely.` }); } catch (e) { toast(e.message, 'error'); } };
  const cust = customers.data?.data || [];
  return (
    <>
      <PageHeader title="People and access" sub="Invite your team and clients. People only see the projects they are added to." actions={<button className="btn btn-primary" onClick={() => { setErr(null); setInv({ email: '', name: '', role: 'EMPLOYEE', customerCompanyId: cust[0]?.id }); }}><Plus size={15} /> Invite</button>} />
      <Notice tone="warn">Email delivery is not configured. Invitation and reset links are shown once here for you to send securely.</Notice>
      {invites.data?.data.length > 0 && <Card title="Pending invitations" className="my-3" bodyClass="p-0"><table className="table"><thead><tr><th>Email</th><th>Role</th><th>Expires</th><th /></tr></thead>
        <tbody>{invites.data.data.map((i) => <tr key={i.id}><td>{i.email}</td><td><Pill>{labelize(i.role)}</Pill></td><td className={`small ${i.expired ? 'text-danger' : ''}`}>{i.expired ? 'Expired' : fmtDateTime(i.expiresAt)}</td>
          <td className="text-end"><ConfirmButton className="btn btn-sm btn-ghost text-danger" title="Revoke invitation?" confirmLabel="Revoke" onConfirm={async () => { await del(`/org/invitations/${i.id}`); invites.reload(); }}>Revoke</ConfirmButton></td></tr>)}</tbody></table></Card>}
      <div className="filters mt-3"><input className="form-control form-control-sm" style={{ maxWidth: 280 }} placeholder="Search members" aria-label="Search members" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      <ErrorBox error={members.error} />
      <div className="card">{members.loading && !members.data ? <div className="p-3"><Loading /></div> : <table className="table table-hover"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th /></tr></thead>
        <tbody>{members.data?.data.map((m) => <tr key={m.userId}><td><div className="fw-medium">{m.name}{m.userId === user.id && <span className="text-muted"> (you)</span>}</div><div className="small text-muted">{m.email}</div></td>
          <td><Pill tone={m.role === 'ADMIN' ? 'dark' : m.role === 'CUSTOMER' ? 'blue' : 'neutral'}>{labelize(m.role)}</Pill>{m.customerCompany && <div className="small text-muted">{m.customerCompany.name}</div>}</td>
          <td><Pill tone={m.status === 'ACTIVE' ? 'ok' : 'risk'}>{labelize(m.status)}</Pill></td><td className="small text-muted">{m.lastLoginAt ? fmtRelative(m.lastLoginAt) : 'Never'}</td>
          <td className="text-end text-nowrap"><button className="btn btn-sm btn-ghost" onClick={() => { setErr(null); setEdit({ ...m, title: m.title || '', skills: m.skills.join(', '), customerCompanyId: m.customerCompany?.id }); }}>Edit</button>
            <button className="btn btn-sm btn-ghost" onClick={() => resetLink(m)} title="Issue a one-time password reset link"><KeyRound size={13} /> Reset link</button></td></tr>)}</tbody></table>}
        <Pagination meta={members.data?.meta} onPage={setPage} /></div>
      {inv && <Modal open onClose={() => setInv(null)} title="Invite someone" footer={<><button className="btn btn-light" onClick={() => setInv(null)}>Cancel</button><button className="btn btn-primary" onClick={sendInvite} disabled={!inv.email}>Create invitation</button></>}>
        <ErrorBox error={err} />
        <Field label="Email" error={fieldErrors(err).email}>{(id) => <input id={id} type="email" className="form-control" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} />}</Field>
        <Field label="Name (optional)">{(id) => <input id={id} className="form-control" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} />}</Field>
        <Field label="Organization role" hint={inv.role === 'CUSTOMER' ? 'Customers see only projects explicitly shared with them.' : inv.role === 'MANAGER' ? 'Managers can create projects; they only see projects they belong to.' : undefined}>{(id) => <Select id={id} value={inv.role} onChange={(v) => setInv({ ...inv, role: v })} options={ROLES.map((r) => ({ value: r, label: labelize(r) }))} />}</Field>
        {inv.role === 'CUSTOMER' && <Field label="Client">{(id) => <Select id={id} value={inv.customerCompanyId} onChange={(v) => setInv({ ...inv, customerCompanyId: v })} placeholder="Choose…" options={cust.map((c) => ({ value: c.id, label: c.name }))} />}</Field>}
      </Modal>}
      {edit && <Modal open onClose={() => setEdit(null)} title={`Edit ${edit.name}`} footer={<><button className="btn btn-light" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={saveMember}>Save</button></>}>
        <ErrorBox error={err} />
        <div className="row"><div className="col-6"><Field label="Role">{(id) => <Select id={id} value={edit.role} disabled={edit.userId === user.id} onChange={(v) => setEdit({ ...edit, role: v })} options={ROLES.map((r) => ({ value: r, label: labelize(r) }))} />}</Field></div>
          <div className="col-6"><Field label="Status">{(id) => <Select id={id} value={edit.status} disabled={edit.userId === user.id} onChange={(v) => setEdit({ ...edit, status: v })} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />}</Field></div></div>
        {edit.role === 'CUSTOMER' && <Field label="Client">{(id) => <Select id={id} value={edit.customerCompanyId} onChange={(v) => setEdit({ ...edit, customerCompanyId: v })} options={cust.map((c) => ({ value: c.id, label: c.name }))} />}</Field>}
        {(edit.role === 'CUSTOMER') !== (edit.customerCompany != null) && <Notice tone="warn">Switching between customer and internal roles removes this person's project memberships.</Notice>}
        {edit.role !== 'CUSTOMER' && <><Field label="Job title">{(id) => <input id={id} className="form-control" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />}</Field>
          <div className="row"><div className="col-6"><Field label="Weekly capacity (hours)">{(id) => <input id={id} type="number" min="0" max="80" className="form-control" value={edit.weeklyCapacityHours} onChange={(e) => setEdit({ ...edit, weeklyCapacityHours: e.target.value })} />}</Field></div>
            <div className="col-6"><Field label="Skills" hint="Comma-separated">{(id) => <input id={id} className="form-control" value={edit.skills} onChange={(e) => setEdit({ ...edit, skills: e.target.value })} />}</Field></div></div></>}
        {edit.status === 'DISABLED' && <div className="form-text">Disabling signs the person out everywhere.</div>}
      </Modal>}
      {link && <Modal open onClose={() => setLink(null)} title={link.title} footer={<button className="btn btn-primary" onClick={() => setLink(null)}>Done</button>}>
        <p className="small">This link is shown only once. {link.note}</p><CopyLink url={link.url} label="Link" /></Modal>}
    </>
  );
}

export function AdminCustomers() {
  const { data, error, loading, reload } = useLoad(() => get('/org/customers'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const save = async () => { setErr(null); try { f.id ? await patch(`/org/customers/${f.id}`, { name: f.name, domain: f.domain || null, notes: f.notes || null }) : await post('/org/customers', { name: f.name, domain: f.domain || null, notes: f.notes || null }); setF(null); reload(); } catch (e) { setErr(e); } };
  return (
    <>
      <PageHeader title="Clients" sub="Each client only sees projects and requests shared with them." actions={<button className="btn btn-primary" onClick={() => setF({ name: '', domain: '', notes: '' })}><Plus size={15} /> Add client</button>} />
      <ErrorBox error={error} />
      <div className="card">{loading && !data ? <div className="p-3"><Loading /></div> : data.data.length === 0 ? <Empty title="No customers yet" /> : <table className="table"><thead><tr><th>Company</th><th>Domain</th><th className="text-end">Contacts</th><th className="text-end">Projects</th><th className="text-end">Tickets</th><th /></tr></thead>
        <tbody>{data.data.map((c) => <tr key={c.id}><td className="fw-medium">{c.name}</td><td className="small">{c.domain}</td><td className="text-end">{c.contacts}</td><td className="text-end">{c.projects}</td><td className="text-end">{c.tickets}</td><td className="text-end"><button className="btn btn-sm btn-ghost" onClick={() => setF(c)}>Edit</button></td></tr>)}</tbody></table>}</div>
      {f && <Modal open onClose={() => setF(null)} title={f.id ? 'Edit customer' : 'Add customer'} footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" disabled={!f.name?.trim()} onClick={save}>Save</button></>}>
        <ErrorBox error={err} />
        <Field label="Name">{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Domain">{(id) => <input id={id} className="form-control" value={f.domain || ''} onChange={(e) => setF({ ...f, domain: e.target.value })} />}</Field>
        <Field label="Internal notes" hint="Never shown to customer users.">{(id) => <textarea id={id} className="form-control" value={f.notes || ''} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
      </Modal>}
    </>
  );
}

export function AdminCalendars() {
  const { data, error, loading, reload } = useLoad(() => get('/org/calendars'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']];
  const save = async () => { setErr(null); const body = { name: f.name, timezone: f.timezone, workDays: f.workDays, dayStart: f.dayStart, dayEnd: f.dayEnd, isDefault: f.isDefault, holidays: f.holidays.filter((h) => h.date && h.name) };
    try { f.id ? await patch(`/org/calendars/${f.id}`, body) : await post('/org/calendars', body); setF(null); reload(); toast('Calendar saved', 'success'); } catch (e) { setErr(e); } };
  return (
    <>
      <PageHeader title="Working days" sub="Set working days, hours and holidays. Task durations and request response times use them." actions={<button className="btn btn-primary" onClick={() => setF({ name: '', timezone: 'UTC', workDays: [1, 2, 3, 4, 5], dayStart: '09:00', dayEnd: '17:00', isDefault: false, holidays: [] })}><Plus size={15} /> New calendar</button>} />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <div className="row g-3">{data.data.map((c) => <div key={c.id} className="col-md-6"><Card title={<>{c.name} {c.isDefault && <Pill tone="blue">Default</Pill>}</>} actions={<button className="btn btn-sm btn-light" onClick={() => setF({ ...c, holidays: c.holidays.map((h) => ({ date: h.date, name: h.name })) })}>Edit</button>}>
        <dl className="kv"><dt>Working days</dt><dd>{DAYS.filter(([n]) => c.workDays.includes(n)).map(([, l]) => l).join(', ')}</dd><dt>Hours</dt><dd>{c.dayStart}–{c.dayEnd} ({c.timezone})</dd><dt>Holidays</dt><dd>{c.holidays.length ? c.holidays.slice(0, 5).map((h) => `${fmtDate(h.date)} ${h.name}`).join(' · ') : 'None'}{c.holidays.length > 5 && ` +${c.holidays.length - 5} more`}</dd></dl></Card></div>)}</div>}
      {f && <Modal open size="lg" onClose={() => setF(null)} title={f.id ? 'Edit calendar' : 'New calendar'} footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.name || !f.workDays.length}>Save</button></>}>
        <ErrorBox error={err} />
        <div className="row"><div className="col-md-6"><Field label="Name">{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
          <div className="col-md-6"><Field label="Timezone">{(id) => <select id={id} className="form-select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{['UTC', ...TZ].map((z) => <option key={z}>{z}</option>)}</select>}</Field></div></div>
        <fieldset className="mb-3"><legend className="form-label">Working days</legend><div className="d-flex gap-3 flex-wrap">{DAYS.map(([n, l]) => <div key={n} className="form-check"><input className="form-check-input" type="checkbox" id={`wd-${n}`} checked={f.workDays.includes(n)} onChange={() => setF({ ...f, workDays: f.workDays.includes(n) ? f.workDays.filter((x) => x !== n) : [...f.workDays, n].sort() })} /><label className="form-check-label" htmlFor={`wd-${n}`}>{l}</label></div>)}</div></fieldset>
        <div className="row"><div className="col-4"><Field label="Day starts">{(id) => <input id={id} type="time" className="form-control" value={f.dayStart} onChange={(e) => setF({ ...f, dayStart: e.target.value })} />}</Field></div>
          <div className="col-4"><Field label="Day ends">{(id) => <input id={id} type="time" className="form-control" value={f.dayEnd} onChange={(e) => setF({ ...f, dayEnd: e.target.value })} />}</Field></div>
          <div className="col-4 d-flex align-items-center"><div className="form-check"><input className="form-check-input" type="checkbox" id="isd" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /><label className="form-check-label" htmlFor="isd">Organization default</label></div></div></div>
        <h3 className="h-section">Holidays</h3>
        {f.holidays.map((h, i) => <div key={i} className="d-flex gap-2 mb-2"><input type="date" className="form-control" aria-label="Holiday date" value={h.date} onChange={(e) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
          <input className="form-control" aria-label="Holiday name" placeholder="Name" value={h.name} onChange={(e) => setF({ ...f, holidays: f.holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <button className="btn btn-ghost btn-icon" aria-label="Remove holiday" onClick={() => setF({ ...f, holidays: f.holidays.filter((_, j) => j !== i) })}><Trash2 size={14} /></button></div>)}
        <button className="btn btn-sm btn-light" onClick={() => setF({ ...f, holidays: [...f.holidays, { date: '', name: '' }] })}><Plus size={13} /> Add holiday</button>
      </Modal>}
    </>
  );
}

export function AdminTemplates() {
  const { data, error, loading, reload } = useLoad(() => get('/org/templates'), []);
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const toast = useToast();
  const save = async () => { setErr(null); const body = { name: f.name, description: f.description || null, isDefault: f.isDefault, phases: f.phases.map((p) => ({ name: p.name, durationDays: Number(p.durationDays), completionCriteria: p.completionCriteria || null, milestones: p.milestones.filter(Boolean), deliverables: p.deliverables.filter(Boolean) })) };
    try { f.id ? await patch(`/org/templates/${f.id}`, body) : await post('/org/templates', body); setF(null); reload(); toast('Template saved', 'success'); } catch (e) { setErr(e); } };
  const move = (i, d) => { const ps = [...f.phases]; [ps[i], ps[i + d]] = [ps[i + d], ps[i]]; setF({ ...f, phases: ps }); };
  const setP = (i, k, v) => setF({ ...f, phases: f.phases.map((p, j) => (j === i ? { ...p, [k]: v } : p)) });
  return (
    <>
      <PageHeader title="Project plans" sub="Ready-made phases and milestones that new projects start with." actions={<button className="btn btn-primary" onClick={() => setF({ name: '', description: '', isDefault: false, phases: [{ name: 'Phase 1', durationDays: 5, completionCriteria: '', milestones: [], deliverables: [] }] })}><Plus size={15} /> New plan</button>} />
      <ErrorBox error={error} />
      {loading && !data ? <Loading /> : <div className="row g-3">{data.data.map((t) => <div className="col-lg-6" key={t.id}><Card title={<>{t.name} {t.isDefault && <Pill tone="blue">Default</Pill>}</>} actions={<button className="btn btn-sm btn-light" onClick={() => setF({ ...t, phases: t.phases.map((p) => ({ ...p })) })}>Edit</button>}>
        <p className="small text-muted">{t.description}</p><ol className="small mb-0 ps-3">{t.phases.map((p) => <li key={p.id}>{p.name} <span className="text-muted">· {p.durationDays}d{p.milestones.length ? ` · ◆ ${p.milestones.join(', ')}` : ''}</span></li>)}</ol></Card></div>)}</div>}
      {f && <Modal open size="lg" onClose={() => setF(null)} title={f.id ? 'Edit template' : 'New plan'} footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.name || !f.phases.length}><Save size={14} /> Save</button></>}>
        <ErrorBox error={err} />
        <div className="row"><div className="col-md-8"><Field label="Name">{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
          <div className="col-md-4 d-flex align-items-center"><div className="form-check"><input className="form-check-input" type="checkbox" id="tdef" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked })} /><label className="form-check-label" htmlFor="tdef">Default template</label></div></div></div>
        <Field label="Description">{(id) => <input id={id} className="form-control" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <h3 className="h-section">Phases</h3>
        {f.phases.map((p, i) => <div key={i} className="border rounded p-2 mb-2"><div className="d-flex gap-2 align-items-end">
          <Field label={`Phase ${i + 1}`} className="mb-2 flex-grow-1">{(id) => <input id={id} className="form-control form-control-sm" value={p.name} onChange={(e) => setP(i, 'name', e.target.value)} />}</Field>
          <Field label="Relative days" className="mb-2" >{(id) => <input id={id} type="number" min="1" className="form-control form-control-sm" style={{ width: 90 }} value={p.durationDays} onChange={(e) => setP(i, 'durationDays', e.target.value)} />}</Field>
          <div className="btn-group btn-group-sm mb-2"><button className="btn btn-light" disabled={!i} onClick={() => move(i, -1)} aria-label="Move up">↑</button><button className="btn btn-light" disabled={i === f.phases.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button><button className="btn btn-light" onClick={() => setF({ ...f, phases: f.phases.filter((_, j) => j !== i) })} aria-label="Remove phase"><Trash2 size={13} /></button></div></div>
          <div className="row"><div className="col-md-6"><Field label="Milestones" hint="Comma-separated" className="mb-1">{(id) => <input id={id} className="form-control form-control-sm" value={p.milestones.join(', ')} onChange={(e) => setP(i, 'milestones', e.target.value.split(',').map((s) => s.trimStart()))} />}</Field></div>
            <div className="col-md-6"><Field label="Deliverables" hint="Comma-separated" className="mb-1">{(id) => <input id={id} className="form-control form-control-sm" value={p.deliverables.join(', ')} onChange={(e) => setP(i, 'deliverables', e.target.value.split(',').map((s) => s.trimStart()))} />}</Field></div></div>
          <Field label="Completion criteria" className="mb-0">{(id) => <input id={id} className="form-control form-control-sm" value={p.completionCriteria || ''} onChange={(e) => setP(i, 'completionCriteria', e.target.value)} />}</Field></div>)}
        <button className="btn btn-sm btn-light" onClick={() => setF({ ...f, phases: [...f.phases, { name: '', durationDays: 5, completionCriteria: '', milestones: [], deliverables: [] }] })}><Plus size={13} /> Add phase</button>
        <div className="form-text mt-2">Changes apply to new projects only; existing projects keep their phases.</div>
      </Modal>}
    </>
  );
}

export function AdminTicketSettings() {
  const { data, error, loading, reload } = useLoad(() => Promise.all([get('/org/ticket-settings'), get('/org/calendars')]), []);
  const [f, setF] = useState(null);
  const toast = useToast();
  if (loading && !data) return <Loading />;
  const [settings, cals] = data ? [data[0], data[1].data] : [null, []];
  const v = f || (settings && { categories: settings.categories.join('\n'), sla: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => settings.sla.find((s) => s.priority === p) || { priority: p, responseMinutes: 240, resolutionMinutes: 960, calendarId: null }) });
  const save = async () => { try { await put('/org/ticket-settings', { categories: v.categories.split('\n').map((s) => s.trim()).filter(Boolean), sla: v.sla.map((s) => ({ priority: s.priority, responseMinutes: Number(s.responseMinutes), resolutionMinutes: Number(s.resolutionMinutes), calendarId: s.calendarId || null })) }); setF(null); reload(); toast('Request settings saved', 'success'); } catch (e) { toast(e.message, 'error'); } };
  const setS = (i, k, val) => setF({ ...v, sla: v.sla.map((s, j) => (j === i ? { ...s, [k]: val } : s)) });
  return (
    <>
      <PageHeader title="Requests" sub="Request categories and how fast your team aims to reply, in working minutes." actions={<button className="btn btn-primary" onClick={save}><Save size={14} /> Save</button>} />
      <ErrorBox error={error} />
      {v && <div className="row g-3"><div className="col-lg-8"><Card title="Response time targets" bodyClass="p-0"><table className="table"><thead><tr><th>Priority</th><th>First response (min)</th><th>Resolution (min)</th><th>Working hours from</th></tr></thead>
        <tbody>{v.sla.map((s, i) => <tr key={s.priority}><td className="fw-medium">{labelize(s.priority)}</td><td><input aria-label={`${s.priority} response minutes`} type="number" min="5" className="form-control form-control-sm" value={s.responseMinutes} onChange={(e) => setS(i, 'responseMinutes', e.target.value)} /><div className="form-text">{(s.responseMinutes / 60).toFixed(1)} business h</div></td>
          <td><input aria-label={`${s.priority} resolution minutes`} type="number" min="5" className="form-control form-control-sm" value={s.resolutionMinutes} onChange={(e) => setS(i, 'resolutionMinutes', e.target.value)} /><div className="form-text">{(s.resolutionMinutes / 60).toFixed(1)} business h</div></td>
          <td><Select aria-label={`${s.priority} calendar`} value={s.calendarId} onChange={(val) => setS(i, 'calendarId', val)} placeholder="Organization default" options={cals.map((c) => ({ value: c.id, label: c.name }))} /></td></tr>)}</tbody></table>
        <div className="p-3 small text-muted">Pause rules: both clocks pause while a request is “Waiting on client”; time spent resolved before a reopen is excluded. Changes apply to new requests and to requests whose priority changes.</div></Card></div>
        <div className="col-lg-4"><Card title="Categories"><Field label="One per line">{(id) => <textarea id={id} rows={8} className="form-control" value={v.categories} onChange={(e) => setF({ ...v, categories: e.target.value })} />}</Field></Card></div></div>}
    </>
  );
}

export function AdminAudit() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data, error, loading } = useLoad(() => get('/org/audit', { q: dq || undefined, page, pageSize: 50 }), [dq, page]);
  return (
    <>
      <PageHeader title="Activity log" sub="A record of important changes in your workspace." />
      <div className="filters"><input className="form-control form-control-sm" style={{ maxWidth: 280 }} placeholder="Filter by action, e.g. invitation" aria-label="Filter actions" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      <ErrorBox error={error} />
      <div className="card">{loading && !data ? <div className="p-3"><Loading /></div> : <table className="table table-sm"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>{data?.data.map((e) => <tr key={e.id}><td className="small text-nowrap">{fmtDateTime(e.createdAt)}</td><td className="small">{e.actorName || 'System'}</td><td className="mono">{e.action}</td><td className="small">{e.entityType}</td>
          <td className="small text-muted"><code className="small" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(e.metadata).slice(0, 160)}</code></td></tr>)}</tbody></table>}
        <Pagination meta={data?.meta} onPage={setPage} /></div>
    </>
  );
}
