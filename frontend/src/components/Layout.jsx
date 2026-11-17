import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, LifeBuoy, Clock, CheckSquare, Users, Building2, Settings, Bell, Search, LogOut, Menu, Gauge, ScrollText, CalendarDays, Layers, MailWarning } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { get, post } from '../api/client.js';
import { useDebounced } from '../lib/hooks.js';
import { fmtRelative, labelize } from '../lib/format.js';
import { Avatar, StatusBadge } from './ui.jsx';

function NavItem({ to, icon: Icon, children, end }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={17} aria-hidden="true" />{children}</NavLink>;
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const nav = useNavigate();
  useEffect(() => {
    if (dq.trim().length < 2) { setRes(null); return; }
    let live = true;
    get('/search', { q: dq.trim() }).then((r) => live && setRes(r)).catch(() => live && setRes(null));
    return () => { live = false; };
  }, [dq]);
  const go = (path) => { setOpen(false); setQ(''); nav(path); };
  const total = res ? res.projects.length + res.workItems.length + res.tickets.length : 0;
  return (
    <div className="search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search size={15} className="icon" aria-hidden="true" />
      <input className="form-control form-control-sm" placeholder="Search projects, work items (e.g. CSM-12), tickets (#42)…" value={q} aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && res && (
        <div className="search-results">
          {total === 0 && <div className="p-2 small text-muted">No matches you have access to.</div>}
          {res.projects.map((p) => <a href="#" key={p.id} onClick={(e) => { e.preventDefault(); go(`/projects/${p.id}`); }}><FolderKanban size={14} /><span className="mono">{p.code}</span> <span className="truncate">{p.name}</span></a>)}
          {res.workItems.map((w) => <a href="#" key={w.id} onClick={(e) => { e.preventDefault(); go(`/projects/${w.projectId}/work?item=${w.id}`); }}><Layers size={14} /><span className="mono">{w.key}</span> <span className="truncate flex-grow-1">{w.title}</span><StatusBadge status={w.status} /></a>)}
          {res.tickets.map((t) => <a href="#" key={t.id} onClick={(e) => { e.preventDefault(); go(`/tickets/${t.id}`); }}><LifeBuoy size={14} /><span className="mono">#{t.number}</span> <span className="truncate flex-grow-1">{t.subject}</span><StatusBadge status={t.status} /></a>)}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const nav = useNavigate();
  const load = () => get('/notifications', { pageSize: 15 }).then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const openItem = async (n) => { setOpen(false); if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => {}); load(); if (n.link) nav(n.link.replace(/\/work\/([0-9a-f-]{36})$/, '/work?item=$1')); };
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn btn-ghost btn-icon position-relative" onClick={() => setOpen(!open)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={18} />{data?.unread > 0 && <span className="count-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom"><strong>Notifications</strong>
            <div className="d-flex gap-2"><button className="btn btn-sm btn-link p-0" onClick={async () => { await post('/notifications/read-all'); load(); }}>Mark all read</button><Link className="btn btn-sm btn-link p-0" to="/notifications" onClick={() => setOpen(false)}>View all</Link></div></div>
          <div className="px-3 py-2 small text-muted d-flex gap-2 align-items-center border-bottom"><MailWarning size={13} /> Email delivery is not configured; notifications appear here only.</div>
          {data?.data.length === 0 && <div className="p-3 small text-muted">You are all caught up.</div>}
          {data?.data.map((n) => (
            <a href="#" key={n.id} className={`item ${n.readAt ? '' : 'unread'}`} onClick={(e) => { e.preventDefault(); openItem(n); }}>
              <div className="fw-semibold small">{n.title}</div>{n.body && <div className="small text-muted truncate">{n.body}</div>}<div className="small text-muted">{fmtRelative(n.createdAt)}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, role, org, isCustomer, me, logout, can } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const main = useRef(null);
  useEffect(() => { setMenu(false); }, [loc.pathname]);
  const internal = !isCustomer;
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Primary">
        <div className="brand"><svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#1b3556" /><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#7fb2e5" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg><div>Meridian<small>{isCustomer ? 'Customer portal' : 'Projects & Service'}</small></div></div>
        <nav>
          <NavItem to="/" icon={LayoutDashboard} end>Dashboard</NavItem>
          <NavItem to="/projects" icon={FolderKanban}>Projects</NavItem>
          <NavItem to="/tickets" icon={LifeBuoy}>{isCustomer ? 'Support tickets' : 'Tickets'}</NavItem>
          {internal && <>
            <div className="nav-group">Time & resources</div>
            <NavItem to="/time" icon={Clock}>My timesheet</NavItem>
            {['ADMIN', 'MANAGER'].includes(role) && <NavItem to="/time/approvals" icon={CheckSquare}>Approvals</NavItem>}
            {can('workload.view') && <NavItem to="/workload" icon={Gauge}>Workload</NavItem>}
            <NavItem to="/people" icon={Users}>People</NavItem>
          </>}
          {role === 'ADMIN' && <>
            <div className="nav-group">Administration</div>
            <NavItem to="/admin/users" icon={Users}>Users & invitations</NavItem>
            <NavItem to="/admin/customers" icon={Building2}>Customers</NavItem>
            <NavItem to="/admin/calendars" icon={CalendarDays}>Calendars</NavItem>
            <NavItem to="/admin/templates" icon={Layers}>Templates</NavItem>
            <NavItem to="/admin/ticket-settings" icon={Settings}>Ticket settings</NavItem>
            <NavItem to="/admin/audit" icon={ScrollText}>Audit log</NavItem>
          </>}
        </nav>
        <div className="org-card"><strong>{org?.name}</strong>{isCustomer ? me?.customerCompany?.name : labelize(role)}</div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setMenu(!menu)} aria-label="Toggle navigation"><Menu size={18} /></button>
          <GlobalSearch />
          <div className="ms-auto d-flex align-items-center gap-2">
            <Notifications />
            <div className="d-flex align-items-center gap-2 ps-2 border-start"><Avatar name={user?.name} /><div className="d-none d-md-block lh-sm"><div className="small fw-semibold text-body">{user?.name}</div><div className="small text-muted">{user?.email}</div></div></div>
            <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
          </div>
        </header>
        <main id="main" className="content" ref={main} tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
