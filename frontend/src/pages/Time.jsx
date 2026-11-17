import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Trash2, Send, Lock, Check, X } from 'lucide-react';
import { get, post, patch, del, download } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { addDaysISO, fmtDate, fmtHours, mondayOf, todayISO, fmtRelative } from '../lib/format.js';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Select, StatusBadge, useToast, ConfirmButton } from '../components/ui.jsx';

export function Timesheet() {
  const [params, setParams] = useSearchParams();
  const week = mondayOf(params.get('week') || todayISO());
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get('/time/week', { weekStart: week }), [week]);
  const [f, setF] = useState(null);
  const locked = data && ['SUBMITTED', 'APPROVED'].includes(data.timesheet.status);
  const go = (n) => setParams({ week: addDaysISO(week, n * 7) });
  const projectName = (id) => data?.projects.find((p) => p.id === id);
  const itemName = (id) => data?.workItems.find((w) => w.id === id);
  const total = (data?.entries || []).reduce((a, e) => a + e.hours, 0);
  const save = async () => {
    try {
      const body = { projectId: f.projectId, workItemId: f.workItemId || null, date: f.date, hours: Number(f.hours), billable: f.billable, note: f.note || null };
      f.id ? await patch(`/time/entries/${f.id}`, body) : await post('/time/entries', body);
      setF(null); reload(); toast('Time saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };
  const submit = async () => { try { await post(`/time/timesheets/${data.timesheet.id}/submit`, { version: data.timesheet.version }); toast('Timesheet submitted for approval', 'success'); reload(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <>
      <PageHeader title="Your week" sub="Add the hours you worked, then submit the week."
        actions={<><button className="btn btn-light" onClick={() => download(`/reports/time.csv?from=${week}&to=${addDaysISO(week, 6)}`, `time-${week}.csv`)}>Export week</button></>} />
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <button className="btn btn-sm btn-light" onClick={() => go(-1)} aria-label="Previous week"><ChevronLeft size={15} /></button>
        <strong style={{ minWidth: 220, textAlign: 'center' }}>{fmtDate(week)} – {fmtDate(addDaysISO(week, 6))}</strong>
        <button className="btn btn-sm btn-light" onClick={() => go(1)} aria-label="Next week"><ChevronRight size={15} /></button>
        <button className="btn btn-sm btn-link" onClick={() => setParams({})}>This week</button>
        {data && <><StatusBadge status={data.timesheet.status} /><span className="fw-semibold ms-2">{fmtHours(total)}</span></>}
        <div className="ms-auto d-flex gap-2">
          {!locked && data?.projects.length > 0 && <button className="btn btn-sm btn-outline-primary" onClick={() => setF({ projectId: data.projects[0].id, workItemId: '', date: week <= todayISO() && todayISO() <= addDaysISO(week, 6) ? todayISO() : week, hours: 1, billable: false, note: '' })}><Plus size={14} /> Add hours</button>}
          {!locked && data?.entries.length > 0 && <ConfirmButton className="btn btn-sm btn-primary" tone="primary" title="Submit timesheet?" message="Entries for this week will be locked until a manager approves or rejects them." confirmLabel="Submit" onConfirm={submit}><Send size={14} /> Submit for approval</ConfirmButton>}
        </div>
      </div>
      <ErrorBox error={error} />
      {data?.timesheet.status === 'REJECTED' && <Notice tone="warn">Rejected by {data.timesheet.reviewerName}: {data.timesheet.reviewNote}. Fix the entries and submit again.</Notice>}
      {data?.timesheet.status === 'APPROVED' && <Notice icon={Lock}>Approved by {data.timesheet.reviewerName} {fmtRelative(data.timesheet.reviewedAt)}. This week is locked.</Notice>}
      {data?.timesheet.status === 'SUBMITTED' && <Notice icon={Lock}>Submitted {fmtRelative(data.timesheet.submittedAt)} — awaiting approval.</Notice>}
      {loading && !data ? <Loading /> : data && (data.projects.length === 0 ? <div className="card"><Empty title="No projects to log time on">You can log time on active projects where you are a member or manager.</Empty></div> : (
        <div className="card mt-2"><div className="table-wrap"><table className="table">
          <thead><tr><th>Day</th><th>Project / task</th><th>Note</th><th className="text-end">Hours</th><th>Billable</th><th /></tr></thead>
          <tbody>{data.days.map((d) => {
            const es = data.entries.filter((e) => e.date === d);
            const dayTotal = es.reduce((a, e) => a + e.hours, 0);
            return [<tr key={d} className="table-light"><td colSpan={3} className="fw-semibold small">{new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</td><td className="text-end small fw-semibold">{dayTotal ? fmtHours(dayTotal) : ''}</td><td colSpan={2} /></tr>,
              ...es.map((e) => <tr key={e.id}><td /><td><span className="mono">{projectName(e.projectId)?.code}</span> {itemName(e.workItemId) ? `· ${itemName(e.workItemId).title}` : <span className="text-muted">· general</span>}</td><td className="small text-muted">{e.note}</td><td className="text-end">{e.hours}</td><td>{e.billable ? 'Yes' : ''}</td>
                <td className="text-end text-nowrap">{!locked && <><button className="btn btn-sm btn-ghost" onClick={() => setF({ ...e, workItemId: e.workItemId || '' })}>Edit</button><ConfirmButton className="btn btn-sm btn-ghost btn-icon text-danger" title="Delete entry?" confirmLabel="Delete" onConfirm={async () => { await del(`/time/entries/${e.id}`); reload(); }}><Trash2 size={14} aria-label="Delete entry" /></ConfirmButton></>}</td></tr>)];
          })}</tbody>
        </table></div></div>))}
      {f && <Modal open onClose={() => setF(null)} title={f.id ? 'Edit time' : 'Log time'} footer={<><button className="btn btn-light" onClick={() => setF(null)}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!f.hours || Number(f.hours) <= 0}>Save</button></>}>
        <Field label="Project">{(id) => <Select id={id} value={f.projectId} onChange={(v) => setF({ ...f, projectId: v, workItemId: '', billable: false })} options={data.projects.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} />}</Field>
        <Field label="Task (optional)" hint="Lists tasks assigned to you or where you collaborate.">{(id) => <Select id={id} value={f.workItemId} onChange={(v) => setF({ ...f, workItemId: v || '' })} placeholder="General project time" options={data.workItems.filter((w) => w.projectId === f.projectId).map((w) => ({ value: w.id, label: `#${w.number} ${w.title}` }))} />}</Field>
        <div className="row"><div className="col-6"><Field label="Date">{(id) => <input id={id} type="date" className="form-control" value={f.date} min={week} max={addDaysISO(week, 6)} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field></div>
          <div className="col-6"><Field label="Hours" hint="Quarter hours, e.g. 1.25">{(id) => <input id={id} type="number" min="0.25" max="24" step="0.25" className="form-control" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />}</Field></div></div>
        <Field label="Note">{(id) => <input id={id} className="form-control" value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        {projectName(f.projectId)?.billingEnabled && <div className="form-check"><input className="form-check-input" type="checkbox" id="bl" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /><label className="form-check-label" htmlFor="bl">Billable</label></div>}
      </Modal>}
    </>
  );
}

export function Approvals() {
  const [status, setStatus] = useState('SUBMITTED');
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => get('/time/approvals', { status }), [status]);
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(null);
  const act = async (s, action, body = {}) => { try { await post(`/time/timesheets/${s.id}/${action}`, { version: s.version, ...body }); toast(`Timesheet ${action === 'approve' ? 'approved' : 'rejected'}`, 'success'); setRejecting(null); setNote(''); reload(); } catch (e) { toast(e.message, 'error'); reload(); } };
  return (
    <>
      <PageHeader title="Timesheets to approve" sub="Weeks your team submitted for projects you manage." />
      <div className="filters"><Select aria-label="Status" value={status} onChange={(v) => setStatus(v || 'SUBMITTED')} options={[{ value: 'SUBMITTED', label: 'Awaiting approval' }, { value: 'APPROVED', label: 'Approved' }, { value: 'REJECTED', label: 'Rejected' }]} /></div>
      <ErrorBox error={error} />
      <div className="card">{loading && !data ? <div className="p-3"><Loading /></div> : data?.data.length === 0 ? <Empty icon={Check} title="Nothing to review" /> : (
        <table className="table"><thead><tr><th>Person</th><th>Week</th><th>Projects</th><th className="text-end">Hours</th><th className="text-end">Billable</th><th /></tr></thead>
          <tbody>{data.data.map((s) => [
            <tr key={s.id}><td className="fw-medium">{s.userName}</td><td>{fmtDate(s.weekStart)}</td><td className="small">{s.projects.map((p) => p.code).join(', ')}</td><td className="text-end">{s.totalHours}</td><td className="text-end">{s.billableHours}</td>
              <td className="text-end text-nowrap"><button className="btn btn-sm btn-ghost" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>{open === s.id ? 'Hide' : 'Entries'}</button>
                {s.canReview && <><button className="btn btn-sm btn-primary ms-1" onClick={() => act(s, 'approve')}><Check size={13} /> Approve</button><button className="btn btn-sm btn-light ms-1" onClick={() => setRejecting(s)}><X size={13} /> Reject</button></>}
                {status === 'SUBMITTED' && !s.canReview && <span className="small text-muted ms-2" title="Includes projects you do not manage">Not yours to review</span>}</td></tr>,
            open === s.id && <tr key={`${s.id}-e`}><td colSpan={6} className="bg-light"><table className="table table-sm mb-0"><tbody>{s.entries.map((e) => <tr key={e.id}><td className="small">{fmtDate(e.date)}</td><td className="small">{s.projects.find((p) => p.id === e.projectId)?.code}</td><td className="small">{e.note}</td><td className="small text-end">{e.hours} h{e.billable ? ' · billable' : ''}</td></tr>)}</tbody></table></td></tr>,
          ])}</tbody></table>)}</div>
      {rejecting && <Modal open onClose={() => setRejecting(null)} title={`Reject ${rejecting.userName}'s timesheet`} footer={<><button className="btn btn-light" onClick={() => setRejecting(null)}>Cancel</button><button className="btn btn-danger" disabled={!note.trim()} onClick={() => act(rejecting, 'reject', { note })}>Reject</button></>}>
        <Field label="What needs to change?">{(id) => <textarea id={id} className="form-control" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Modal>}
    </>
  );
}
