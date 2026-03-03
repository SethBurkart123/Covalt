import { expect, test } from '@playwright/test';

test.describe('playwright foundation discovery', () => {
  test('loads chat shell on mission frontend port', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/covalt/i);
    await expect(page.locator('[data-testid="chat-input-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="chat-input-editor"] [contenteditable="true"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="chat-input-submit"]')).toBeVisible();
  });
});
