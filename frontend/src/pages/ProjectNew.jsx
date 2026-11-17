import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { get, post } from '../api/client.js';
import { useLoad } from '../lib/hooks.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { addDaysISO, fmtDate, todayISO } from '../lib/format.js';
import { Card, ErrorBox, Field, Notice, PageHeader, Select, fieldErrors, useToast } from '../components/ui.jsx';

const STEPS = ['Basics', 'Customer & team', 'Schedule & template', 'Budget & sharing', 'Review'];
const TZ = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();

export default function ProjectNew() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: '', code: '', description: '', objectives: '', customerCompanyId: '', customerContactIds: [], managerId: user.id, teamMemberIds: [],
    plannedStart: todayISO(), plannedFinish: addDaysISO(todayISO(), 90), priority: 'MEDIUM', health: 'GREEN', calendarId: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    templateId: '', budgetAmount: '', budgetCurrency: 'USD', billingEnabled: false, hourlyRate: '', customerVisible: false, status: 'DRAFT',
  });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const ref = useLoad(() => Promise.all([get('/org/customers'), get('/org/members', { pageSize: 200 }), get('/org/calendars'), get('/org/templates')]), []);
  const [customers, members, calendars, templates] = ref.data ? ref.data.map((r) => r.data) : [[], [], [], []];
  const managers = members.filter((m) => ['ADMIN', 'MANAGER'].includes(m.role) && m.status === 'ACTIVE');
  const internal = members.filter((m) => m.role !== 'CUSTOMER' && m.status === 'ACTIVE');
  const contacts = members.filter((m) => m.role === 'CUSTOMER' && m.customerCompany?.id === f.customerCompanyId && m.status === 'ACTIVE');
  const tpl = templates.find((t) => t.id === f.templateId) || templates.find((t) => t.isDefault);
  const fe = fieldErrors(err);

  const stepErrors = useMemo(() => {
    const e = {};
    if (step === 0) { if (f.name.trim().length < 2) e.name = 'Enter a project name'; if (!/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(f.code)) e.code = '2–10 letters or digits, starting with a letter'; }
    if (step === 1 && !f.managerId) e.managerId = 'Choose a project manager';
    if (step === 2 && f.plannedFinish < f.plannedStart) e.plannedFinish = 'Finish must be on or after start';
    return e;
  }, [step, f]);

  const submit = async () => {
    setBusy(true); setErr(null);
    const body = { ...f, code: f.code.toUpperCase(), customerCompanyId: f.customerCompanyId || null, calendarId: f.calendarId || null, templateId: f.templateId || null,
      budgetAmount: f.budgetAmount === '' ? null : Number(f.budgetAmount), hourlyRate: f.hourlyRate === '' ? null : Number(f.hourlyRate), budgetCurrency: f.budgetAmount === '' ? null : f.budgetCurrency,
      description: f.description || null, objectives: f.objectives || null };
    try { const p = await post('/projects', body); toast(`${p.code} created with ${tpl?.phases.length ?? 0} phases`, 'success'); nav(`/projects/${p.id}`); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const toggle = (k, id) => setF((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }));

  return (
    <>
      <PageHeader eyebrow="Projects" title="New project" sub="The selected template generates phases, milestones and deliverables scaled to your planned window." />
      <ol className="wizard-steps list-unstyled" aria-label="Steps">
        {STEPS.map((s, i) => <li key={s} className="d-flex align-items-center gap-2">{i > 0 && <span className="sep" aria-hidden="true" />}<span className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`} aria-current={i === step ? 'step' : undefined}><span className="n">{i < step ? <Check size={12} /> : i + 1}</span>{s}</span></li>)}
      </ol>
      <ErrorBox error={err || ref.error} />
      <Card>
        {step === 0 && <div className="row">
          <div className="col-md-8"><Field label="Project name" error={stepErrors.name || fe.name}>{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus />}</Field></div>
          <div className="col-md-4"><Field label="Code" hint="Used in work item keys, e.g. CSM-12" error={stepErrors.code || fe.code}>{(id) => <input id={id} className="form-control mono text-uppercase" maxLength={10} value={f.code} onChange={(e) => set('code')(e.target.value.replace(/[^A-Za-z0-9]/g, ''))} />}</Field></div>
          <div className="col-12"><Field label="Description">{(id) => <textarea id={id} className="form-control" rows={3} value={f.description} onChange={(e) => set('description')(e.target.value)} />}</Field></div>
          <div className="col-12"><Field label="Objectives" hint="What does success look like?">{(id) => <textarea id={id} className="form-control" rows={3} value={f.objectives} onChange={(e) => set('objectives')(e.target.value)} />}</Field></div>
        </div>}
        {step === 1 && <div className="row">
          <div className="col-md-6"><Field label="Project manager" error={stepErrors.managerId}>{(id) => <Select id={id} value={f.managerId} onChange={set('managerId')} options={managers.map((m) => ({ value: m.userId, label: `${m.name}${m.userId === user.id ? ' (you)' : ''}` }))} />}</Field></div>
          <div className="col-md-6"><Field label="Customer company" hint="Leave empty for internal projects.">{(id) => <Select id={id} value={f.customerCompanyId} onChange={(v) => setF((x) => ({ ...x, customerCompanyId: v || '', customerContactIds: [] }))} placeholder="Internal project" options={customers.map((c) => ({ value: c.id, label: c.name }))} />}</Field></div>
          <div className="col-md-6"><fieldset className="mb-3"><legend className="form-label">Team members</legend>
            <div className="border rounded p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>{internal.filter((m) => m.userId !== f.managerId).map((m) => (
              <div className="form-check" key={m.userId}><input className="form-check-input" type="checkbox" id={`tm-${m.userId}`} checked={f.teamMemberIds.includes(m.userId)} onChange={() => toggle('teamMemberIds', m.userId)} />
                <label className="form-check-label" htmlFor={`tm-${m.userId}`}>{m.name} <span className="text-muted small">{m.title || m.role.toLowerCase()}</span></label></div>))}</div>
          </fieldset></div>
          <div className="col-md-6"><fieldset className="mb-3"><legend className="form-label">Customer contacts</legend>
            {!f.customerCompanyId ? <div className="form-text">Choose a customer company first.</div> : contacts.length === 0 ? <div className="form-text">No active users for this customer yet. Invite them from Admin → Users.</div> :
              <div className="border rounded p-2">{contacts.map((m) => <div className="form-check" key={m.userId}><input className="form-check-input" type="checkbox" id={`cc-${m.userId}`} checked={f.customerContactIds.includes(m.userId)} onChange={() => toggle('customerContactIds', m.userId)} /><label className="form-check-label" htmlFor={`cc-${m.userId}`}>{m.name} <span className="text-muted small">{m.email}</span></label></div>)}</div>}
            <div className="form-text">Contacts only see the project once sharing is enabled in step 4.</div>
          </fieldset></div>
        </div>}
        {step === 2 && <div className="row">
          <div className="col-md-3"><Field label="Planned start">{(id) => <input id={id} type="date" className="form-control" value={f.plannedStart} onChange={(e) => set('plannedStart')(e.target.value)} />}</Field></div>
          <div className="col-md-3"><Field label="Planned finish" error={stepErrors.plannedFinish || fe.plannedFinish}>{(id) => <input id={id} type="date" className="form-control" value={f.plannedFinish} onChange={(e) => set('plannedFinish')(e.target.value)} />}</Field></div>
          <div className="col-md-3"><Field label="Priority">{(id) => <Select id={id} value={f.priority} onChange={set('priority')} options={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => ({ value: v, label: v[0] + v.slice(1).toLowerCase() }))} />}</Field></div>
          <div className="col-md-3"><Field label="Initial health">{(id) => <Select id={id} value={f.health} onChange={set('health')} options={[{ value: 'GREEN', label: 'Green' }, { value: 'AMBER', label: 'Amber' }, { value: 'RED', label: 'Red' }]} />}</Field></div>
          <div className="col-md-6"><Field label="Working calendar" hint="Defines working days and holidays for durations. Manage calendars in Admin.">{(id) => <Select id={id} value={f.calendarId} onChange={(v) => set('calendarId')(v || '')} placeholder="Organization default" options={calendars.map((c) => ({ value: c.id, label: `${c.name}${c.holidays.length ? ` · ${c.holidays.length} holidays` : ''}` }))} />}</Field></div>
          <div className="col-md-6"><Field label="Project timezone" hint="Used to display deadlines.">{(id) => <select id={id} className="form-select" value={f.timezone} onChange={(e) => set('timezone')(e.target.value)}>{['UTC', ...TZ].map((z) => <option key={z}>{z}</option>)}</select>}</Field></div>
          <div className="col-md-6"><Field label="Template">{(id) => <Select id={id} value={f.templateId} onChange={(v) => set('templateId')(v || '')} placeholder="Organization default" options={templates.map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? ' (default)' : ''}` }))} />}</Field></div>
          <div className="col-md-6">{tpl && <div className="border rounded p-2 small" style={{ maxHeight: 220, overflowY: 'auto' }}><div className="small-caps mb-1">{tpl.phases.length} phases will be created</div>
            <ol className="mb-0 ps-3">{tpl.phases.map((p) => <li key={p.id}>{p.name}{p.milestones.length > 0 && <span className="text-muted"> · {p.milestones.length} milestone</span>}</li>)}</ol></div>}</div>
        </div>}
        {step === 3 && <div className="row">
          {['ADMIN', 'MANAGER'].includes(role) && <>
            <div className="col-md-4"><Field label="Budget (optional)">{(id) => <input id={id} type="number" min="0" className="form-control" value={f.budgetAmount} onChange={(e) => set('budgetAmount')(e.target.value)} />}</Field></div>
            <div className="col-md-2"><Field label="Currency">{(id) => <input id={id} className="form-control text-uppercase" maxLength={3} value={f.budgetCurrency} onChange={(e) => set('budgetCurrency')(e.target.value.toUpperCase())} />}</Field></div>
            <div className="col-md-3"><Field label="Hourly rate" hint="For budget consumption from billable time.">{(id) => <input id={id} type="number" min="0" className="form-control" value={f.hourlyRate} onChange={(e) => set('hourlyRate')(e.target.value)} />}</Field></div>
            <div className="col-md-3 d-flex align-items-center"><div className="form-check form-switch mt-2"><input className="form-check-input" type="checkbox" role="switch" id="bill" checked={f.billingEnabled} onChange={(e) => set('billingEnabled')(e.target.checked)} /><label className="form-check-label" htmlFor="bill">Track billable time</label></div></div>
          </>}
          <div className="col-12"><hr /></div>
          <div className="col-md-6"><div className="form-check form-switch mb-2"><input className="form-check-input" type="checkbox" role="switch" id="share" checked={f.customerVisible} disabled={!f.customerCompanyId} onChange={(e) => set('customerVisible')(e.target.checked)} /><label className="form-check-label fw-semibold" htmlFor="share">Share with customer contacts</label></div>
            <Notice>Customers only ever see items you mark as customer-visible, customer-visible comments and files, published status updates and submitted deliverables. Budgets, estimates, internal notes and time are never shared.</Notice></div>
          <div className="col-md-6"><Field label="Start as">{(id) => <Select id={id} value={f.status} onChange={set('status')} options={[{ value: 'DRAFT', label: 'Draft — plan before starting' }, { value: 'ACTIVE', label: 'Active — work can begin' }]} />}</Field></div>
        </div>}
        {step === 4 && <dl className="kv">
          <dt>Project</dt><dd><span className="mono">{f.code.toUpperCase()}</span> · {f.name}</dd>
          <dt>Manager</dt><dd>{managers.find((m) => m.userId === f.managerId)?.name}</dd>
          <dt>Customer</dt><dd>{customers.find((c) => c.id === f.customerCompanyId)?.name || 'Internal'}{f.customerContactIds.length > 0 && ` · ${f.customerContactIds.length} contact(s)`}</dd>
          <dt>Team</dt><dd>{f.teamMemberIds.length} member(s)</dd>
          <dt>Window</dt><dd>{fmtDate(f.plannedStart)} → {fmtDate(f.plannedFinish)} ({f.timezone})</dd>
          <dt>Template</dt><dd>{tpl?.name} · {tpl?.phases.length} phases</dd>
          <dt>Customer sharing</dt><dd>{f.customerVisible ? 'On' : 'Off'}</dd>
          <dt>Status</dt><dd>{f.status === 'DRAFT' ? 'Draft' : 'Active'}</dd>
        </dl>}
      </Card>
      <div className="d-flex justify-content-between mt-3">
        <button className="btn btn-light" onClick={() => (step ? setStep(step - 1) : nav('/projects'))}><ChevronLeft size={15} /> {step ? 'Back' : 'Cancel'}</button>
        {step < STEPS.length - 1 ? <button className="btn btn-primary" disabled={Object.keys(stepErrors).length > 0} onClick={() => setStep(step + 1)}>Continue <ChevronRight size={15} /></button>
          : <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create project'}</button>}
      </div>
    </>
  );
}
