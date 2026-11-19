// Main business workflow through the real UI. Requires demo seed data (backend: npm run seed:demo).
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PASSWORD || 'Demo-pass-2026';
const code = `E${Date.now().toString(36).slice(-6).toUpperCase()}`;

/** Open a project section: a visible tab, or an entry under "More". */
async function projectTab(page, name) {
  const nav = page.locator('nav.proj-tabs');
  await nav.getByRole('link', { name: 'Summary' }).waitFor();
  const link = nav.getByRole('link', { name });
  if (await link.count()) return link.first().click();
  await nav.locator('.more-wrap > button').click();
  await page.getByRole('menuitem', { name }).click();
}

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

test.describe.serial('manager → client → request workflow', () => {
  let projectUrl; let ticketUrl;

  test('manager creates a client project and adds tasks', async ({ page, browser }) => {
    await login(page, 'manager@demo.local');
    await page.goto('/projects?new=1');
    await page.getByLabel('Project name').fill(`E2E Portal ${code}`);
    // every project has a project director (approves) and a project manager (builds and runs it)
    await expect(page.getByRole('button', { name: /Next: choose team/ })).toBeDisabled();
    await page.getByLabel('Project director').selectOption({ label: 'Vikram Rao — Delivery Director' });
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Contoso Retail' });
    await page.getByRole('button', { name: /Next: choose team/ }).click();
    await page.getByRole('checkbox', { name: 'Add Ravi Developer' }).check();
    await page.getByRole('button', { name: /Next: review/ }).click();
    await expect(page.getByText('Ravi Developer · Member')).toBeVisible();
    await page.getByLabel(/Let the client follow this project/).check();
    await page.getByRole('button', { name: 'Create project & build plan' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`E2E Portal ${code}`) })).toBeVisible();
    await expect(page.locator('.plan-steps .ps.cur')).toContainText('Build the plan');
    projectUrl = page.url().replace(/\/plan$/, '');

    // build the plan in the simple builder: name · who · days · starts after — dates are calculated
    await expect(page.locator('.pb-stage-name').first()).toContainText('Plan');
    const addIn = async (title, days, { parallel = false, milestone = false } = {}) => {
      const row = page.locator('.pb-stage').first().locator('tr.pb-add');
      if (milestone) await row.getByRole('button', { name: /Milestone/ }).click();
      await row.getByLabel(/^New task in/).fill(title);
      if (!milestone) { await row.getByLabel('Who does the new task').selectOption({ index: 1 }); await row.getByLabel('Working days for the new task').fill(String(days)); }
      if (parallel) { await row.getByLabel('What the new task waits for').click(); await page.getByRole('button', { name: /At the same time as the previous task/ }).click(); }
      await row.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.locator(`.pb-table input[value="${title}"]`)).toBeVisible();
    };
    await addIn('Shared onboarding task', 3);
    await addIn('Internal pricing review', 2, { parallel: true });
    await addIn('Onboarding finished', 0, { milestone: true });
    const startOf = async (title) => page.locator('.pb-table tr', { has: page.locator(`input[value="${title}"]`) }).locator('td.c-date').first().innerText();
    expect(await startOf('Internal pricing review')).toBe(await startOf('Shared onboarding task')); // parallel: same start
    const finishOf = async (title) => page.locator('.pb-table tr', { has: page.locator(`input[value="${title}"]`) }).locator('td.c-date').nth(1).innerText();
    // the milestone waits for the previous task, so it falls on that task's last day
    expect(await startOf('Onboarding finished')).toBe(await finishOf('Internal pricing review'));
    // a longer task gets a later finish; the milestone keeps waiting for the task it follows
    const before = await finishOf('Shared onboarding task');
    const days = page.getByLabel(/^Working days for .+-\d+$/).first();
    await days.fill('6'); await days.press('Enter');
    await expect.poll(() => finishOf('Shared onboarding task')).not.toBe(before);
    expect(await startOf('Onboarding finished')).toBe(await finishOf('Internal pricing review'));
    await expect(page.locator('.pb-summary')).toContainText('Plan ends');
    // a sub-task under a task: it starts with its task and the task spans it
    await page.getByLabel(/^Add a sub-task to .+-1$/).click();
    await page.getByLabel('New sub-task of Shared onboarding task').fill('Welcome pack');
    await page.getByLabel('New sub-task of Shared onboarding task').press('Enter');
    await expect(page.locator('.pb-table input[value="Welcome pack"]')).toBeVisible();
    await expect(page.locator('.pb-summary')).toContainText('1 sub-task');
    await page.getByRole('button', { name: 'Done adding sub-tasks' }).click();
    // the manager cannot approve the plan; they send it to the director
    await expect(page.getByRole('button', { name: /Approve & lock/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Send for approval' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Send for approval' }).click();
    await expect(page.locator('.ready-bar.wait')).toContainText('Waiting for Vikram Rao');
    const planUrl = page.url();
    // the director approves and locks it
    const dctx = await browser.newContext(); const dir = await dctx.newPage();
    await login(dir, 'director@demo.local');
    await expect(dir.locator('.approvals-card')).toContainText(`E2E Portal ${code}`);
    await dir.goto(planUrl);
    await dir.getByRole('button', { name: 'Approve & lock plan' }).click();
    await dir.getByRole('dialog').getByRole('button', { name: 'Approve & lock' }).click();
    await expect(dir.locator('.locked-bar')).toContainText('Vikram Rao');
    await dctx.close();
    await page.reload();
    await expect(page.locator('.locked-bar')).toContainText('Plan approved on');
    await expect(page.locator('.status-banner')).toContainText('On schedule');

    // one task shared with the client and one team-only task, added with quick-add
    await projectTab(page, /^Team/);
    await expect(page.getByRole('cell', { name: /Ravi Developer/ })).toBeVisible();
    await projectTab(page, 'Backlog');
    for (const [title, shared] of [['Shared onboarding task', true], ['Internal pricing review', false]]) {
      await page.getByRole('button', { name: title, exact: true }).click();
      const share = page.locator('.issue').getByRole('switch');
      if (shared) await share.check(); else await expect(share).not.toBeChecked();
      await expect(share).toBeChecked({ checked: shared });
      await page.locator('.issue').getByRole('button', { name: 'Close', exact: true }).click();
    }
    // tick one off from the list
    await page.getByRole('button', { name: 'Mark Internal pricing review as done' }).first().click();
    await page.getByRole('group', { name: 'Which tasks' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Mark Internal pricing review as not done' }).first()).toBeVisible();
  });

  test('client sees the shared task but never the team-only one', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto(`${projectUrl}/tasks`);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Shared onboarding task', exact: true })).toBeVisible();
    await expect(page.getByText('Internal pricing review')).toHaveCount(0);
    await expect(page.getByText('Budget')).toHaveCount(0);
  });

  test('client raises a ticket', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'Raise a ticket' }).first().click();
    await page.getByLabel('Subject').fill(`Login page error ${code}`);
    await page.getByLabel('Description').fill('Error 500 after submitting the form');
    await page.getByRole('button', { name: 'Submit ticket' }).click();
    await expect(page.getByRole('heading', { name: `Login page error ${code}` })).toBeVisible();
    ticketUrl = page.url();
  });

  test('agent picks up the ticket, replies with a canned reply and adds an internal note', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto(ticketUrl);
    await page.getByRole('button', { name: 'Assign to me' }).click();
    await expect(page.getByLabel('Assignee')).toHaveValue(/.+/);
    await page.getByRole('button', { name: 'Canned reply' }).click();
    await page.getByRole('button', { name: /Need more information/ }).click();
    await expect(page.getByLabel('Reply', { exact: true })).toHaveValue(/To move this forward/);
    await page.getByLabel('Reply', { exact: true }).fill('We are on it — can you share a screenshot?');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText('can you share a screenshot')).toBeVisible();
    await page.getByRole('tab', { name: 'Internal note' }).click();
    await page.getByLabel('Internal note', { exact: true }).fill(`SECRET-NOTE-${code}: suspect the auth proxy`);
    await page.getByRole('button', { name: 'Add note' }).click();
    await expect(page.getByText(`SECRET-NOTE-${code}`)).toBeVisible();
  });

  test('client sees the agent reply appear live, without reloading', async ({ browser }) => {
    const client = await browser.newPage();
    await login(client, 'customer@demo.local');
    await client.goto(ticketUrl);
    await expect(client.getByText('can you share a screenshot')).toBeVisible();
    const agent = await browser.newPage();
    await login(agent, 'manager@demo.local');
    await agent.goto(ticketUrl);
    await agent.getByLabel('Reply', { exact: true }).fill(`LIVE-${code} screenshot received, thanks`);
    await agent.getByRole('button', { name: 'Send reply' }).click();
    await expect(client.getByText(`LIVE-${code}`)).toBeVisible({ timeout: 10000 });
    await client.close(); await agent.close();
  });

  test('agent resolves; client rates the ticket', async ({ browser }) => {
    const agent = await browser.newPage();
    await login(agent, 'manager@demo.local');
    await agent.goto(ticketUrl);
    await agent.getByRole('button', { name: 'Resolve' }).click();
    await expect(agent.locator('.ticket-head').getByText('Resolved')).toBeVisible();
    await agent.close();
    const client = await browser.newPage();
    await login(client, 'customer@demo.local');
    await client.goto(ticketUrl);
    await client.getByRole('radio', { name: '5 stars' }).click();
    await client.getByRole('button', { name: 'Submit rating' }).click();
    await expect(client.getByText('Your rating')).toBeVisible();
    await client.close();
  });

  test('customer sees the public reply but not the internal note', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto(ticketUrl);
    await expect(page.getByText('can you share a screenshot')).toBeVisible();
    await expect(page.getByText(`SECRET-NOTE-${code}`)).toHaveCount(0);
  });

  test('another customer cannot open the project or ticket by URL', async ({ page }) => {
    await login(page, 'fabrikam@demo.local');
    await page.goto(projectUrl);
    await expect(page.getByText(/Not found or you no longer have access/)).toBeVisible();
    await page.goto(ticketUrl);
    await expect(page.getByText(/Not found or you no longer have access/)).toBeVisible();
  });
});

test.describe('planning tools', () => {
  test('manager edits tasks in the table, sees the Gantt links, risk matrix, status report and resource planner', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto('/projects');
    await page.getByRole('link', { name: /Contoso Store Modernization/ }).first().click();
    await projectTab(page, 'List');
    const status = page.getByLabel('Status of Requirements specification');
    await status.selectOption('IN_REVIEW');
    await expect(page.getByText(/Someone else changed|can only update/)).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Status of Requirements specification')).toHaveValue('IN_REVIEW');
    await projectTab(page, 'Timeline');
    await expect(page.locator('.gantt-link').first()).toBeAttached();
    await projectTab(page, 'Risks & issues');
    await expect(page.getByRole('grid', { name: 'Risk matrix' })).toBeVisible();
    await page.getByRole('button', { name: 'Project actions' }).click();
    await page.getByRole('menuitem', { name: /Status report/ }).click();
    await expect(page.getByText('Project status report', { exact: false })).toBeVisible();
    await expect(page.getByText('Top risks')).toBeVisible();
    await page.goto('/planner');
    await expect(page.getByRole('heading', { name: 'Resource planner' })).toBeVisible();
    await expect(page.locator('.planner tbody tr').first()).toBeVisible();
  });
});

test.describe('changing task dates in the table', () => {
  const shift = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ddmmyyyy = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
  const toDay = async (input) => { await input.focus(); for (let k = 0; k < 4; k++) await input.press('ArrowLeft'); }; // start at the day part
  const typeDate = async (page, input, iso) => { await toDay(input); await page.keyboard.type(ddmmyyyy(iso), { delay: 60 }); };

  test('typing a date saves it once, keeps lengths, moves dependents automatically and never saves half-typed dates', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/dates') || (r.method() === 'PATCH' && r.url().includes('/work-items/'))) calls.push(r.postDataJSON()); });
    await login(page, 'manager@demo.local');
    await page.goto('/projects');
    await page.getByRole('link', { name: /Customer Mobile App/ }).first().click();
    await projectTab(page, 'List');

    // 1. Type a new due date digit by digit: exactly one save, with the full date.
    const due = page.getByLabel('Due date of Push notifications');
    const oldDue = await due.inputValue();
    const newDue = shift(oldDue, 3);
    await typeDate(page, due, newDue);
    await due.press('Tab');
    await expect(page.getByText(/^Push notifications: (dates saved|.*moved)/)).toBeVisible();
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ plannedFinish: newDue });
    await page.reload();
    await expect(page.getByLabel('Due date of Push notifications')).toHaveValue(newDue);

    // 2. A half-typed date is never saved and the old value comes back.
    calls.length = 0;
    const d2 = page.getByLabel('Due date of Push notifications');
    await toDay(d2); await d2.press('Backspace'); // clears the day: the browser now reports the date as incomplete
    await d2.press('Tab');
    await expect(d2).toHaveValue(newDue);
    expect(calls.length).toBe(0);

    // 3. A due date before the start is refused with a clear message; nothing changes.
    const start = await page.getByLabel('Start of Push notifications').inputValue();
    await typeDate(page, d2, shift(start, -2));
    await d2.press('Tab');
    await expect(page.getByText(/can't be before the start date/)).toBeVisible();
    await expect(d2).toHaveValue(newDue);

    // 4. Moving the start of a task that others depend on: the due date keeps the length and everything that waits for it moves automatically.
    const pay = page.getByLabel('Start of Payments & transfers API');
    const payStart = await pay.inputValue(); const payDue = await page.getByLabel('Due date of Payments & transfers API').inputValue();
    const pen = await page.getByLabel('Start of Security penetration test').inputValue();
    await typeDate(page, pay, shift(payStart, 7));
    await pay.press('Tab');
    await expect(page.getByText(/Payments & transfers API: due date moved to .*wait.* for it moved later/)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    expect(await page.getByLabel('Start of Payments & transfers API').inputValue()).toBe(shift(payStart, 7));
    expect(await page.getByLabel('Due date of Payments & transfers API').inputValue()).toBe(shift(payDue, 7)); // same weekday, same length
    expect(await page.getByLabel('Start of Security penetration test').inputValue() > pen).toBe(true);

    // 5. The Plan tab now reports the moved work against the approved plan.
    await projectTab(page, 'Plan vs original');
    await page.getByRole('tab', { name: /Late/ }).click();
    await expect(page.locator('.cmp-table')).toContainText('Payments & transfers API');
  });
});
