// Initializes a new organization with defaults: calendar, default template, SLA policies, categories.
export const DEFAULT_PHASES = [
  ['Initiation & project setup', 5, 'Charter approved; team and tools set up', ['Project charter approved'], ['Project charter']],
  ['Kickoff', 2, 'Kickoff held with stakeholders', ['Kickoff complete'], ['Kickoff deck']],
  ['Requirements & discovery', 10, 'Requirements signed off', ['Requirements signed off'], ['Requirements specification']],
  ['Planning', 5, 'Plan baselined', ['Plan baselined'], ['Project plan']],
  ['Design', 10, 'Design approved', ['Design approved'], ['Design document']],
  ['Development / implementation', 25, 'All scoped work built', [], []],
  ['Testing & quality assurance', 10, 'Exit criteria met; no open critical defects', ['QA sign-off'], ['Test report']],
  ['User acceptance testing', 5, 'Customer accepts the solution', ['UAT sign-off'], ['UAT sign-off record']],
  ['Deployment / delivery', 3, 'Solution live or delivered', ['Go-live'], ['Release notes']],
  ['Handover & closure', 5, 'Handover done; lessons learned recorded', ['Project closed'], ['Closure report']],
];

export async function initializeOrganization(tx, orgId) {
  await tx.workingCalendar.create({ data: { organizationId: orgId, name: 'Standard (Mon–Fri, 09:00–17:00)', isDefault: true, timezone: 'UTC' } });
  await tx.projectTemplate.create({
    data: {
      organizationId: orgId, name: 'Standard delivery lifecycle', isDefault: true,
      description: 'Ten-phase lifecycle suitable for software and non-software delivery projects.',
      phases: { create: DEFAULT_PHASES.map(([name, durationDays, completionCriteria, milestones, deliverables], i) => ({ name, sortOrder: i, durationDays, completionCriteria, milestones, deliverables })) },
    },
  });
  await tx.projectTemplate.create({
    data: { organizationId: orgId, name: 'Simple (Plan / Execute / Close)', phases: { create: [
      { name: 'Plan', sortOrder: 0, durationDays: 5, milestones: ['Plan approved'] },
      { name: 'Execute', sortOrder: 1, durationDays: 20, milestones: [] },
      { name: 'Close', sortOrder: 2, durationDays: 3, milestones: ['Closed'] }] } },
  });
  const sla = { LOW: [960, 4800], MEDIUM: [480, 2400], HIGH: [240, 960], CRITICAL: [60, 480] };
  await tx.slaPolicy.createMany({ data: Object.entries(sla).map(([priority, [r, s]]) => ({ organizationId: orgId, priority, responseMinutes: r, resolutionMinutes: s })) });
  await tx.ticketCategory.createMany({ data: ['General', 'Access & accounts', 'Defect', 'Enhancement', 'Billing'].map((name) => ({ organizationId: orgId, name })) });
}
