import { readFile } from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchLaneChromium, openLanePage } from '../lane/browser.ts';
import {
  fixtureSuiteFile,
  startFixtureSite,
  type RunningFixtureSite,
} from '../testing/fixture-site.ts';
import { decideFinish, runChecks, type Check } from './checks.ts';
import { parseSuite, type Scenario } from './parse.ts';
import { resolveStartUrl } from './start-url.ts';

const setupTimeout = 30_000;
const testTimeout = 20_000;
const checkTimeoutMs = 2_000;

let site: RunningFixtureSite;
let browser: Browser;
let scenarios: Map<string, Scenario>;

beforeAll(async () => {
  const parsed = parseSuite(await readFile(fixtureSuiteFile, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.errors.map((error) => error.message).join('\n'));
  scenarios = new Map(parsed.suite.scenarios.map((scenario) => [scenario.id, scenario]));
  [site, browser] = await Promise.all([startFixtureSite(), launchLaneChromium('webmcp')]);
}, setupTimeout);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

let page: Page;

beforeEach(async () => {
  page = await openLanePage(browser, { actionTimeoutMs: 2_000, navigationTimeoutMs: 5_000 });
});

afterEach(async () => {
  await page?.context().close();
});

function scenario(id: string): Scenario {
  const found = scenarios.get(id);
  if (!found) throw new Error(`no Scenario ${id} in the fixture Suite`);
  return found;
}

async function start(id: string): Promise<Scenario> {
  const found = scenario(id);
  await page.goto(resolveStartUrl(site.baseUrl, found));
  return found;
}

async function checksPass(found: Scenario, answer = ''): Promise<boolean> {
  return (await runChecks(page, found.success ?? [], answer, { timeoutMs: checkTimeoutMs })).pass;
}

async function addOnHomePage(title: string): Promise<void> {
  await page.goto(`${site.baseUrl}/`);
  await page.getByLabel('New to-do').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByRole('status').filter({ hasText: 'Added' }).waitFor();
}

describe('fixture Suite checks on the fixture site', () => {
  it(
    'first-open-todo: answerContains decides on the answer',
    async () => {
      const found = await start('first-open-todo');
      expect(await checksPass(found, 'The first to-do is: Water the plants.')).toBe(true);
      const decision = await runChecks(page, found.success!, 'Pay the electricity bill.');
      expect(decision).toMatchObject({
        pass: false,
        reason: 'check failed: answerContains: Water the plants',
      });
    },
    testTimeout,
  );

  it(
    'add-todo: the script check fails before and passes after',
    async () => {
      const found = await start('add-todo');
      expect(await checksPass(found)).toBe(false);

      await addOnHomePage('Buy bread');
      expect(await checksPass(found)).toBe(false);
      await addOnHomePage('Buy milk');
      expect(await checksPass(found)).toBe(true);
    },
    testTimeout,
  );

  it(
    'add-todo: passes on the WebMCP route, which stays on the start page',
    async () => {
      const found = await start('add-todo');
      await page.webmcp.callTool('add_todo', { title: 'Buy milk' }, { timeout: checkTimeoutMs });
      expect(page.url()).toBe(`${site.baseUrl}/`);
      expect(await checksPass(found)).toBe(true);
    },
    testTimeout,
  );

  it(
    'create-from-new-page: starts on its path and checks the list',
    async () => {
      const found = await start('create-from-new-page');
      expect(page.url()).toBe(`${site.baseUrl}/new`);
      expect(await checksPass(found)).toBe(false);

      await page.getByLabel('Title').fill('Call the bank');
      await page.getByRole('button', { name: 'Create' }).click();
      await page.waitForURL(`${site.baseUrl}/`);
      expect(await checksPass(found)).toBe(true);
    },
    testTimeout,
  );

  it(
    'finish-watering: a script that returns undefined fails, then passes after the click',
    async () => {
      const found = await start('finish-watering');
      const before = await runChecks(page, found.success!, '', { timeoutMs: checkTimeoutMs });
      expect(before).toMatchObject({
        pass: false,
        reason: `check failed: script: ${(found.success![0] as { script: string }).script}`,
        checks: [{ pass: false, detail: 'returned undefined' }],
      });

      await page.getByRole('button', { name: 'Mark done' }).first().click();
      await page.getByRole('status').filter({ hasText: 'Marked' }).waitFor();
      expect(await checksPass(found)).toBe(true);
    },
    testTimeout,
  );
});

describe('page checks on the fixture site', () => {
  it(
    'urlContains, textVisible and elementExists read the final page',
    async () => {
      await page.goto(`${site.baseUrl}/done`);

      const passing: Check[] = [
        { urlContains: '/done' },
        { textVisible: 'book a DENTIST appointment' },
        { textVisible: 'Done (1)' },
        { elementExists: 'main ul li' },
        { elementExists: 'a[href="/new"]' },
      ];
      expect(await runChecks(page, passing, '', { timeoutMs: checkTimeoutMs })).toMatchObject({
        pass: true,
      });

      const failing: [Check, string][] = [
        [{ urlContains: '/new' }, `final URL: ${site.baseUrl}/done`],
        [{ urlContains: '/DONE' }, `final URL: ${site.baseUrl}/done`],
        [{ textVisible: 'Water the plants' }, 'text not visible'],
        [{ textVisible: 'WebMCP: on' }, 'text not visible'],
        [{ elementExists: '#add-todo' }, 'no matching element'],
      ];
      for (const [check, detail] of failing) {
        const decision = await runChecks(page, [check], '', { timeoutMs: checkTimeoutMs });
        expect(decision.pass).toBe(false);
        expect(decision.checks[0]?.detail).toBe(detail);
      }
    },
    testTimeout,
  );

  it(
    'decideFinish uses the checks when given, otherwise the agent report',
    async () => {
      await page.goto(`${site.baseUrl}/done?from=test`);
      const finish = { success: false, answer: 'Done: Book a dentist appointment' };

      await expect(
        decideFinish(page, finish, [{ urlContains: 'from=test' }, { answerContains: 'dentist' }], {
          timeoutMs: checkTimeoutMs,
        }),
      ).resolves.toMatchObject({ pass: true });
      await expect(decideFinish(page, finish, undefined)).resolves.toMatchObject({
        pass: false,
        reason: 'agent reported failure',
      });
    },
    testTimeout,
  );
});
