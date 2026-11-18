import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Inbox, BookOpen, FolderKanban, CheckSquare, Clock, Users, Settings, Bell, Search, LogOut, BarChart3, Plus, LifeBuoy, FilePlus2, Timer, Home, CheckCircle2, CalendarRange, PanelLeft, HelpCircle, UserRound, ChevronDown, LayoutGrid } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { get, post } from '../api/client.js';
import { useDebounced } from '../lib/hooks.js';
import { fmtRelative, labelize } from '../lib/format.js';
import { connectLive, disconnectLive, useLive, useLiveStatus } from '../lib/live.js';
import { Avatar, StatusBadge, ProjectDot, ProjectChip, useToast } from './ui.jsx';

export const APP_NAME = 'O2 Support Hub';
export const BrandMark = () => <img src="/logo-mark.png" className="brand-mark-img" alt="" aria-hidden="true" />;
export const BrandLogo = ({ className = '' }) => <img src="/logo.png" className={`brand-logo ${className}`} alt={APP_NAME} />;

function NavItem({ to, icon: Icon, children, end, count, hot }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={16} aria-hidden="true" /><span className="truncate">{children}</span>{count > 0 && <span className={`count ${hot ? 'hot' : ''}`}>{count}</span>}</NavLink>;
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
      <input id="global-search" className="form-control" placeholder="Search" value={q} aria-label="Search" autoComplete="off"
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
        <Bell size={18} />{data?.unread > 0 && <span className="count-badge">{data.unread > 99 ? '99+' : data.unread}</span>}
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
      <button className="btn btn-primary create" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu"><Plus size={16} /> Create</button>
      {open && <div className="menu-pop" role="menu" style={{ top: 'calc(100% + 6px)', right: 0, minWidth: 280 }}>
        {!isCustomer && manager && <button role="menuitem" onClick={() => go('/projects?new=1')}><FolderKanban size={16} className="text-primary" /><span>New project<small>Stages, team and plan</small></span></button>}
        <button role="menuitem" onClick={() => go('/tickets?new=1')}><LifeBuoy size={16} className="text-primary" /><span>{isCustomer ? 'Raise a ticket' : 'New ticket'}<small>Report an issue or request</small></span></button>
        {!isCustomer && <button role="menuitem" onClick={() => go('/kb?new=1')}><FilePlus2 size={16} className="text-primary" /><span>New help article<small>Add to the knowledge base</small></span></button>}
        {!isCustomer && <button role="menuitem" onClick={() => go('/time')}><Timer size={16} className="text-primary" /><span>Log time<small>Fill in this week's timesheet</small></span></button>}
      </div>}
    </div>
  );
}

function LiveBadge() {
  const s = useLiveStatus();
  return <span className={`live ${s === 'on' ? '' : 'off'}`} title={s === 'on' ? 'Live: changes by others appear instantly' : 'Reconnecting… changes will appear when the connection is back'}><span className="visually-hidden">{s === 'on' ? 'Live' : 'Offline'}</span></span>;
}

function ProfileMenu() {
  const { user, role, isCustomer, me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="position-relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Your profile and settings" aria-expanded={open}><Avatar name={user?.name} /></button>
      {open && <div className="menu-pop" role="menu" style={{ top: 'calc(100% + 6px)', right: 0, minWidth: 260 }}>
        <div className="d-flex align-items-center gap-2 px-3 py-2"><Avatar lg name={user?.name} /><div className="min-w-0"><div className="fw-semibold truncate">{user?.name}</div><div className="small text-muted truncate">{user?.email}</div></div></div>
        <div className="small text-muted px-3 pb-2">{isCustomer ? me?.customerCompany?.name : `${user?.title || labelize(role)} · ${me?.organization?.name || ''}`}</div>
        <hr />
        <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}><UserRound size={16} /> Profile</Link>
        <Link role="menuitem" to="/notifications" onClick={() => setOpen(false)}><Bell size={16} /> Notifications</Link>
        <hr />
        <button role="menuitem" onClick={logout}><LogOut size={16} /> Sign out</button>
      </div>}
    </div>
  );
}

// Recently opened projects, remembered in this browser (Workspace records each visit).
const RECENT_KEY = 'o2.recentProjects';
export function rememberProject(p) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((x) => x.id !== p.id);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: p.id, code: p.code, name: p.name }, ...list].slice(0, 6)));
    window.dispatchEvent(new Event('o2-recent'));
  } catch { /* storage unavailable */ }
}
function useRecentProjects() {
  const read = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
  const [list, setList] = useState(read);
  useEffect(() => { const on = () => setList(read()); window.addEventListener('o2-recent', on); return () => window.removeEventListener('o2-recent', on); }, []);
  return list;
}

function SideProjects() {
  const recent = useRecentProjects();
  const [open, setOpen] = useState(true);
  const loc = useLocation();
  const [fallback, setFallback] = useState([]);
  useEffect(() => { if (!recent.length) get('/projects', { pageSize: 5, status: 'ACTIVE,ON_HOLD,DRAFT' }).then((r) => setFallback(r.data || [])).catch(() => {}); }, [recent.length]);
  const list = (recent.length ? recent : fallback).slice(0, 5);
  return <>
    <button className="nav-item" onClick={() => setOpen(!open)} aria-expanded={open}><FolderKanban size={16} />Projects<ChevronDown size={14} className="chev" style={{ transform: open ? 'none' : 'rotate(-90deg)' }} /></button>
    {open && <div className="sub">
      {list.length > 0 && <div className="sec" style={{ paddingTop: '0.4rem' }}>Recent</div>}
      {list.map((p) => <NavLink key={p.id} to={`/projects/${p.id}`} className={() => `nav-item proj-item ${loc.pathname.startsWith(`/projects/${p.id}`) ? 'active' : ''}`}><ProjectChip code={p.code} size={20} /><span className="truncate">{p.name}</span></NavLink>)}
      <NavLink to="/projects" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><LayoutGrid size={16} />View all projects</NavLink>
    </div>}
  </>;
}

export default function Layout() {
  const { role, isCustomer } = useAuth();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('o2.sideCollapsed') === '1'; } catch { return false; } });
  const [mobile, setMobile] = useState(false);
  const [views, setViews] = useState(null);
  const loc = useLocation();
  useEffect(() => { setMobile(false); }, [loc.pathname]);
  useEffect(() => { connectLive(); return () => disconnectLive(); }, []);
  const loadViews = () => get('/tickets/views').then(setViews).catch(() => {});
  useEffect(() => { loadViews(); }, []);
  useLive((e) => e.type.startsWith('ticket'), () => loadViews());
  const toggle = () => {
    if (window.matchMedia('(max-width: 991px)').matches) { setMobile((m) => !m); return; }
    setCollapsed((c) => { try { localStorage.setItem('o2.sideCollapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  };
  const manager = ['ADMIN', 'MANAGER'].includes(role);
  const wide = /^\/projects\/[^/]+\/(board|timeline|list|tasks)/.test(loc.pathname);
  return (
    <div className={`j-shell ${collapsed ? 'collapsed' : ''} ${mobile ? 'mobile-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="j-top">
        <button className="btn btn-ghost btn-icon" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Sidebar"><PanelLeft size={18} /></button>
        <Link to="/" className="brand-link" aria-label={`${APP_NAME} home`}><BrandLogo className="d-none d-sm-block" /><span className="d-sm-none"><BrandMark /></span></Link>
        <GlobalSearch />
        <NewMenu />
        <div className="right">
          <LiveBadge />
          <Notifications />
          <Link to="/kb" className="btn btn-ghost btn-icon" aria-label="Help" title="Help"><HelpCircle size={18} /></Link>
          {role === 'ADMIN' && <Link to="/settings" className="btn btn-ghost btn-icon" aria-label="Settings" title="Settings"><Settings size={18} /></Link>}
          <ProfileMenu />
        </div>
      </header>
      <aside className="j-side sidebar" aria-label="Main menu">
        <nav>
          {isCustomer ? <>
            <NavItem to="/" icon={Home} end>Home</NavItem>
            <NavItem to="/projects" icon={FolderKanban}>My projects</NavItem>
            <NavItem to="/tickets" icon={Inbox} count={views?.open}>My tickets</NavItem>
            <NavItem to="/kb" icon={BookOpen}>Help center</NavItem>
          </> : <>
            <NavItem to="/" icon={UserRound} end>For you</NavItem>
            <NavItem to="/my-tasks" icon={CheckSquare}>My tasks</NavItem>
            <SideProjects />
            <div className="sec">Planning</div>
            {manager && <NavItem to="/planner" icon={CalendarRange}>Resource planner</NavItem>}
            <NavItem to="/time" icon={Clock}>Timesheets</NavItem>
            {manager && <NavItem to="/reports" icon={BarChart3}>Reports</NavItem>}
            <div className="sec">Service</div>
            <NavItem to="/tickets" icon={Inbox} count={views?.overdue || views?.unassigned} hot={views?.overdue > 0}>Queues</NavItem>
            <NavItem to="/kb" icon={BookOpen}>Knowledge base</NavItem>
            <div className="sec">Organisation</div>
            <NavItem to="/people" icon={Users}>Teams</NavItem>
            {role === 'ADMIN' && <NavItem to="/settings" icon={Settings}>Settings</NavItem>}
          </>}
        </nav>
      </aside>
      <div className="j-main main">
        <main id="main" className={`content ${wide ? 'wide' : ''}`} tabIndex={-1}><Outlet /></main>
      </div>
    </div>
  );
}
