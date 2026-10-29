import { test, expect } from '@playwright/test';

// Walkthrough of the Setup page. Doubles as a smoke test and as the demo video.
// The default Suite is ../app/suite.yaml, so the Scenario count is read from the page.
test('setup page: pick scenarios and provider', async ({ page }) => {
  await page.goto('/');
  const status = page.getByText(/^Valid Suite, \d+ Scenarios?$/);
  await expect(status).toBeVisible();
  const count = Number(/\d+/.exec((await status.textContent()) ?? '')?.[0]);
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Select all' }).click();
  await expect(page.getByText(`${count} of ${count} selected`)).toBeVisible();
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Select none' }).click();
  await expect(page.getByText(`0 of ${count} selected`)).toBeVisible();
  await page.waitForTimeout(800);

  await page.getByLabel('Provider').selectOption('openai');
  await page.waitForTimeout(800);

  await expect(page.getByRole('button', { name: /^Run/ })).toBeDisabled();
  await page.waitForTimeout(800);
});
