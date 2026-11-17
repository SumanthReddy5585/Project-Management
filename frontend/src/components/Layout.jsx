import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, CheckCircle2, FolderKanban, LifeBuoy, Clock, Users, Settings, Bell, Search, LogOut, Menu, BarChart3, Layers } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { get, post } from '../api/client.js';
import { useDebounced } from '../lib/hooks.js';
import { fmtRelative, labelize } from '../lib/format.js';
import { Avatar, StatusBadge, ProjectDot } from './ui.jsx';

function NavItem({ to, icon: Icon, children, end, count }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={18} aria-hidden="true" />{children}{count > 0 && <span className="count">{count}</span>}</NavLink>;
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
      <Search size={16} className="icon" aria-hidden="true" />
      <input className="form-control" placeholder="Search projects, tasks and requests" value={q} aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && res && (
        <div className="search-results">
          {total === 0 && <div className="p-2 small text-muted">Nothing found.</div>}
          {res.projects.map((p) => <a href="#" key={p.id} onClick={(e) => { e.preventDefault(); go(`/projects/${p.id}`); }}><ProjectDot code={p.code} /><span className="truncate fw-semibold">{p.name}</span></a>)}
          {res.workItems.map((w) => <a href="#" key={w.id} onClick={(e) => { e.preventDefault(); go(`/projects/${w.projectId}/tasks?item=${w.id}`); }}><CheckCircle2 size={15} className="text-muted" /><span className="truncate flex-grow-1">{w.title}</span><StatusBadge status={w.status} /></a>)}
          {res.tickets.map((t) => <a href="#" key={t.id} onClick={(e) => { e.preventDefault(); go(`/tickets/${t.id}`); }}><LifeBuoy size={15} className="text-muted" /><span className="truncate flex-grow-1">{t.subject}</span><StatusBadge status={t.status} /></a>)}
        </div>
      )}
    </div>
  );
}

const linkFor = (n) => n.link?.replace(/\/work\/([0-9a-f-]{36})$/, '/tasks?item=$1');

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const nav = useNavigate();
  const load = () => get('/notifications', { pageSize: 15 }).then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const openItem = async (n) => { setOpen(false); if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => {}); load(); if (n.link) nav(linkFor(n)); };
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn btn-ghost btn-icon position-relative" onClick={() => setOpen(!open)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={20} />{data?.unread > 0 && <span className="count-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom"><strong>Notifications</strong>
            <button className="btn btn-sm btn-link p-0" onClick={async () => { await post('/notifications/read-all'); load(); }}>Mark all read</button></div>
          {data?.data.length === 0 && <div className="p-4 text-center small text-muted">You're all caught up.</div>}
          {data?.data.map((n) => (
            <a href="#" key={n.id} className={`item ${n.readAt ? '' : 'unread'}`} onClick={(e) => { e.preventDefault(); openItem(n); }}>
              <div className="fw-semibold small">{n.title}</div>{n.body && <div className="small text-muted truncate">{n.body}</div>}<div className="small text-muted">{fmtRelative(n.createdAt)}</div>
            </a>
          ))}
          <Link className="d-block text-center small py-2" to="/notifications" onClick={() => setOpen(false)}>See all</Link>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, role, isCustomer, me, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMenu(false); }, [loc.pathname]);
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main menu">
        <div className="brand"><span className="brand-mark">M</span>Meridian</div>
        <nav>
          <NavItem to="/" icon={Home} end>Home</NavItem>
          {!isCustomer && <NavItem to="/my-tasks" icon={CheckCircle2}>My tasks</NavItem>}
          <NavItem to="/projects" icon={FolderKanban}>Projects</NavItem>
          <NavItem to="/tickets" icon={LifeBuoy}>Requests</NavItem>
          {!isCustomer && <NavItem to="/time" icon={Clock}>Time</NavItem>}
          {!isCustomer && <>
            <div className="nav-label">Team</div>
            <NavItem to="/people" icon={Users}>People</NavItem>
            {manager && <NavItem to="/reports" icon={BarChart3}>Reports</NavItem>}
            {role === 'ADMIN' && <NavItem to="/settings" icon={Settings}>Settings</NavItem>}
          </>}
        </nav>
        <div className="me">
          <Avatar name={user?.name} />
          <div className="min-w-0 flex-grow-1"><div className="fw-semibold small truncate">{user?.name}</div><div className="small text-muted truncate">{isCustomer ? me?.customerCompany?.name : labelize(role)}</div></div>
          <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setMenu(!menu)} aria-label="Open menu"><Menu size={20} /></button>
          <GlobalSearch />
          <div className="ms-auto d-flex align-items-center gap-2"><Notifications /></div>
        </header>
        <main id="main" className="content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
