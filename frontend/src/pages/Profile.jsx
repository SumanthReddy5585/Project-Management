import { useState } from 'react';
import { patch } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { labelize } from '../lib/format.js';
import { Avatar, Card, Field, useToast } from '../components/ui.jsx';
import { ChangePasswordForm } from './Auth.jsx';

export default function Profile() {
  const { me, role, refresh } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: me.user.name, phone: me.user.phone || '' });
  const save = async (e) => { e.preventDefault(); try { await patch('/auth/profile', { name: f.name, phone: f.phone || null }); await refresh(); toast('Profile saved', 'success'); } catch (x) { toast(x.message, 'error'); } };
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">My profile</h1><div className="sub">Your details and password.</div></div></div>
      <div className="row g-3">
        <div className="col-lg-7"><Card title="Details">
          <div className="d-flex align-items-center gap-3 mb-3"><Avatar lg name={me.user.name} /><div><div className="fw-semibold">{me.user.name}</div><div className="small text-muted">{[me.user.title, me.user.department, labelize(role)].filter(Boolean).join(' · ')}</div><div className="small text-muted">{me.user.email}</div></div></div>
          <form onSubmit={save}>
            <div className="row"><div className="col-md-6"><Field label="Name">{(id) => <input id={id} className="form-control" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field></div>
              <div className="col-md-6"><Field label="Phone">{(id) => <input id={id} className="form-control" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field></div></div>
            <div className="form-text mb-3">Designation and department are managed by your administrator.</div>
            <button className="btn btn-primary" disabled={!f.name.trim()}>Save</button>
          </form>
        </Card></div>
        <div className="col-lg-5"><Card title="Change password"><ChangePasswordForm onDone={() => toast('Password changed. Other devices were signed out.', 'success')} /></Card></div>
      </div>
    </>
  );
}
