import { useNavigate, useParams } from 'react-router-dom';
import { Tabs } from '../components/ui.jsx';
import { AdminUsers, AdminCustomers, AdminCalendars, AdminTemplates, AdminTicketSettings, AdminAudit } from './admin/Admin.jsx';
import { AdminCanned } from './admin/Canned.jsx';

const TABS = [['users', 'Users & roles', AdminUsers], ['customers', 'Clients', AdminCustomers], ['ticket-settings', 'SLA & categories', AdminTicketSettings], ['canned', 'Canned replies', AdminCanned],
  ['templates', 'Project templates', AdminTemplates], ['calendars', 'Working hours', AdminCalendars], ['audit', 'Audit log', AdminAudit]];

export default function SettingsPage() {
  const { tab = 'users' } = useParams();
  const nav = useNavigate();
  const current = TABS.find((t) => t[0] === tab) || TABS[0];
  const C = current[2];
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Settings</h1><div className="sub">Users, clients, SLA targets and how your support desk works.</div></div></div>
      <Tabs label="Settings sections" tabs={TABS} value={current[0]} onChange={(k) => nav(`/settings/${k}`)} />
      <div className="embedded"><C /></div>
    </>
  );
}
