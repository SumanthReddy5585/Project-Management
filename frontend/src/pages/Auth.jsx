import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { get, post } from '../api/client.js';
import { ErrorBox, Field, Notice, fieldErrors, Loading } from '../components/ui.jsx';

function Shell({ children }) {
  return (
    <div className="auth-wrap">
      <div className="auth-art">
        <div className="d-flex align-items-center gap-2 fw-bold text-white"><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1b3556" /><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#7fb2e5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>Meridian</div>
        <div><h1>Plan the work. Serve the customer. One source of truth.</h1><p className="mt-3" style={{ maxWidth: 440, color: '#9fb4cf' }}>Projects, schedules, time, tickets and approvals — with customer access that only ever shows what you choose to share.</p></div>
        <div className="small" style={{ color: '#6f88a8' }}>Secure, invitation-only workspace</div>
      </div>
      <div className="auth-form"><div className="box">{children}</div></div>
    </div>
  );
}

export function Login() {
  const { me, login } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={params.get('next')?.startsWith('/') ? params.get('next') : '/'} replace />;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await login(f.email, f.password); nav(params.get('next')?.startsWith('/') ? params.get('next') : '/'); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h2 className="h4 mb-1">Sign in</h2><p className="text-muted mb-4">Use the email your administrator invited.</p>
      <ErrorBox error={err} />
      <form onSubmit={submit} noValidate>
        <Field label="Email">{(id) => <input id={id} type="email" className="form-control" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Password">{(id) => <input id={id} type="password" className="form-control" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <button className="btn btn-primary w-100 justify-content-center py-2" disabled={busy || !f.email || !f.password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="mt-3 small"><Link to="/forgot-password">Forgot your password?</Link></div>
    </Shell>
  );
}

export function AcceptInvite() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { acceptInvite } = useAuth();
  const nav = useNavigate();
  const [inv, setInv] = useState(undefined);
  const [f, setF] = useState({ name: '', password: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get(`/auth/invitations/${encodeURIComponent(token)}`).then((d) => { setInv(d); setF((x) => ({ ...x, name: d.name || '' })); }).catch((e) => { setInv(null); setErr(e); }); }, [token]);
  const fe = fieldErrors(err);
  const submit = async (e) => {
    e.preventDefault();
    if (!inv.existingAccount && f.password !== f.confirm) { setErr({ message: 'Passwords do not match' }); return; }
    setBusy(true); setErr(null);
    try { await acceptInvite({ token, name: f.name, password: f.password }); nav('/'); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <Shell>
      {inv === undefined && <Loading />}
      {inv === null && <><h2 className="h4">Invitation unavailable</h2><ErrorBox error={err} /><Link to="/login">Go to sign in</Link></>}
      {inv && <>
        <h2 className="h4 mb-1">Join {inv.organization}</h2>
        <p className="text-muted mb-4">You were invited as <strong>{inv.role.toLowerCase()}</strong> with <strong>{inv.email}</strong>.</p>
        <ErrorBox error={err} />
        <form onSubmit={submit}>
          {!inv.existingAccount && <Field label="Full name" error={fe.name}>{(id) => <input id={id} className="form-control" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>}
          <Field label={inv.existingAccount ? 'Your existing password' : 'Create a password'} hint={inv.existingAccount ? 'You already have an account; confirm it to join.' : 'At least 10 characters, including a letter and a number.'} error={fe.password}>
            {(id) => <input id={id} type="password" className="form-control" autoComplete={inv.existingAccount ? 'current-password' : 'new-password'} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
          {!inv.existingAccount && <Field label="Confirm password">{(id) => <input id={id} type="password" className="form-control" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />}</Field>}
          <button className="btn btn-primary w-100 justify-content-center py-2" disabled={busy}>{busy ? 'Joining…' : 'Accept invitation'}</button>
        </form>
      </>}
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [err, setErr] = useState(null);
  const submit = async (e) => { e.preventDefault(); setErr(null); try { setDone(await post('/auth/password/forgot', { email })); } catch (x) { setErr(x); } };
  return (
    <Shell>
      <h2 className="h4 mb-1">Reset your password</h2>
      {done ? <Notice>{done.message} Email delivery isn't configured in this installation, so your administrator will send you a one-time reset link.</Notice> : <>
        <p className="text-muted mb-4">We'll notify your administrator, who can issue a secure one-time reset link.</p>
        <ErrorBox error={err} />
        <form onSubmit={submit}><Field label="Email">{(id) => <input id={id} type="email" className="form-control" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <button className="btn btn-primary w-100 justify-content-center" disabled={!email}>Request reset</button></form></>}
      <div className="mt-3 small"><Link to="/login">Back to sign in</Link></div>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState(null);
  const [ok, setOk] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.password !== f.confirm) return setErr({ message: 'Passwords do not match' });
    try { await post('/auth/password/reset', { token: params.get('token'), password: f.password }); setOk(true); } catch (x) { setErr(x); }
  };
  return (
    <Shell>
      <h2 className="h4 mb-3">Choose a new password</h2>
      {ok ? <><Notice>Password updated. All other sessions were signed out.</Notice><Link className="btn btn-primary mt-3" to="/login">Sign in</Link></> : <>
        <ErrorBox error={err} />
        <form onSubmit={submit}>
          <Field label="New password" hint="At least 10 characters, including a letter and a number." error={fieldErrors(err).password}>{(id) => <input id={id} type="password" autoComplete="new-password" className="form-control" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
          <Field label="Confirm password">{(id) => <input id={id} type="password" autoComplete="new-password" className="form-control" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />}</Field>
          <button className="btn btn-primary w-100 justify-content-center">Update password</button>
        </form></>}
    </Shell>
  );
}
