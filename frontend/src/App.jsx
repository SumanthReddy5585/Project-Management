import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { ToastProvider, Loading } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, AcceptInvite, ForgotPassword, ResetPassword } from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ProjectsList from './pages/ProjectsList.jsx';
import ProjectNew from './pages/ProjectNew.jsx';
import ProjectWorkspace from './pages/project/Workspace.jsx';
import { Overview } from './pages/project/Overview.jsx';
import { WorkList, Board } from './pages/project/Work.jsx';
import { Timeline, CalendarView, Milestones } from './pages/project/Schedule.jsx';
import { Deliverables, Updates, Discussions, ProjectFiles } from './pages/project/Engagement.jsx';
import { Registers, Team, ProjectSettings } from './pages/project/Manage.jsx';
import { TicketsList, TicketDetail } from './pages/Tickets.jsx';
import { Timesheet, Approvals } from './pages/Time.jsx';
import { Workload, People, NotificationsPage } from './pages/Resources.jsx';
import { AdminUsers, AdminCustomers, AdminCalendars, AdminTemplates, AdminTicketSettings, AdminAudit } from './pages/admin/Admin.jsx';

function Protected({ children }) {
  const { me } = useAuth();
  if (me === undefined) return <div className="p-5"><Loading /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}
function AdminOnly({ children }) { const { role } = useAuth(); return role === 'ADMIN' ? children : <Navigate to="/" replace />; }
function InternalOnly({ children }) { const { isCustomer } = useAuth(); return isCustomer ? <Navigate to="/" replace /> : children; }
function WorkRedirect() { const { projectId, itemId } = useParams(); return <Navigate to={`/projects/${projectId}/work?item=${itemId}`} replace />; }

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
              <Route index element={<Dashboard />} />
              <Route path="projects" element={<ProjectsList />} />
              <Route path="projects/new" element={<InternalOnly><ProjectNew /></InternalOnly>} />
              <Route path="projects/:projectId/work/:itemId" element={<WorkRedirect />} />
              <Route path="projects/:projectId" element={<ProjectWorkspace />}>
                <Route index element={<Overview />} />
                <Route path="work" element={<WorkList />} />
                <Route path="board" element={<Board />} />
                <Route path="timeline" element={<Timeline />} />
                <Route path="calendar" element={<CalendarView />} />
                <Route path="milestones" element={<Milestones />} />
                <Route path="deliverables" element={<Deliverables />} />
                <Route path="updates" element={<Updates />} />
                <Route path="discussions" element={<Discussions />} />
                <Route path="discussions/:discussionId" element={<Discussions />} />
                <Route path="files" element={<ProjectFiles />} />
                <Route path="registers" element={<Registers />} />
                <Route path="team" element={<Team />} />
                <Route path="settings" element={<ProjectSettings />} />
              </Route>
              <Route path="tickets" element={<TicketsList />} />
              <Route path="tickets/:ticketId" element={<TicketDetail />} />
              <Route path="time" element={<InternalOnly><Timesheet /></InternalOnly>} />
              <Route path="time/approvals" element={<InternalOnly><Approvals /></InternalOnly>} />
              <Route path="workload" element={<InternalOnly><Workload /></InternalOnly>} />
              <Route path="people" element={<InternalOnly><People /></InternalOnly>} />
              <Route path="notifications" element={<NotificationsPage />} />
              <Route path="admin/users" element={<AdminOnly><AdminUsers /></AdminOnly>} />
              <Route path="admin/customers" element={<AdminOnly><AdminCustomers /></AdminOnly>} />
              <Route path="admin/calendars" element={<AdminOnly><AdminCalendars /></AdminOnly>} />
              <Route path="admin/templates" element={<AdminOnly><AdminTemplates /></AdminOnly>} />
              <Route path="admin/ticket-settings" element={<AdminOnly><AdminTicketSettings /></AdminOnly>} />
              <Route path="admin/audit" element={<AdminOnly><AdminAudit /></AdminOnly>} />
              <Route path="*" element={<div className="empty"><h3>Page not found</h3></div>} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
