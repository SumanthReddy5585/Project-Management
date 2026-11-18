// Main business workflow through the real UI. Requires demo seed data (backend: npm run seed:demo).
import { test, expect } from '@playwright/test';

const PW = process.env.E2E_PASSWORD || 'Demo-pass-2026';
const code = `E${Date.now().toString(36).slice(-6).toUpperCase()}`;

async function login(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('.sidebar')).toBeVisible();
}

test.describe.serial('manager → client → request workflow', () => {
  let projectUrl; let ticketUrl;

  test('manager creates a client project and adds tasks', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto('/projects?new=1');
    await page.getByLabel('Project name').fill(`E2E Portal ${code}`);
    await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Contoso Retail' });
    await page.getByRole('button', { name: /Next: choose team/ }).click();
    await page.getByRole('checkbox', { name: 'Add Ravi Developer' }).check();
    await page.getByRole('button', { name: /Next: review/ }).click();
    await expect(page.getByText('Ravi Developer · Member')).toBeVisible();
    await page.getByLabel(/Let the client follow this project/).check();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`E2E Portal ${code}`) })).toBeVisible();
    await expect(page.getByText('Initiation & project setup').first()).toBeVisible();
    projectUrl = page.url().replace(/\/$/, '');

    // one task shared with the client and one team-only task, added with quick-add
    await page.locator('nav.tabs').getByRole('link', { name: /^Team/ }).click();
    await expect(page.getByRole('cell', { name: /Ravi Developer/ })).toBeVisible();
    await page.getByRole('link', { name: 'Tasks', exact: true }).click();
    for (const [title, shared] of [['Shared onboarding task', true], ['Internal pricing review', false]]) {
      await page.getByLabel('New task title').fill(title);
      await page.getByLabel('New task title').press('Enter');
      await page.getByRole('button', { name: title, exact: true }).click();
      const share = page.locator('.drawer').getByRole('switch');
      if (shared) await share.check(); else await expect(share).not.toBeChecked();
      await expect(share).toBeChecked({ checked: shared });
      await page.getByRole('button', { name: 'Close panel' }).click();
    }
    // tick one off from the list
    await page.getByRole('button', { name: 'Mark Internal pricing review as done' }).click();
    await page.getByRole('group', { name: 'Which tasks' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Mark Internal pricing review as not done' })).toBeVisible();
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
