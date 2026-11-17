import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Tabs } from '../components/ui.jsx';
import { Timesheet, Approvals } from './Time.jsx';

export default function TimePage() {
  const { role } = useAuth();
  const [params, setParams] = useSearchParams();
  const canApprove = ['ADMIN', 'MANAGER'].includes(role);
  const tab = canApprove && params.get('tab') === 'approvals' ? 'approvals' : 'mine';
  return (
    <>
      <div className="page-header"><div><h1 className="h-page">Time</h1><div className="sub">Log your hours and send your week for approval.</div></div></div>
      {canApprove && <Tabs label="Time sections" value={tab} onChange={(k) => setParams(k === 'approvals' ? { tab: 'approvals' } : {})} tabs={[['mine', 'My week'], ['approvals', 'Approve timesheets']]} />}
      <div className="embedded">{tab === 'approvals' ? <Approvals /> : <Timesheet />}</div>
    </>
  );
}
