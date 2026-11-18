import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Inbox, BookOpen, FolderKanban, CheckSquare, Clock, Users, Settings, Bell, Search, LogOut, Menu, BarChart3, Plus, LifeBuoy, FilePlus2, Timer, Home, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { get, post } from '../api/client.js';
import { useDebounced } from '../lib/hooks.js';
import { fmtRelative, labelize } from '../lib/format.js';
import { connectLive, disconnectLive, useLive, useLiveStatus } from '../lib/live.js';
import { Avatar, StatusBadge, ProjectDot, useToast } from './ui.jsx';

export const APP_NAME = 'O2 Support Hub';
export const BrandMark = () => <span className="brand-mark" aria-hidden="true">O<sub>2</sub></span>;

function NavItem({ to, icon: Icon, children, end, count, hot }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={17} aria-hidden="true" />{children}{count > 0 && <span className={`count ${hot ? 'hot' : ''}`}>{count}</span>}</NavLink>;
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
    Promise.all([get('/search', { q: dq.trim() }), get('/kb/articles', { q: dq.trim() }).catch(() => ({ data: [] }))])
      .then(([r, kb]) => live && setRes({ ...r, articles: kb.data.slice(0, 4) })).catch(() => live && setRes(null));
    return () => { live = false; };
  }, [dq]);
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); document.getElementById('global-search')?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const go = (path) => { setOpen(false); setQ(''); nav(path); };
  const total = res ? res.projects.length + res.workItems.length + res.tickets.length + res.articles.length : 0;
  const A = ({ to, children }) => <a href={to} onClick={(e) => { e.preventDefault(); go(to); }}>{children}</a>;
  return (
    <div className="search" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <Search size={16} className="icon" aria-hidden="true" />
      <input id="global-search" className="form-control" placeholder="Search tickets, projects, tasks, articles…" value={q} aria-label="Search" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {!q && <kbd>Ctrl K</kbd>}
      {open && res && (
        <div className="search-results">
          {total === 0 && <div className="p-3 small text-muted">No matches for “{dq}”.</div>}
          {res.tickets.length > 0 && <div className="grp">Tickets</div>}
          {res.tickets.map((t) => <A key={t.id} to={`/tickets/${t.id}`}><LifeBuoy size={15} className="text-muted" /><span className="mono">#{t.number}</span><span className="truncate flex-grow-1">{t.subject}</span><StatusBadge status={t.status} /></A>)}
          {res.projects.length > 0 && <div className="grp">Projects</div>}
          {res.projects.map((p) => <A key={p.id} to={`/projects/${p.id}`}><ProjectDot code={p.code} /><span className="truncate fw-semibold">{p.name}</span></A>)}
          {res.workItems.length > 0 && <div className="grp">Tasks</div>}
          {res.workItems.map((w) => <A key={w.id} to={`/projects/${w.projectId}/tasks?item=${w.id}`}><CheckCircle2 size={15} className="text-muted" /><span className="truncate flex-grow-1">{w.title}</span><StatusBadge status={w.status} /></A>)}
          {res.articles.length > 0 && <div className="grp">Help articles</div>}
          {res.articles.map((a) => <A key={a.id} to={`/kb/${a.id}`}><BookOpen size={15} className="text-muted" /><span className="truncate flex-grow-1">{a.title}</span><span className="small text-muted">{a.category}</span></A>)}
        </div>
      )}
    </div>
  );
}

const linkFor = (n) => n.link?.replace(/\/work\/([0-9a-f-]{36})$/, '/tasks?item=$1').replace(/^\/admin\//, '/settings/');

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const nav = useNavigate();
  const toast = useToast();
  const load = () => get('/notifications', { pageSize: 15 }).then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t); }, []);
  useLive((e) => e.type === 'notification', (e) => { load(); if (e.title) toast(e.title, 'live-evt'); });
  const openItem = async (n) => { setOpen(false); if (!n.readAt) await post(`/notifications/${n.id}/read`).catch(() => {}); load(); if (n.link) nav(linkFor(n)); };
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn btn-ghost btn-icon position-relative" onClick={() => setOpen(!open)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={19} />{data?.unread > 0 && <span className="count-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom"><strong>Notifications</strong>
            <button className="btn btn-sm btn-link p-0" onClick={async () => { await post('/notifications/read-all'); load(); }}>Mark all as read</button></div>
          {data?.data.length === 0 && <div className="p-4 text-center small text-muted">You're all caught up.</div>}
          {data?.data.map((n) => (
            <a href="#" key={n.id} className={`item ${n.readAt ? '' : 'unread'}`} onClick={(e) => { e.preventDefault(); openItem(n); }}>
              <div className="fw-semibold small">{n.title}</div>{n.body && <div className="small text-muted truncate">{n.body}</div>}<div className="small text-muted">{fmtRelative(n.createdAt)}</div>
            </a>
          ))}
          <Link className="d-block text-center small py-2" to="/notifications" onClick={() => setOpen(false)}>See all notifications</Link>
        </div>
      )}
    </div>
  );
}

function NewMenu() {
  const { isCustomer, role } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const go = (to) => { setOpen(false); nav(to); };
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"><Plus size={15} /> New</button>
      {open && <div className="new-menu" role="menu">
        {!isCustomer && manager && <button role="menuitem" onClick={() => go('/projects?new=1')}><FolderKanban size={16} className="text-primary" /><span>New project<small>Plan phases, team and tasks</small></span></button>}
        <button role="menuitem" onClick={() => go('/tickets?new=1')}><LifeBuoy size={16} className="text-primary" /><span>{isCustomer ? 'Raise a ticket' : 'New ticket'}<small>Report an issue or request</small></span></button>
        {!isCustomer && <button role="menuitem" onClick={() => go('/kb?new=1')}><FilePlus2 size={16} className="text-primary" /><span>New help article<small>Add to the knowledge base</small></span></button>}
        {!isCustomer && <button role="menuitem" onClick={() => go('/time')}><Timer size={16} className="text-primary" /><span>Log time<small>Fill in this week's timesheet</small></span></button>}
      </div>}
    </div>
  );
}

function LiveBadge() {
  const s = useLiveStatus();
  return <span className={`live ${s === 'on' ? '' : 'off'}`} title={s === 'on' ? 'Updates appear instantly' : 'Reconnecting… changes will appear when the connection is back'}>{s === 'on' ? 'Live' : 'Offline'}</span>;
}

export default function Layout() {
  const { user, role, isCustomer, me, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const [views, setViews] = useState(null);
  const loc = useLocation();
  useEffect(() => { setMenu(false); }, [loc.pathname]);
  useEffect(() => { connectLive(); return () => disconnectLive(); }, []);
  const loadViews = () => get('/tickets/views').then(setViews).catch(() => {});
  useEffect(() => { loadViews(); }, []);
  useLive((e) => e.type.startsWith('ticket'), () => loadViews());
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main menu">
        <div className="brand"><BrandMark /><div>{APP_NAME}<small>{me?.organization?.name}</small></div></div>
        <nav>
          {isCustomer ? <>
            <NavItem to="/" icon={Home} end>Home</NavItem>
            <NavItem to="/projects" icon={FolderKanban}>My projects</NavItem>
            <NavItem to="/tickets" icon={Inbox} count={views?.open}>My tickets</NavItem>
            <NavItem to="/kb" icon={BookOpen}>Help center</NavItem>
          </> : <>
            <div className="nav-label">Projects</div>
            <NavItem to="/" icon={LayoutDashboard} end>Dashboard</NavItem>
            <NavItem to="/projects" icon={FolderKanban}>Projects</NavItem>
            <NavItem to="/my-tasks" icon={CheckSquare}>My tasks</NavItem>
            <NavItem to="/time" icon={Clock}>Timesheets</NavItem>
            <div className="nav-label">Support</div>
            <NavItem to="/tickets" icon={Inbox} count={views?.overdue || views?.unassigned} hot={views?.overdue > 0}>Tickets</NavItem>
            <NavItem to="/kb" icon={BookOpen}>Knowledge base</NavItem>
            <div className="nav-label">Organisation</div>
            {manager && <NavItem to="/reports" icon={BarChart3}>Reports</NavItem>}
            <NavItem to="/people" icon={Users}>Team directory</NavItem>
            {role === 'ADMIN' && <NavItem to="/settings" icon={Settings}>Settings</NavItem>}
          </>}
        </nav>
        <div className="me">
          <Link to="/profile" className="d-flex align-items-center gap-2 min-w-0 flex-grow-1 text-decoration-none" style={{ color: 'inherit' }} title="My profile">
            <Avatar name={user?.name} />
            <div className="min-w-0"><div className="fw-semibold small truncate">{user?.name}</div><div className="small text-muted truncate">{isCustomer ? me?.customerCompany?.name : user?.title || labelize(role)}</div></div></Link>
          <button className="btn btn-ghost btn-icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setMenu(!menu)} aria-label="Open menu"><Menu size={20} /></button>
          <GlobalSearch />
          <div className="ms-auto d-flex align-items-center gap-2"><LiveBadge /><NewMenu /><Notifications /></div>
        </header>
        <main id="main" className="content" tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
