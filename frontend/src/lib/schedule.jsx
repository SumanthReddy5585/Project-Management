// Plain-language labels for "how is the project doing against its approved (original) plan".
// Backend rules: src/domain/variance.js. Days are working days on the project calendar.
import { Pill } from '../components/ui.jsx';

export const SCHEDULE = {
  ON_TRACK: ['On schedule', 'ok'],
  AHEAD: ['Ahead of schedule', 'blue'],
  AT_RISK: ['At risk', 'warn'],
  DELAYED: ['Running late', 'risk'],
  COMPLETED: ['Finished', 'ok'],
};

export const TASK_VAR = {
  OVERDUE: ['Past due', 'risk', 'Not finished, and the date in the approved plan has passed'],
  DELAYED: ['Will finish late', 'warn', 'Now planned to finish after the date in the approved plan'],
  NOT_SCHEDULED: ['No dates', 'neutral', 'Has no start or due date, so it cannot be compared'],
  ON_TRACK: ['On time', 'ok', 'Planned to finish on the date in the approved plan'],
  AHEAD: ['Early', 'blue', 'Now planned to finish before the date in the approved plan'],
  DONE_ON_TIME: ['Finished on time', 'ok', 'Finished on or before the date in the approved plan'],
  DONE_LATE: ['Finished late', 'warn', 'Finished after the date in the approved plan'],
  ADDED: ['New task', 'dark', 'Added after the plan was approved'],
  REMOVED: ['Removed', 'outline', 'In the approved plan, but deleted or cancelled since'],
};

/** Task groups used on the Plan tab and in Overview. */
export const TASK_GROUPS = [
  ['late', 'Late', ['OVERDUE', 'DELAYED', 'NOT_SCHEDULED'], 'Tasks behind the approved plan. These need action.'],
  ['ontime', 'On time', ['ON_TRACK', 'AHEAD'], 'Open tasks that will finish on or before their planned date.'],
  ['done', 'Finished', ['DONE_ON_TIME', 'DONE_LATE'], 'Completed tasks, and whether they finished on time.'],
  ['changes', 'Plan changes', ['ADDED', 'REMOVED'], 'Tasks added or removed after the plan was approved.'],
];

export function ScheduleChip({ status, title }) {
  if (!status) return null;
  const [label, tone] = SCHEDULE[status] || [status, 'neutral'];
  return <Pill tone={tone} title={title || 'Compared with the approved plan'}>{label}</Pill>;
}

export function TaskVarChip({ status }) {
  const [label, tone, hint] = TASK_VAR[status] || [status, 'neutral', ''];
  return <Pill tone={tone} title={hint}>{label}</Pill>;
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** "15 days late" / "2 days early" / "On time". */
export function diffText(days) {
  if (days == null) return null;
  if (days === 0) return 'On time';
  return days > 0 ? `${plural(days, 'day')} late` : `${plural(-days, 'day')} early`;
}

export function DaysVar({ days, className = '' }) {
  const t = diffText(days);
  if (!t) return <span className={`text-muted ${className}`}>—</span>;
  return <span className={`fw-semibold text-nowrap ${days > 0 ? 'text-danger' : days < 0 ? 'text-primary' : 'text-success'} ${className}`} title="Working days compared with the approved plan">{t}</span>;
}

/** One-line verdict for a project. */
export function verdict(project, s, fmtDate) {
  if (project.status === 'CANCELLED') return { tone: 'neutral', title: 'Cancelled', text: 'This project was cancelled. Its plan and history are kept for reference.' };
  if (!project.planApprovedAt || !s) return { tone: 'neutral', title: 'Plan not approved yet', text: 'Add the tasks with dates and people, then approve the plan. From then on the project is tracked against it.' };
  const v = s.finishVariance;
  if (s.status === 'COMPLETED') {
    return v > 0 ? { tone: 'warn', title: `Finished ${plural(v, 'day')} late`, text: `Finished on ${fmtDate(s.forecastFinish)}; the approved plan said ${fmtDate(s.originalFinish)}.` }
      : { tone: 'ok', title: 'Finished on time', text: `Finished on ${fmtDate(s.forecastFinish)}; the approved plan said ${fmtDate(s.originalFinish)}.` };
  }
  const when = v > 0 ? `Expected to finish on ${fmtDate(s.forecastFinish)}, ${plural(v, 'day')} after the planned ${fmtDate(s.originalFinish)}.`
    : v < 0 ? `Expected to finish on ${fmtDate(s.forecastFinish)}, ${plural(-v, 'day')} before the planned ${fmtDate(s.originalFinish)}.`
      : `Expected to finish on the planned date, ${fmtDate(s.originalFinish)}.`;
  const hold = project.status === 'ON_HOLD' ? 'On hold. ' : '';
  const [label, tone] = SCHEDULE[s.status];
  const why = s.status === 'AT_RISK' && (v ?? 0) <= 0 ? ' Some tasks are behind their planned dates.' : '';
  return { tone: project.status === 'ON_HOLD' ? 'warn' : tone, title: project.status === 'ON_HOLD' ? `On hold · ${label.toLowerCase()}` : label, text: hold + when + why };
}

export function scheduleSentence(s, fmtDate) {
  if (!s) return '';
  return verdict({ status: 'ACTIVE', planApprovedAt: true }, s, fmtDate).text;
}
