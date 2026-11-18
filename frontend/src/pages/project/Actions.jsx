import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Copy, LayoutTemplate, PauseCircle, PlayCircle, CheckCircle2, Archive, XCircle, Download, Upload, FileText } from 'lucide-react';
import { ImportTasksDialog } from './Import.jsx';
import { emitLocal } from '../../lib/live.js';
import { post, download } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { labelize, todayISO } from '../../lib/format.js';
import { ErrorBox, Field, Modal, useToast, fieldErrors } from '../../components/ui.jsx';
import { codeFrom } from '../Projects.jsx';

const NEXT = { DRAFT: ['ACTIVE', 'CANCELLED'], ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['ACTIVE', 'CANCELLED'], COMPLETED: ['ARCHIVED', 'ACTIVE'], CANCELLED: ['ARCHIVED'], ARCHIVED: [] };
const STATUS_ICON = { ACTIVE: PlayCircle, ON_HOLD: PauseCircle, COMPLETED: CheckCircle2, CANCELLED: XCircle, ARCHIVED: Archive };
const STATUS_VERB = { ACTIVE: 'Start / resume project', ON_HOLD: 'Put on hold', COMPLETED: 'Mark as completed', CANCELLED: 'Cancel project', ARCHIVED: 'Archive' };

/** Project-level actions: duplicate, save as template, lifecycle status, export. */
export function ProjectActions({ project: p, can, reload }) {
  const { can: orgCan } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [f, setF] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const start = (kind) => { setOpen(false); setErr(null); setDialog(kind);
    setF(kind === 'clone' ? { name: `${p.name} (copy)`, code: `${codeFrom(p.name)}2`, plannedStart: todayISO(), includeTeam: true, includeAssignees: false } : kind === 'template' ? { name: `${p.name} plan` } : { status: kind, reason: '' }); };
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      if (dialog === 'clone') { const r = await post(`/projects/${p.id}/clone`, f); toast(`Created ${r.name}`, 'success'); setDialog(null); nav(`/projects/${r.id}`); }
      else if (dialog === 'template') { const r = await post(`/projects/${p.id}/save-as-template`, f); toast(`Template "${r.name}" saved — pick it when creating a project`, 'success'); setDialog(null); }
      else { await post(`/projects/${p.id}/status`, { status: f.status, version: p.version, reason: f.reason || undefined }); toast(`Project is now ${labelize(f.status).toLowerCase()}`, 'success'); setDialog(null); reload(); }
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const statuses = can('project.edit') ? NEXT[p.status] : [];
  const items = [
    ...(orgCan('project.create') ? [['clone', 'Duplicate project', Copy], ['template', 'Save as template', LayoutTemplate]] : []),
    ...statuses.map((s) => [s, STATUS_VERB[s], STATUS_ICON[s]]),
  ];
  const fe = fieldErrors(err);
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn btn-light btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label="Project actions"><MoreHorizontal size={16} /> Actions</button>
      {open && <div className="new-menu" role="menu">
        {items.map(([k, label, Icon]) => <button key={k} role="menuitem" onClick={() => start(k)}><Icon size={16} className={k === 'CANCELLED' ? 'text-danger' : 'text-primary'} /><span>{label}</span></button>)}
        <button role="menuitem" onClick={() => { setOpen(false); nav(`/projects/${p.id}/report`); }}><FileText size={16} className="text-primary" /><span>Status report (print / PDF)</span></button>
        {can('work.editAny') && !p.readOnly && <button role="menuitem" onClick={() => { setOpen(false); setImporting(true); }}><Upload size={16} className="text-primary" /><span>Import tasks (CSV)</span></button>}
        <button role="menuitem" onClick={() => { setOpen(false); download(`/projects/${p.id}/export/work-items.csv`, `${p.code}-tasks.csv`).catch((e) => toast(e.message, 'error')); }}><Download size={16} className="text-primary" /><span>Export tasks (CSV)</span></button>
      </div>}
      {dialog && <Modal open onClose={() => setDialog(null)} title={dialog === 'clone' ? `Duplicate ${p.name}` : dialog === 'template' ? 'Save as template' : STATUS_VERB[dialog]}
        footer={<><button className="btn btn-light" onClick={() => setDialog(null)}>Cancel</button><button className={`btn ${dialog === 'CANCELLED' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={run}>{busy ? 'Working…' : dialog === 'clone' ? 'Create copy' : dialog === 'template' ? 'Save template' : 'Confirm'}</button></>}>
        <ErrorBox error={err} />
        {dialog === 'clone' && <>
          <p className="small text-muted">Copies phases, groups, tasks, subtasks, milestones, checklists and dependencies, moved to the new start date. Comments, files, time and tickets are not copied. The copy starts as a draft.</p>
          <div className="row"><div className="col-8"><Field label="New project name" error={fe.name}>{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
            <div className="col-4"><Field label="Code" error={fe.code}>{(id) => <input id={id} className="form-control text-uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() })} />}</Field></div></div>
          <Field label="Start date">{(id) => <input id={id} type="date" className="form-control" value={f.plannedStart} onChange={(e) => setF({ ...f, plannedStart: e.target.value })} />}</Field>
          <div className="form-check"><input className="form-check-input" type="checkbox" id="cl-team" checked={f.includeTeam} onChange={(e) => setF({ ...f, includeTeam: e.target.checked })} /><label className="form-check-label" htmlFor="cl-team">Keep the same team</label></div>
          <div className="form-check"><input className="form-check-input" type="checkbox" id="cl-as" checked={f.includeAssignees} onChange={(e) => setF({ ...f, includeAssignees: e.target.checked })} /><label className="form-check-label" htmlFor="cl-as">Keep task assignees</label></div>
        </>}
        {dialog === 'template' && <><p className="small text-muted">Saves this project's phases (with their relative lengths), milestones and deliverables as a plan you can pick for new projects.</p>
          <Field label="Template name" error={fe.name}>{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></>}
        {NEXT.ACTIVE.concat('ACTIVE', 'ARCHIVED').includes(dialog) && dialog !== 'clone' && dialog !== 'template' && <>
          <p className="small">{dialog === 'COMPLETED' ? 'All tasks must be done or cancelled first. Time can still be logged afterwards.' : dialog === 'CANCELLED' ? 'The project becomes read-only.' : dialog === 'ARCHIVED' ? 'Archived projects are hidden from lists and read-only.' : dialog === 'ON_HOLD' ? 'The team keeps access; reports show the project as on hold.' : 'The project becomes active for the team.'}</p>
          <Field label="Reason (optional, kept in the activity log)">{(id) => <input id={id} className="form-control" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field></>}
      </Modal>}
      {importing && <ImportTasksDialog project={p} onClose={() => setImporting(false)} onDone={() => { reload(); emitLocal({ type: 'work.changed', projectId: p.id }); nav(`/projects/${p.id}/tasks`); }} />}
    </div>
  );
}
