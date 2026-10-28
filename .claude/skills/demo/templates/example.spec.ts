import { test, expect } from '@playwright/test';

test('feature demo', async ({ page }) => {
  await page.goto('/');
  await page.waitForTimeout(800);
  await expect(page).toHaveTitle(/.+/);
});
