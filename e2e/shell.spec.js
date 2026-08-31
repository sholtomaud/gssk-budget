import { test, expect } from '@playwright/test';

/* REQ-APP-1/2. BaseComponent needs a DOM, so the contract every component
 * inherits is asserted here against a real browser rather than a simulated one.
 * The pure half — CSS scoping and the template tags — is unit-tested in
 * src/core/template-helpers.test.ts. */

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('the shell registers and renders from its external template', async ({ page }) => {
  await expect(page.locator('budget-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Household Budget' })).toBeVisible();
  await expect(page.locator('budget-shell #router-outlet')).toBeAttached();
});

/* The whole DOM strategy in one assertion. If this ever passes with a shadow
 * root present, every component's `this.querySelector` is silently broken. */
test('the shell renders into the light DOM and has no shadow root', async ({ page }) => {
  const shadow = await page.locator('budget-shell').evaluate((el) => el.shadowRoot);
  expect(shadow).toBeNull();

  /* Light DOM means the markup is reachable from the document, not just from
   * inside the element. */
  await expect(page.locator('budget-shell > .masthead')).toBeAttached();
});

test('the component stylesheet is scoped to the tag name, not left as :host', async ({ page }) => {
  const styleText = await page.locator('budget-shell style').first().innerText();
  expect(styleText).toContain('budget-shell');
  expect(styleText).not.toContain(':host');
});

/* ADR 2: hand-written CSS with custom properties. A missing token surfaces as
 * an unstyled page, which is easy to miss by eye and trivial to assert. */
test('the design tokens are in effect', async ({ page }) => {
  const ground = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--colour-ground').trim());
  expect(ground).not.toBe('');

  const body = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(body).not.toBe('rgba(0, 0, 0, 0)');
});

/* REQ-DATA-7 permits three network calls — Google OAuth, Google Drive and the
 * assistant — and all three are optional and none happens at load. A font, an
 * icon set or an analytics tag would be a fourth, so the scaffold asserts that
 * loading the page talks to nobody but its own origin. */
test('loading the page makes no third-party request', async ({ page, baseURL }) => {
  const foreign = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) foreign.push(request.url());
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});
