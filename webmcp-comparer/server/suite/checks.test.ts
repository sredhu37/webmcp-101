import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideFinish, describeCheck, evaluateCheck, runChecks, type Check } from './checks.ts';

const CART_PAGE = `<!doctype html>
<html>
  <head><title>Cart</title></head>
  <body>
    <h1>Your  Cart</h1>
    <ul id="cart"><li class="item" data-id="red-shirt-basic">Red Shirt, size M</li></ul>
    <p style="display: none">Secret discount</p>
    <script>
      window.shop = {
        cart: () => [{ productId: 'red-shirt-basic', size: 'M', qty: 1 }],
        lastOrder: () => null,
      };
    </script>
  </body>
</html>`;

const TIMEOUT_MS = 2_000;

describe('Success checks', () => {
  let server: Server;
  let siteUrl: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(request.url?.startsWith('/cart') ? CART_PAGE : '<!doctype html><p>Home</p>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    siteUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true, timeout: 30_000 });
    page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
  }, 40_000);

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach(async () => {
    await page.goto(`${siteUrl}/cart?step=2`, { timeout: TIMEOUT_MS });
  });

  async function check(c: Check, answer = ''): Promise<boolean> {
    return (await evaluateCheck(page, c, answer, TIMEOUT_MS)).pass;
  }

  it('urlContains matches a substring of the final URL, case-sensitive', async () => {
    expect(await check({ urlContains: '/cart' })).toBe(true);
    expect(await check({ urlContains: 'step=2' })).toBe(true);
    expect(await check({ urlContains: '/CART' })).toBe(false);
    expect(await check({ urlContains: '/checkout' })).toBe(false);
  });

  it('textVisible matches visible text, case-insensitive', async () => {
    expect(await check({ textVisible: 'your cart' })).toBe(true);
    expect(await check({ textVisible: 'RED SHIRT, size m' })).toBe(true);
    expect(await check({ textVisible: 'Secret discount' })).toBe(false);
    expect(await check({ textVisible: 'Order placed' })).toBe(false);
  });

  it('elementExists matches a CSS selector', async () => {
    expect(await check({ elementExists: '#cart .item[data-id="red-shirt-basic"]' })).toBe(true);
    expect(await check({ elementExists: '#cart .empty' })).toBe(false);
    const invalid = await evaluateCheck(page, { elementExists: '##' }, '', TIMEOUT_MS);
    expect(invalid.pass).toBe(false);
    expect(invalid.detail).toBeTruthy();
  });

  it('script passes only when the expression evaluates to true', async () => {
    expect(
      await check({
        script: "shop.cart().some(i => i.productId === 'red-shirt-basic' && i.size === 'M')",
      }),
    ).toBe(true);
    expect(await check({ script: 'Promise.resolve(true)' })).toBe(true);
    expect(await check({ script: "shop.lastOrder()?.items.some(i => i.productId === 'x')" })).toBe(
      false,
    );
    expect(await check({ script: 'shop.cart().length' })).toBe(false);

    const thrown = await evaluateCheck(page, { script: 'missing.call()' }, '', TIMEOUT_MS);
    expect(thrown).toMatchObject({ pass: false });
    expect(thrown.detail).toContain('missing');
  });

  it('script times out instead of hanging', async () => {
    const result = await evaluateCheck(page, { script: 'new Promise(() => {})' }, '', 200);
    expect(result).toEqual({
      check: { script: 'new Promise(() => {})' },
      pass: false,
      detail: 'timed out after 200 ms',
    });
  });

  it('answerContains matches the finish answer, case-insensitive', async () => {
    expect(
      await check({ answerContains: '19.99' }, 'The cheapest red shirt costs EUR 19.99.'),
    ).toBe(true);
    expect(await check({ answerContains: 'added to cart' }, 'Added  to Cart: red shirt')).toBe(
      true,
    );
    expect(await check({ answerContains: '19.99' }, 'It costs 24.99')).toBe(false);
  });

  it('runChecks passes only when every check passes and names the first failure', async () => {
    const checks: Check[] = [
      { urlContains: '/cart' },
      { textVisible: 'Order placed' },
      { answerContains: 'done' },
    ];
    const passed = await runChecks(page, checks.slice(0, 1), 'done', { timeoutMs: TIMEOUT_MS });
    expect(passed.pass).toBe(true);

    const failed = await runChecks(page, checks, 'nothing', { timeoutMs: TIMEOUT_MS });
    expect(failed).toMatchObject({
      pass: false,
      reason: 'check failed: textVisible: Order placed',
    });
    expect(failed.checks.map((result) => result.pass)).toEqual([true, false, false]);
  });

  it('decideFinish lets the checks decide when present', async () => {
    const checks: Check[] = [{ elementExists: '#cart' }];
    expect(
      await decideFinish(page, { success: false, answer: '' }, checks, { timeoutMs: TIMEOUT_MS }),
    ).toMatchObject({ pass: true });
    expect(
      await decideFinish(page, { success: true, answer: '' }, [{ urlContains: '/checkout' }], {
        timeoutMs: TIMEOUT_MS,
      }),
    ).toMatchObject({ pass: false, reason: 'check failed: urlContains: /checkout' });
  });

  it("decideFinish uses the agent's finish(success) without checks", async () => {
    expect(await decideFinish(page, { success: true, answer: 'ok' }, undefined)).toEqual({
      pass: true,
      checks: [],
    });
    expect(await decideFinish(page, { success: false, answer: 'no' }, [])).toEqual({
      pass: false,
      reason: 'agent reported failure',
      checks: [],
    });
  });

  it('describes a check as written in the Suite', () => {
    expect(describeCheck({ urlContains: '/cart' })).toBe('urlContains: /cart');
  });
});
