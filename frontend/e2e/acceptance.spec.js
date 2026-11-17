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

test.describe.serial('manager → customer → ticket workflow', () => {
  let projectUrl; let ticketUrl;

  test('manager creates a shared project from the default template', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto('/projects/new');
    await page.getByLabel('Project name').fill(`E2E Portal ${code}`);
    await page.getByLabel('Code').fill(code);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Customer company').selectOption({ label: 'Contoso Retail' });
    await page.getByLabel('Carla Customer').check();
    await page.getByLabel(/Ravi Developer/).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Share with customer contacts').check();
    await page.getByLabel('Start as').selectOption('ACTIVE');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`E2E Portal ${code}`) })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Initiation & project setup/ })).toBeVisible();
    projectUrl = page.url();

    // one shared task and one internal-only task
    await page.getByRole('link', { name: 'Work', exact: true }).click();
    for (const [title, shared] of [['Shared onboarding task', true], ['Internal pricing review', false]]) {
      await page.getByRole('button', { name: 'New item' }).click();
      await page.getByLabel('Title').fill(title);
      if (shared) await page.getByLabel('Visible to customer').check();
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(page.getByRole('button', { name: title })).toBeVisible();
    }
  });

  test('customer sees the shared task but never the internal one', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto(`${projectUrl}/work`);
    await expect(page.getByRole('button', { name: 'Shared onboarding task' })).toBeVisible();
    await expect(page.getByText('Internal pricing review')).toHaveCount(0);
    await expect(page.getByText('Budget')).toHaveCount(0);
  });

  test('customer raises a ticket', async ({ page }) => {
    await login(page, 'customer@demo.local');
    await page.goto('/tickets');
    await page.getByRole('button', { name: 'New ticket' }).click();
    await page.getByLabel('Subject').fill(`Login page error ${code}`);
    await page.getByLabel('Description').fill('Error 500 after submitting the form');
    await page.getByRole('button', { name: 'Submit ticket' }).click();
    await expect(page.getByRole('heading', { name: `Login page error ${code}` })).toBeVisible();
    ticketUrl = page.url();
  });

  test('team replies publicly and adds an internal note', async ({ page }) => {
    await login(page, 'manager@demo.local');
    await page.goto(ticketUrl);
    await page.getByLabel('Reply').fill('We are on it — can you share a screenshot?');
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByText('can you share a screenshot')).toBeVisible();
    await page.getByRole('button', { name: 'Internal' }).first().click();
    await page.getByLabel('Reply').fill(`SECRET-NOTE-${code}: suspect the auth proxy`);
    await page.getByRole('button', { name: 'Add internal note' }).click();
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
