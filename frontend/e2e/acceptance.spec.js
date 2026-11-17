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
    await page.getByLabel(/Let the client follow this project/).check();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`E2E Portal ${code}`) })).toBeVisible();
    await expect(page.getByText('Initiation & project setup').first()).toBeVisible();
    projectUrl = page.url().replace(/\/$/, '');

    // one task shared with the client and one team-only task, added with quick-add
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

  test('client sends a request', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'New request' }).first().click();
    await page.getByLabel('Subject').fill(`Login page error ${code}`);
    await page.getByLabel('Details').fill('Error 500 after submitting the form');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByRole('heading', { name: `Login page error ${code}` })).toBeVisible();
    ticketUrl = page.url();
  });

  test('team replies to the client and adds a team-only note', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto(ticketUrl);
    await page.getByLabel('Reply', { exact: true }).fill('We are on it — can you share a screenshot?');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText('can you share a screenshot')).toBeVisible();
    await page.getByRole('button', { name: 'Team-only note' }).click();
    await page.getByLabel('Reply', { exact: true }).fill(`SECRET-NOTE-${code}: suspect the auth proxy`);
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText(`SECRET-NOTE-${code}`)).toBeVisible();
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
