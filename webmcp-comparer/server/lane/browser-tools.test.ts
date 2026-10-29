import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { startFixtureSite, type RunningFixtureSite } from '../testing/fixture-site.ts';
import { launchLaneChromium, openLanePage, VIEWPORT } from './browser.ts';
import {
  BROWSER_TOOL_NAMES,
  createBrowserTools,
  type BrowserToolName,
  type BrowserToolTimeouts,
} from './browser-tools.ts';
import { ScreenshotFiles } from './screenshots.ts';
import { READ_PAGE_LIMIT, TRUNCATED } from './snapshot.ts';
import type { LaneTool, ToolResult } from './tool.ts';

const setupTimeout = 30_000;
const testTimeout = 20_000;
const timeouts: Partial<BrowserToolTimeouts> = {
  actionMs: 2_000,
  navigationMs: 5_000,
  waitForTextMs: 500,
  pauseMs: 50,
};

let site: RunningFixtureSite;
let browser: Browser;
let screenshotDir: string;

beforeAll(async () => {
  [site, browser, screenshotDir] = await Promise.all([
    startFixtureSite(),
    launchLaneChromium('baseline'),
    mkdtemp(join(tmpdir(), 'browser-tools-')),
  ]);
}, setupTimeout);

afterAll(async () => {
  await browser?.close();
  await site?.close();
  if (screenshotDir) await rm(screenshotDir, { recursive: true, force: true });
});

let page: Page;
let screenshots: ScreenshotFiles;
let tool: Record<BrowserToolName, LaneTool>;

function toolsFor(scenarioId: string, attempt: number): Record<BrowserToolName, LaneTool> {
  const list = createBrowserTools({ page, screenshots, scenarioId, attempt, timeouts });
  return Object.fromEntries(list.map((t) => [t.name, t])) as Record<BrowserToolName, LaneTool>;
}

beforeEach(async () => {
  page = await openLanePage(browser, { actionTimeoutMs: 2_000, navigationTimeoutMs: 5_000 });
  screenshots = new ScreenshotFiles(join(screenshotDir, crypto.randomUUID()));
  tool = toolsFor('first-open-todo', 1);
});

afterEach(async () => {
  await page?.context().close();
});

function text(result: ToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
}

async function open(path: string): Promise<void> {
  await page.goto(`${site.baseUrl}${path}`);
}

async function refOf(pattern: string): Promise<string> {
  const snapshot = text(await tool.read_page.execute({}));
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}[^\\n]*\\[ref=(\\w+)\\]`).exec(snapshot);
  if (!match) throw new Error(`no ref for ${pattern} in:\n${snapshot}`);
  return match[1]!;
}

async function center(selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Width and height from the first JPEG start-of-frame marker. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset < jpeg.length) {
    const marker = jpeg[offset + 1]!;
    const length = jpeg.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      return { height: jpeg.readUInt16BE(offset + 5), width: jpeg.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error('no JPEG frame header');
}

describe('Browser tools', () => {
  it('are the tools of the spec, each with an object input schema', () => {
    expect(Object.keys(tool)).toEqual([...BROWSER_TOOL_NAMES]);
    for (const t of Object.values(tool)) {
      expect(t.source).toBe('browser');
      expect(t.description).not.toBe('');
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it(
    'reject input that does not match the schema without touching the page',
    async () => {
      await open('/');
      const missing = await tool.click.execute({});
      expect(missing.isError).toBe(true);
      expect(text(missing)).toBe('Invalid input for click: missing required property "target".');

      const badEnum = await tool.scroll.execute({ direction: 'left' });
      expect(text(badEnum)).toBe(
        'Invalid input for scroll: direction must be one of "up", "down".',
      );

      const extra = await tool.navigate.execute({ url: '/done', newTab: true });
      expect(text(extra)).toBe('Invalid input for navigate: unknown property "newTab".');
      expect(page.url()).toBe(`${site.baseUrl}/`);
    },
    testTimeout,
  );
});

describe('screenshot', () => {
  it(
    'saves the viewport as JPEG with the per-Lane counter name and returns the image',
    async () => {
      await open('/');
      const first = await tool.screenshot.execute({});

      expect(first.isError).toBe(false);
      expect(first.meta.screenshot).toMatchObject({
        fileName: '001-first-open-todo-attempt-1.jpg',
        ...VIEWPORT,
      });
      const file = await readFile(first.meta.screenshot!.path);
      expect(file.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
      expect(jpegSize(file)).toEqual(VIEWPORT);
      expect(first.content).toEqual([
        { type: 'image', data: file.toString('base64'), mediaType: 'image/jpeg' },
      ]);

      await tool.read_page.execute({});
      const second = await toolsFor('add-todo', 2).screenshot.execute({});
      expect(second.meta.screenshot?.fileName).toBe('002-add-todo-attempt-2.jpg');
      expect(screenshots.count).toBe(2);
    },
    testTimeout,
  );
});

describe('read_page', () => {
  it(
    'returns the accessibility snapshot with refs, title and URL',
    async () => {
      await open('/');
      const result = await tool.read_page.execute({});
      const snapshot = text(result);

      expect(result.isError).toBe(false);
      expect(result.meta).toEqual({});
      expect(snapshot).toMatch(/^Page: To-dos \| To-do fixture\nURL: http:\/\/127\.0\.0\.1:\d+/);
      expect(snapshot).toContain('heading "To-dos" [level=1]');
      expect(snapshot).toMatch(/button "Add" \[ref=\w+\]/);
      expect(snapshot).toMatch(/combobox "Priority" \[ref=\w+\]/);
    },
    testTimeout,
  );

  it(
    `cuts the snapshot at ${READ_PAGE_LIMIT} characters`,
    async () => {
      await open('/');
      await page.evaluate(`(() => {
        const main = document.querySelector('main');
        for (let i = 0; i < 3000; i++) {
          const p = document.createElement('p');
          p.textContent = 'Filler paragraph number ' + i;
          main.append(p);
        }
      })()`);
      const snapshot = text(await tool.read_page.execute({}));

      expect(snapshot).toHaveLength(READ_PAGE_LIMIT + `\n${TRUNCATED}`.length);
      expect(snapshot.endsWith(`\n${TRUNCATED}`)).toBe(true);
    },
    testTimeout,
  );
});

describe('click', () => {
  it(
    'clicks by ref and reports the method',
    async () => {
      await open('/');
      const result = await tool.click.execute({
        target: { ref: await refOf('button "Mark done"') },
      });

      expect(result.isError).toBe(false);
      expect(result.meta).toEqual({ target: 'ref' });
      await expect(page.getByRole('status').textContent()).resolves.toBe(
        'Marked "Water the plants" done.',
      );
    },
    testTimeout,
  );

  it(
    'clicks by CSS selector and follows the navigation',
    async () => {
      await open('/');
      const result = await tool.click.execute({ target: { selector: '#done-link' } });

      expect(result.meta).toEqual({ target: 'selector' });
      expect(text(result)).toBe(
        `Clicked selector #done-link.\nPage: Done | To-do fixture (${site.baseUrl}/done)`,
      );
    },
    testTimeout,
  );

  it(
    'clicks by viewport coordinates',
    async () => {
      await open('/');
      const result = await tool.click.execute({ target: await center('#done-link') });

      expect(result.isError).toBe(false);
      expect(result.meta).toEqual({ target: 'coordinates' });
      expect(page.url()).toBe(`${site.baseUrl}/done`);
    },
    testTimeout,
  );

  it(
    'uses the first element when a selector matches several',
    async () => {
      await open('/');
      const count = await page.locator('#todos button').count();
      expect(count).toBeGreaterThan(1);

      const result = await tool.click.execute({ target: { selector: '#todos button' } });
      expect(text(result)).toContain(`(first of ${count} matches)`);
      await expect(page.evaluate('todos.list()[0].done')).resolves.toBe(true);
      await expect(page.evaluate('todos.list()[1].done')).resolves.toBe(false);
    },
    testTimeout,
  );

  it(
    'returns an error for a bad target and keeps the method',
    async () => {
      await open('/');
      const staleRef = await refOf('link "Done (1)"');
      await open('/done');

      const cases: [unknown, string, string | undefined][] = [
        [
          { ref: staleRef },
          `ref "${staleRef}" is not on the page; refs come from the latest read_page, call it again`,
          'ref',
        ],
        [{ ref: 'e9999' }, 'ref "e9999" is not on the page', 'ref'],
        [{ selector: '#nope' }, 'no element matches selector "#nope"', 'selector'],
        [{ selector: '###' }, 'invalid selector "###"', 'selector'],
        [{ x: 1280, y: 10 }, 'point (1280, 10) is outside the 1280 x 800 viewport', 'coordinates'],
        [{ x: 10 }, 'target needs both x and y', undefined],
        [{ ref: 'e1', selector: 'a' }, 'target needs exactly one of', undefined],
        [{}, 'target needs exactly one of', undefined],
      ];
      for (const [target, message, method] of cases) {
        const result = await tool.click.execute({ target });
        expect(result.isError).toBe(true);
        expect(text(result)).toContain(message);
        expect(result.meta.target).toBe(method);
      }
      expect(page.url()).toBe(`${site.baseUrl}/done`);
    },
    testTimeout,
  );
});

describe('type', () => {
  it(
    'types by ref and submits with Enter',
    async () => {
      await open('/');
      const result = await tool.type.execute({
        target: { ref: await refOf('textbox "New to-do"') },
        text: 'Buy milk',
        submit: true,
      });

      expect(result.meta).toEqual({ target: 'ref' });
      expect(text(result)).toMatch(/^Typed "Buy milk" into ref \w+ and pressed Enter\./);
      await expect(page.getByRole('status').textContent()).resolves.toBe('Added "Buy milk".');
      expect(page.url()).toBe(`${site.baseUrl}/`);
    },
    testTimeout,
  );

  it(
    'replaces the value by selector and by coordinates',
    async () => {
      await open('/new');

      const bySelector = await tool.type.execute({
        target: { selector: '#new-title' },
        text: 'Buy milk',
      });
      expect(bySelector.meta).toEqual({ target: 'selector' });
      await expect(page.locator('#new-title').inputValue()).resolves.toBe('Buy milk');

      await page.locator('#new-title').fill('old text');
      const byPoint = await tool.type.execute({
        target: await center('#new-title'),
        text: 'Call the bank',
      });
      expect(byPoint.meta).toEqual({ target: 'coordinates' });
      await expect(page.locator('#new-title').inputValue()).resolves.toBe('Call the bank');
    },
    testTimeout,
  );
});

describe('select', () => {
  it(
    'chooses an option by ref, selector and coordinates, by value or label',
    async () => {
      await open('/');
      const priority = page.locator('#priority');

      const byRef = await tool.select.execute({
        target: { ref: await refOf('combobox "Priority"') },
        value: 'high',
      });
      expect(byRef.meta).toEqual({ target: 'ref' });
      expect(text(byRef)).toMatch(/^Selected "high"\./);
      await expect(priority.inputValue()).resolves.toBe('high');

      await tool.select.execute({ target: { selector: '#priority' }, value: 'low' });
      await expect(priority.inputValue()).resolves.toBe('low');

      const byPoint = await tool.select.execute({
        target: await center('#priority'),
        value: 'normal',
      });
      expect(byPoint.meta).toEqual({ target: 'coordinates' });
      await expect(priority.inputValue()).resolves.toBe('normal');

      await tool.select.execute({ target: { selector: '#priority' }, value: 'High' });
      await expect(priority.inputValue()).resolves.toBe('high');
    },
    testTimeout,
  );

  it(
    'returns an error for a missing option or an element that is not a dropdown',
    async () => {
      await open('/');
      const missing = await tool.select.execute({ target: { selector: '#priority' }, value: '99' });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toBe('no option "99"; options: "Low", "Normal", "High"');

      const notSelect = await tool.select.execute({ target: await center('h1'), value: 'high' });
      expect(notSelect.isError).toBe(true);
      expect(text(notSelect)).toBe('the element is not a dropdown (<select>)');
      expect(notSelect.meta).toEqual({ target: 'coordinates' });
    },
    testTimeout,
  );
});

describe('scroll', () => {
  it(
    'scrolls one screen down and up and says when it cannot',
    async () => {
      await open('/');
      await page.evaluate(`(() => {
        const main = document.querySelector('main');
        for (let i = 0; i < 100; i++) {
          const p = document.createElement('p');
          p.textContent = 'Filler paragraph number ' + i;
          main.append(p);
        }
      })()`);
      const max = await page.evaluate<number>(
        'document.documentElement.scrollHeight - innerHeight',
      );
      expect(max).toBeGreaterThan(0);
      const oneScreen = Math.min(VIEWPORT.height, max);

      expect(text(await tool.scroll.execute({ direction: 'up' }))).toBe(
        'Already at the top of the page.',
      );
      expect(text(await tool.scroll.execute({ direction: 'down' }))).toBe(
        `Scrolled down. Now at ${oneScreen} of ${max} px.`,
      );
      await expect(page.evaluate('scrollY')).resolves.toBe(oneScreen);
      if (oneScreen === max) {
        expect(text(await tool.scroll.execute({ direction: 'down' }))).toBe(
          'Already at the bottom of the page.',
        );
      }
      expect(text(await tool.scroll.execute({ direction: 'up' }))).toBe(
        `Scrolled up. Now at 0 of ${max} px.`,
      );
    },
    testTimeout,
  );
});

describe('navigate and back', () => {
  it(
    'opens absolute and relative URLs and goes back',
    async () => {
      await open('/');
      const relative = await tool.navigate.execute({ url: '/new' });
      expect(text(relative)).toBe(
        `Navigated.\nPage: New to-do | To-do fixture (${site.baseUrl}/new)`,
      );

      await tool.navigate.execute({ url: `${site.baseUrl}/done` });
      expect(page.url()).toBe(`${site.baseUrl}/done`);

      const back = await tool.back.execute({});
      expect(back.isError).toBe(false);
      expect(page.url()).toBe(`${site.baseUrl}/new`);
    },
    testTimeout,
  );

  it(
    'reports an HTTP error status and refuses other schemes',
    async () => {
      await open('/');
      expect(text(await tool.navigate.execute({ url: '/no-such-page' }))).toMatch(
        /^Navigated \(HTTP 404\)\./,
      );

      const script = await tool.navigate.execute({ url: 'javascript:alert(1)' });
      expect(script.isError).toBe(true);
      expect(text(script)).toBe('Only http and https URLs can be opened.');
      const file = await tool.navigate.execute({ url: 'file:///etc/passwd' });
      expect(file.isError).toBe(true);
    },
    testTimeout,
  );

  it(
    'does not go back past the start page',
    async () => {
      await open('/');
      const result = await tool.back.execute({});

      expect(result.isError).toBe(true);
      expect(text(result)).toBe('There is no previous page.');
      expect(page.url()).toBe(`${site.baseUrl}/`);
    },
    testTimeout,
  );
});

describe('wait', () => {
  it(
    'waits for text to appear, or reports that it did not',
    async () => {
      await open('/');
      await page.evaluate(`setTimeout(() => {
        document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Late arrival</p>');
      }, 100)`);

      const appeared = await tool.wait.execute({ text: 'late arrival' });
      expect(appeared.isError).toBe(false);
      expect(text(appeared)).toBe('"late arrival" is visible.');

      const missing = await tool.wait.execute({ text: 'Never shown' });
      expect(missing.isError).toBe(true);
      expect(text(missing)).toBe('"Never shown" did not appear within 0.5 s.');
    },
    testTimeout,
  );

  it(
    'pauses briefly without text',
    async () => {
      await open('/');
      const started = Date.now();
      const result = await tool.wait.execute({});

      expect(text(result)).toBe('Waited 0.05 s.');
      expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    },
    testTimeout,
  );
});

describe('a closed page', () => {
  it(
    'throws instead of returning a tool error, so the Lane fails',
    async () => {
      await open('/');
      await page.close();
      await expect(tool.read_page.execute({})).rejects.toThrow();
    },
    testTimeout,
  );
});
