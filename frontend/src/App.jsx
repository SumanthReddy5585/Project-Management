import { BrowserRouter, Navigate, Route, Routes, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ToastProvider, Loading, Empty } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, AcceptInvite, ForgotPassword, ResetPassword, FirstPasswordGate } from './pages/Auth.jsx';
import Profile from './pages/Profile.jsx';
import Home from './pages/Home.jsx';
import MyTasks from './pages/MyTasks.jsx';
import Projects from './pages/Projects.jsx';
import Reports from './pages/Reports.jsx';
import SettingsPage from './pages/Settings.jsx';
import TimePage from './pages/TimePage.jsx';
import ProjectWorkspace from './pages/project/Workspace.jsx';
import { Overview } from './pages/project/Overview.jsx';
import { TasksTab } from './pages/project/Work.jsx';
import { Deliverables, UpdatesTab, ProjectFiles } from './pages/project/Engagement.jsx';
import { Registers, Team, ProjectSettings, Activity } from './pages/project/Manage.jsx';
import { StatusReport } from './pages/project/Report.jsx';
import { PlanTab } from './pages/project/Plan.jsx';
import ResourcePlanner from './pages/Planner.jsx';
import { TicketsList, TicketDetail } from './pages/Tickets.jsx';
import { People, NotificationsPage } from './pages/Resources.jsx';
import { KnowledgeBase, KnowledgeArticle } from './pages/Knowledge.jsx';

function Protected({ children }) {
  const { me } = useAuth();
  const loc = useLocation();
  if (me === undefined) return <div className="p-5"><Loading /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.mustChangePassword) return <FirstPasswordGate />;
  return children;
}
function AdminOnly({ children }) { const { role } = useAuth(); return role === 'ADMIN' ? children : <Navigate to="/" replace />; }
function InternalOnly({ children }) { const { isCustomer } = useAuth(); return isCustomer ? <Navigate to="/" replace /> : children; }
function ManagerOnly({ children }) { const { role } = useAuth(); return ['ADMIN', 'MANAGER'].includes(role) ? children : <Navigate to="/" replace />; }
/** Old links (notifications, bookmarks) keep working after the navigation was simplified. */
function Redirect({ to }) {
  const p = useParams();
  const loc = useLocation();
  return <Navigate to={to.replace(/:(\w+)/g, (_, k) => p[k]) + loc.search} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={<Home />} />
              <Route path="my-tasks" element={<InternalOnly><MyTasks /></InternalOnly>} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/new" element={<Navigate to="/projects?new=1" replace />} />
              <Route path="projects/:projectId/work/:itemId" element={<Redirect to="/projects/:projectId/tasks?item=:itemId" />} />
              <Route path="projects/:projectId" element={<ProjectWorkspace />}>
                <Route index element={<Overview />} />
                <Route path="plan" element={<PlanTab />} />
                <Route path="tasks" element={<TasksTab />} />
                <Route path="approvals" element={<Deliverables />} />
                <Route path="files" element={<ProjectFiles />} />
                <Route path="updates" element={<UpdatesTab />} />
                <Route path="updates/:discussionId" element={<UpdatesTab />} />
                <Route path="risks" element={<Registers />} />
                <Route path="team" element={<Team />} />
                <Route path="settings" element={<ProjectSettings />} />
                <Route path="activity" element={<Activity />} />
                <Route path="report" element={<StatusReport />} />
                {['work', 'board', 'timeline', 'calendar', 'milestones'].map((p) => <Route key={p} path={p} element={<Redirect to="/projects/:projectId/tasks" />} />)}
                <Route path="deliverables" element={<Redirect to="/projects/:projectId/approvals" />} />
                <Route path="discussions/:discussionId?" element={<Redirect to="/projects/:projectId/updates" />} />
                <Route path="registers" element={<Redirect to="/projects/:projectId/risks" />} />
              </Route>
              <Route path="tickets" element={<TicketsList />} />
              <Route path="tickets/:ticketId" element={<TicketDetail />} />
              <Route path="kb" element={<KnowledgeBase />} />
              <Route path="kb/:articleId" element={<KnowledgeArticle />} />
              <Route path="time" element={<InternalOnly><TimePage /></InternalOnly>} />
              <Route path="time/approvals" element={<Navigate to="/time?tab=approvals" replace />} />
              <Route path="reports" element={<ManagerOnly><Reports /></ManagerOnly>} />
              <Route path="workload" element={<Navigate to="/planner" replace />} />
              <Route path="planner" element={<ResourcePlanner />} />
              <Route path="people" element={<InternalOnly><People /></InternalOnly>} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="profile" element={<Profile />} />
              <Route path="settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
              <Route path="settings/:tab" element={<AdminOnly><SettingsPage /></AdminOnly>} />
              <Route path="admin/:tab" element={<Redirect to="/settings/:tab" />} />
              <Route path="*" element={<Empty title="Page not found">The link may be out of date.</Empty>} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
