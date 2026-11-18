import { useEffect, useRef, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { post } from '../../api/client.js';
import { fmtDate } from '../../lib/format.js';
import { emitLocal } from '../../lib/live.js';
import { Modal, useToast } from '../../components/ui.jsx';

/** A complete, real date the server will accept (the browser reports half-typed dates such as 0002-12-04). */
export function isCompleteDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const y = Number(v.slice(0, 4)); if (y < 2000 || y > 2100) return false;
  const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Changing planned dates, everywhere in the app: one request that applies the project's date rules
 * (moving the start keeps the length; the due date can't be before the start) and asks before moving
 * tasks that depend on this one. Returns { change(item, changes), dialog }.
 */
export function useDateChange({ project, onChanged }) {
  const toast = useToast();
  const [ask, setAsk] = useState(null); // { item, changes, res, resolve }
  const [busy, setBusy] = useState(false);
  const done = (r, item) => {
    const parts = [];
    if (r.adjusted) parts.push(`Due date moved to ${fmtDate(r.adjusted.finish)} to keep the task's ${r.adjusted.days} ${r.adjusted.unit === 'working' ? 'working ' : ''}day${r.adjusted.days === 1 ? '' : 's'}`);
    if (r.moved?.length) parts.push(`${r.moved.length} dependent task${r.moved.length === 1 ? '' : 's'} moved`);
    toast(parts.length ? `${item.title}: ${parts.join(' · ')}` : `${item.title}: dates saved`, 'success');
    if (r.dependentsStartingTooEarly) toast(`${r.dependentsStartingTooEarly} dependent task(s) now start before ${item.title} finishes — see the Gantt chart.`, 'error');
    emitLocal({ type: 'work.changed', projectId: project.id });
    onChanged?.(r.item);
  };
  const send = async (item, changes, extra = {}) => post(`/projects/${project.id}/work-items/${item.id}/dates`, { ...changes, version: item.version, ...extra });
  const change = async (item, changes) => {
    for (const [k, v] of Object.entries(changes)) if (v != null && !isCompleteDate(v)) { toast('Please enter a complete date (day, month and year).', 'error'); return false; }
    try {
      const r = await send(item, changes);
      if (r.applied) { done(r, item); return true; }
      return await new Promise((resolve) => setAsk({ item, changes, res: r, resolve }));
    } catch (e) {
      toast(e.status === 409 ? 'This task was just changed by someone else — showing the latest version.' : e.message, 'error');
      onChanged?.(null);
      return false;
    }
  };
  const decide = async (moveDependents) => {
    const { item, changes, res, resolve } = ask;
    if (moveDependents === null) { setAsk(null); onChanged?.(null); resolve(false); return; }
    setBusy(true);
    try {
      const r = await send(item, changes, { moveDependents, ...(moveDependents && { expectedMoves: res.moves.map((m) => ({ id: m.id, start: m.to.start, finish: m.to.finish })) }) });
      setAsk(null); done(r, item); resolve(true);
    } catch (e) { toast(e.status === 409 ? 'The plan changed meanwhile — please try again.' : e.message, 'error'); setAsk(null); onChanged?.(null); resolve(false); }
    finally { setBusy(false); }
  };
  const dialog = ask && (
    <Modal open size="lg" onClose={() => decide(null)} title={<span className="d-inline-flex align-items-center gap-2"><CalendarClock size={18} /> Move the tasks that depend on “{ask.item.title}”?</span>}
      footer={<><button className="btn btn-light" disabled={busy} onClick={() => decide(null)}>Cancel</button>
        <button className="btn btn-outline-secondary" disabled={busy} onClick={() => decide(false)}>Only change this task</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>{busy ? 'Saving…' : `Move ${ask.res.moves.length} task${ask.res.moves.length === 1 ? '' : 's'} too`}</button></>}>
      <p className="mb-2">New dates for <b>{ask.item.title}</b>: <b>{fmtDate(ask.res.start)}</b>{ask.res.finish !== ask.res.start ? <> → <b>{fmtDate(ask.res.finish)}</b></> : null}.
        {ask.res.adjusted && <> The due date moves with the start to keep the task's {ask.res.adjusted.days} working days.</>}</p>
      <p className="small text-muted">These tasks can only start after it finishes, so they would start too early. Moving them keeps each task's length.</p>
      <table className="table table-sm"><thead><tr><th>Task</th><th>Now</th><th>Would move to</th></tr></thead>
        <tbody>{ask.res.moves.map((m) => <tr key={m.id}><td>{project.code}-{m.number} {m.title}</td><td className="text-nowrap">{fmtDate(m.from.start)} → {fmtDate(m.from.finish)}</td><td className="text-nowrap fw-semibold">{fmtDate(m.to.start)} → {fmtDate(m.to.finish)}</td></tr>)}</tbody></table>
    </Modal>
  );
  return { change, dialog };
}

/**
 * Date input for tables. Typing never saves half a date: a keyboard-entered date is saved when you press
 * Enter or Tab or leave the field; a date picked from the calendar pop-up is saved straight away.
 * Escape cancels. Only complete dates that differ from the current one are sent.
 */
export function DateCell({ value, onCommit, disabled, className = '', label, min }) {
  const [draft, setDraft] = useState(value || '');
  const [bad, setBad] = useState(false);
  const [saving, setSaving] = useState(false);
  const focused = useRef(false);
  const incomplete = useRef(false); // the browser reports a half-typed date as "" — never treat that as "clear the date"
  const lastKey = useRef(0);
  const sent = useRef(null);
  useEffect(() => { if (!focused.current) { setDraft(value || ''); setBad(false); } }, [value]);
  const flashBad = () => { setBad(true); setDraft(value || ''); setTimeout(() => setBad(false), 1800); };
  const commit = async (v = draft) => {
    if (incomplete.current) { incomplete.current = false; flashBad(); return; }
    if ((v || '') === (value || '') || sent.current === v) return;
    if (v && !isCompleteDate(v)) { flashBad(); return; }
    sent.current = v; setSaving(true);
    const ok = await onCommit(v || null);
    setSaving(false); sent.current = null;
    if (!ok) setDraft(value || '');
  };
  const pending = !saving && (draft || '') !== (value || '');
  return (
    <input type="date" className={`cell-input ${className} ${bad ? 'bad' : ''} ${pending ? 'pending' : ''}`} value={draft} min={min} disabled={disabled || saving} aria-label={label}
      title={bad ? 'Enter a complete date' : pending ? 'Press Enter to save' : undefined}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        incomplete.current = Boolean(e.target.validity?.badInput);
        if (incomplete.current) return;
        setDraft(e.target.value);
        // No key pressed just now → the date came from the calendar pop-up: save it.
        if (Date.now() - lastKey.current > 400 && isCompleteDate(e.target.value)) commit(e.target.value);
      }}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => {
        lastKey.current = Date.now();
        if (e.key === 'Enter' || e.key === 'Tab') commit();
        if (e.key === 'Escape') { setDraft(value || ''); incomplete.current = false; e.currentTarget.blur(); }
      }} />
  );
}
