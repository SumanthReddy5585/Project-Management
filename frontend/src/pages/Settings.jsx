import { useNavigate, useParams } from 'react-router-dom';
import { Tabs } from '../components/ui.jsx';
import { AdminUsers, AdminCustomers, AdminCalendars, AdminTemplates, AdminTicketSettings, AdminAudit } from './admin/Admin.jsx';

const TABS = [['users', 'People and access', AdminUsers], ['customers', 'Clients', AdminCustomers], ['templates', 'Project plans', AdminTemplates],
  ['ticket-settings', 'Requests', AdminTicketSettings], ['calendars', 'Working days', AdminCalendars], ['audit', 'Activity log', AdminAudit]];

export default function SettingsPage() {
  const { tab = 'users' } = useParams();
  const nav = useNavigate();
  const current = TABS.find((t) => t[0] === tab) || TABS[0];
  const C = current[2];
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Settings</h1><div className="sub">Manage who has access and how your workspace works.</div></div></div>
      <Tabs label="Settings sections" tabs={TABS} value={current[0]} onChange={(k) => nav(`/settings/${k}`)} />
      <div className="embedded"><C /></div>
    </>
  );
}
