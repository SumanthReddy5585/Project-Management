import { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { post } from '../../api/client.js';
import { ErrorBox, Modal, Notice, useToast } from '../../components/ui.jsx';

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

const ALIASES = {
  title: ['title', 'task', 'task name', 'name', 'summary', 'subject'], type: ['type', 'item type', 'kind'], phase: ['phase', 'stage', 'sprint'],
  parent: ['parent', 'parent task', 'module', 'epic', 'under'], assignee: ['assignee', 'assigned to', 'owner', 'resource', 'resource names'],
  start: ['start', 'start date', 'planned start', 'begin'], due: ['due', 'due date', 'finish', 'end', 'end date', 'planned finish', 'deadline'],
  estimate: ['estimate', 'estimate hours', 'hours', 'effort', 'work', 'estimated hours'], priority: ['priority'], status: ['status', 'state'], description: ['description', 'notes', 'details'],
};
const TEMPLATE = 'Title,Type,Phase,Parent,Assignee,Start,Due,Estimate,Priority,Status,Description\n'
  + 'Payments module,Module,Build,,,,,,,,Everything for card + wallet payments\n'
  + 'Card payment API,Task,Build,Payments module,dev@example.com,2026-12-01,2026-12-05,24,High,To do,Stripe-compatible endpoints\n'
  + 'Unit tests for card API,Subtask,Build,Card payment API,,2026-12-04,2026-12-05,6,Medium,,\n'
  + 'Payments ready for UAT,Milestone,Build,,,,2026-12-08,,,,\n';

function mapRows(table) {
  const [head, ...body] = table;
  const cols = head.map((h) => { const k = h.trim().toLowerCase(); return Object.entries(ALIASES).find(([, a]) => a.includes(k))?.[0] || null; });
  return { cols, head, rows: body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()]).filter(([c, v]) => c && v !== ''))) };
}

export function ImportTasksDialog({ project, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [mapped, setMapped] = useState(null);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const load = async (f) => {
    setErr(null); setPreview(null); setFile(f);
    try {
      const text = await f.text();
      const table = parseCsv(text);
      if (table.length < 2) throw new Error('The file needs a header row and at least one task.');
      const m = mapRows(table);
      if (!m.cols.includes('title')) throw new Error('Could not find a "Title" column. Download the template to see the expected columns.');
      setMapped(m);
      setBusy(true);
      setPreview(await post(`/projects/${project.id}/work-items/import`, { rows: m.rows.slice(0, 1000), dryRun: true }));
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true); setErr(null);
    try { const r = await post(`/projects/${project.id}/work-items/import`, { rows: mapped.rows.slice(0, 1000), dryRun: false }); toast(`Imported ${r.created} task(s)`, 'success'); onDone?.(); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const tmpl = () => { const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })), download: 'task-import-template.csv' }); a.click(); };
  const S = preview?.summary;
  return (
    <Modal open size="xl" onClose={onClose} title="Import tasks from CSV / Excel"
      footer={<><button className="btn btn-light" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!S?.valid || busy} onClick={run}>{busy ? 'Working…' : S ? `Import ${S.valid} task(s)` : 'Import'}</button></>}>
      <ErrorBox error={err} />
      {!preview && <>
        <label className={`import-drop d-block ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) load(f); }}>
          <FileSpreadsheet size={30} className="text-primary mb-2" />
          <div className="fw-semibold">Drop a .csv file here, or click to choose</div>
          <div className="small text-muted">From Excel: File → Save As → CSV UTF-8. MS Project / Smartsheet / Jira exports with Name, Start, Finish and Resource columns work too.</div>
          <input type="file" accept=".csv,text/csv" className="d-none" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} aria-label="Choose CSV file" />
        </label>
        {busy && <div className="small text-muted mt-2">Checking {file?.name}…</div>}
        <div className="d-flex align-items-center gap-2 mt-3 small"><button className="btn btn-sm btn-light" onClick={tmpl}><Upload size={14} /> Download template</button>
          <span className="text-muted">Columns: Title (required), Type, Phase, Parent, Assignee (email or name), Start, Due, Estimate (hours), Priority, Status, Description.</span></div>
      </>}
      {preview && <>
        <div className="d-flex gap-2 align-items-center mb-2 flex-wrap">
          <strong>{file?.name}</strong><span className="text-muted small">· {S.total} rows</span>
          <span className="pill pill-ok"><CheckCircle2 size={12} /> {S.valid} ready</span>
          {S.invalid > 0 && <span className="pill pill-risk"><XCircle size={12} /> {S.invalid} with errors (skipped)</span>}
          {S.warnings > 0 && <span className="pill pill-warn"><AlertTriangle size={12} /> {S.warnings} warning(s)</span>}
          <button className="btn btn-sm btn-link ms-auto" onClick={() => { setPreview(null); setMapped(null); setFile(null); }}>Choose another file</button>
        </div>
        <div className="small text-muted mb-2">Recognised columns: {mapped.head.map((h, i) => <span key={i} className={`pill me-1 ${mapped.cols[i] ? 'pill-outline' : 'pill-neutral text-decoration-line-through'}`} title={mapped.cols[i] ? `→ ${mapped.cols[i]}` : 'Ignored'}>{h || '(blank)'}</span>)}</div>
        {S.invalid > 0 && <Notice tone="warn">Rows with errors won't be imported. Fix them in the file and choose it again, or import the valid rows now.</Notice>}
        <div className="table-wrap" style={{ maxHeight: 380 }}><table className="table table-sm import-table">
          <thead><tr><th>Row</th><th>Title</th><th>Type</th><th>Phase / parent</th><th>Assignee</th><th>Dates</th><th className="text-end">Est.</th><th>Checks</th></tr></thead>
          <tbody>{preview.rows.map((r) => <tr key={r.row} className={r.errors.length ? 'table-danger' : ''}>
            <td className="text-muted">{r.row}</td><td className="fw-medium">{r.title || <em className="text-muted">missing</em>}</td><td>{r.type?.toLowerCase() || '—'}</td>
            <td className="small">{r.parentRef ? <>under <b>{r.parentRef.title}</b></> : r.phaseName || '—'}</td><td className="small">{r.assigneeName || '—'}</td>
            <td className="small text-nowrap">{r.plannedStart || '—'}{r.type !== 'MILESTONE' ? ` → ${r.plannedFinish || '—'}` : ''}</td><td className="text-end">{r.estimateHours ?? '—'}</td>
            <td className="small">{r.errors.map((e) => <div key={e} className="text-danger">✕ {e}</div>)}{r.warnings.map((w) => <div key={w} className="text-warning-emphasis">! {w}</div>)}{!r.errors.length && !r.warnings.length && <span className="text-success">OK</span>}</td></tr>)}</tbody>
        </table></div>
      </>}
    </Modal>
  );
}
