// Shared labels/colours for "working plan vs original plan" (see backend src/domain/variance.js).
import { Pill } from '../components/ui.jsx';

export const SCHEDULE = {
  ON_TRACK: ['On track', 'ok'], AHEAD: ['Ahead', 'blue'], AT_RISK: ['At risk', 'warn'], DELAYED: ['Delayed', 'risk'], COMPLETED: ['Completed', 'ok'],
};
export const TASK_VAR = {
  OVERDUE: ['Overdue', 'risk', 'Not finished and the original due date has passed'],
  DELAYED: ['Delayed', 'warn', 'Now planned to finish later than the original plan'],
  DONE_LATE: ['Done late', 'warn', 'Finished after the original due date'],
  ON_TRACK: ['On track', 'ok', 'Same finish date as the original plan'],
  AHEAD: ['Ahead', 'blue', 'Now planned to finish earlier than the original'],
  DONE_ON_TIME: ['Done on time', 'ok', 'Finished on or before the original due date'],
  NOT_SCHEDULED: ['No dates', 'neutral', 'Has no start/due date, so it cannot be compared'],
  ADDED: ['Added', 'dark', 'Not in the original plan — scope added later'],
  REMOVED: ['Removed', 'outline', 'In the original plan but deleted or cancelled since'],
};

export function ScheduleChip({ status, title }) {
  if (!status) return null;
  const [label, tone] = SCHEDULE[status] || [status, 'neutral'];
  return <Pill tone={tone} title={title || 'Compared with the original (approved) plan'}>{label}</Pill>;
}

export function TaskVarChip({ status }) {
  const [label, tone, hint] = TASK_VAR[status] || [status, 'neutral', ''];
  return <Pill tone={tone} title={hint}>{label}</Pill>;
}

/** "+3d" in red / "-2d" in green / "0d". Working days. */
export function DaysVar({ days, className = '' }) {
  if (days == null) return <span className={`text-muted ${className}`}>—</span>;
  if (days === 0) return <span className={`text-success fw-semibold ${className}`}>0d</span>;
  return <span className={`fw-semibold ${days > 0 ? 'text-danger' : 'text-primary'} ${className}`} title={`${Math.abs(days)} working day(s) ${days > 0 ? 'later' : 'earlier'} than the original plan`}>{days > 0 ? '+' : '−'}{Math.abs(days)}d</span>;
}

export function scheduleSentence(s, fmtDate) {
  if (!s) return '';
  if (s.status === 'COMPLETED') return `All work finished. Original finish ${fmtDate(s.originalFinish)}, actual ${fmtDate(s.forecastFinish)}.`;
  const v = s.finishVariance;
  const when = v == null ? '' : v === 0 ? 'the same as the original plan' : `${Math.abs(v)} working day${Math.abs(v) === 1 ? '' : 's'} ${v > 0 ? 'later' : 'earlier'} than the original ${fmtDate(s.originalFinish)}`;
  return `Forecast finish ${fmtDate(s.forecastFinish)} — ${when}.`;
}
