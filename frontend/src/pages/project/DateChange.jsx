import { useEffect, useRef, useState } from 'react';
import { post } from '../../api/client.js';
import { fmtDate } from '../../lib/format.js';
import { emitLocal } from '../../lib/live.js';
import { useToast } from '../../components/ui.jsx';

/** A complete, real date the server will accept (the browser reports half-typed dates such as 0002-12-04). */
export function isCompleteDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
  const y = Number(v.slice(0, 4)); if (y < 2000 || y > 2100) return false;
  const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** One line that says what the scheduler did after a change ("3 tasks that wait for it moved: …"). */
export function movedText(moved = [], code) {
  if (!moved?.length) return '';
  const later = moved.filter((m) => (m.to.start || '') > (m.from.start || '')).length;
  const dir = later === moved.length ? 'later' : later === 0 ? 'earlier' : '';
  const list = moved.slice(0, 3).map((m) => `${code ? `${code}-` : '#'}${m.number} ${m.title} → ${fmtDate(m.to.start)}`).join(', ');
  return `${moved.length} task${moved.length === 1 ? '' : 's'} that wait${moved.length === 1 ? 's' : ''} for it moved${dir ? ` ${dir}` : ''}: ${list}${moved.length > 3 ? ` and ${moved.length - 3} more` : ''}`;
}

/**
 * Changing planned dates, everywhere in the app: one request that applies the project's date rules
 * (moving the start keeps the length; the due date can't be before the start). The server then
 * recalculates the plan, so every task that waits for this one moves with it. Returns { change(item, changes, extra), dialog }.
 */
export function useDateChange({ project, onChanged }) {
  const toast = useToast();
  const change = async (item, changes, extra = {}) => {
    for (const v of Object.values(changes)) if (v != null && !isCompleteDate(v)) { toast('Please enter a complete date (day, month and year).', 'error'); return false; }
    try {
      const r = await post(`/projects/${project.id}/work-items/${item.id}/dates`, { ...changes, version: item.version, ...extra });
      const parts = [];
      if (r.heldBy) parts.push(`starts ${fmtDate(r.start)} — it waits for ${project.code}-${r.heldBy.number} ${r.heldBy.title}, which ends ${fmtDate(r.heldBy.finish)}`);
      else if (r.adjusted) parts.push(`due date moved to ${fmtDate(r.adjusted.finish)} to keep its ${r.adjusted.days} working day${r.adjusted.days === 1 ? '' : 's'}`);
      const mv = movedText(r.moved, project.code);
      if (mv) parts.push(mv);
      toast(parts.length ? `${item.title}: ${parts.join(' · ')}` : `${item.title}: dates saved`, r.heldBy ? 'info' : 'success');
      if (r.rescheduled?.cycle) toast(r.rescheduled.cycle, 'error');
      emitLocal({ type: 'work.changed', projectId: project.id });
      onChanged?.(r.item);
      return true;
    } catch (e) {
      toast(e.status === 409 ? 'This task was just changed by someone else — showing the latest version.' : e.message, 'error');
      onChanged?.(null);
      return false;
    }
  };
  return { change, dialog: null };
}

/**
 * Date input for tables. Typing never saves half a date: a keyboard-entered date is saved when you press
 * Enter or Tab or leave the field; a date picked from the calendar pop-up is saved straight away.
 * Escape cancels. Only complete dates that differ from the current one are sent.
 */
export function DateCell({ value, onCommit, disabled, className = '', label, min, max }) {
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
    if (v && max && v > max) { flashBad(); return; }
    sent.current = v; setSaving(true);
    const ok = await onCommit(v || null);
    setSaving(false); sent.current = null;
    if (!ok) setDraft(value || '');
  };
  const pending = !saving && (draft || '') !== (value || '');
  return (
    <input type="date" className={`cell-input ${className} ${bad ? 'bad' : ''} ${pending ? 'pending' : ''}`} value={draft} min={min} max={max} disabled={disabled || saving} aria-label={label}
      title={bad ? (max ? `Use a date up to ${max}` : 'Enter a complete date') : pending ? 'Press Enter to save' : undefined}
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
