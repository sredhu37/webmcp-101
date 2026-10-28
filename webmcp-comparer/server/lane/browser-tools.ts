import type { Page, Request } from 'playwright';
import { compileInputSchema } from './input-schema.ts';
import type { ScreenshotFiles } from './screenshots.ts';
import { readPage } from './snapshot.ts';
import {
  TARGET_SCHEMA,
  TargetError,
  elementAtPoint,
  parseTarget,
  resolveTarget,
  targetMethod,
  type ResolvedTarget,
  type Target,
} from './target.ts';
import {
  errorMessage,
  errorResult,
  textResult,
  type JsonSchema,
  type LaneTool,
  type ToolMeta,
  type ToolResult,
} from './tool.ts';

export const BROWSER_TOOL_NAMES = [
  'screenshot',
  'read_page',
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'back',
  'wait',
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

/** Ends the Lane; defined by the agent loop, but its name is taken like a Browser tool's. */
export const FINISH_TOOL_NAME = 'finish';

export const SCREENSHOT_QUALITY = 70;

export interface BrowserToolTimeouts {
  /** Bound for one page action: a click, a fill, a snapshot. */
  actionMs: number;
  navigationMs: number;
  /** How long `wait(text)` waits for the text. */
  waitForTextMs: number;
  /** The pause of `wait()` without text. */
  pauseMs: number;
  /** How long a mouse or keyboard action may take to start a navigation. */
  navigationStartMs: number;
}

export const DEFAULT_BROWSER_TOOL_TIMEOUTS: BrowserToolTimeouts = {
  actionMs: 5_000,
  navigationMs: 15_000,
  waitForTextMs: 10_000,
  pauseMs: 1_000,
  navigationStartMs: 250,
};

export interface BrowserToolsOptions {
  page: Page;
  screenshots: ScreenshotFiles;
  scenarioId: string;
  attempt: number;
  timeouts?: Partial<BrowserToolTimeouts>;
}

interface ToolSpec {
  name: BrowserToolName;
  description: string;
  properties: Record<string, JsonSchema>;
  required?: string[];
  run(input: Record<string, unknown>): Promise<ToolResult>;
}

/** The Browser tools of one Lane for one Attempt, identical in both Lanes. */
export function createBrowserTools(options: BrowserToolsOptions): LaneTool[] {
  const { page, screenshots, scenarioId, attempt } = options;
  const timeouts = { ...DEFAULT_BROWSER_TOOL_TIMEOUTS, ...options.timeouts };

  /** Lets a navigation that the action started reach the new document before the next tool. */
  async function settle(): Promise<void> {
    await page
      .waitForLoadState('domcontentloaded', { timeout: timeouts.navigationMs })
      .catch(() => undefined);
  }

  /**
   * Raw mouse and keyboard input does not wait for a navigation it starts, unlike locator
   * actions. If one starts shortly after the input, wait for the new document.
   */
  async function rawInput(action: () => Promise<void>): Promise<void> {
    const mainFrame = page.mainFrame();
    let navigationStarted!: () => void;
    let documentReady!: () => void;
    const started = new Promise<void>((resolve) => (navigationStarted = resolve));
    const ready = new Promise<void>((resolve) => (documentReady = resolve));
    const onRequest = (request: Request): void => {
      if (request.isNavigationRequest() && request.frame() === mainFrame) navigationStarted();
    };
    const onReady = (): void => documentReady();
    page.on('request', onRequest);
    page.on('domcontentloaded', onReady);
    try {
      await action();
      const navigating = await Promise.race([
        started.then(() => true),
        delay(timeouts.navigationStartMs).then(() => false),
      ]);
      if (navigating) await Promise.race([ready, delay(timeouts.navigationMs)]);
    } finally {
      page.off('request', onRequest);
      page.off('domcontentloaded', onReady);
    }
  }

  async function pageLine(): Promise<string> {
    const title = await page.title().catch(() => '');
    return `Page: ${title} (${page.url()})`;
  }

  async function onTarget(
    input: Record<string, unknown>,
    act: (resolved: ResolvedTarget) => Promise<string>,
  ): Promise<ToolResult> {
    let target: Target;
    try {
      target = parseTarget(input.target as Record<string, unknown>);
    } catch (error) {
      return errorResult(errorMessage(error));
    }
    const meta: ToolMeta = { target: targetMethod(target) };
    try {
      const done = await act(await resolveTarget(page, target));
      await settle();
      return textResult(`${done}\n${await pageLine()}`, meta);
    } catch (error) {
      return failure(error, meta);
    }
  }

  /** Page errors go back to the agent; a closed page or browser ends the Lane. */
  function failure(error: unknown, meta: ToolMeta = {}): ToolResult {
    if (page.isClosed() || !page.context().browser()?.isConnected()) throw error;
    return errorResult(
      error instanceof TargetError ? error.message : `Error: ${errorMessage(error)}`,
      meta,
    );
  }

  const specs: ToolSpec[] = [
    {
      name: 'screenshot',
      description: 'Take a screenshot of the visible part of the page.',
      properties: {},
      async run() {
        const jpeg = await page.screenshot({
          type: 'jpeg',
          quality: SCREENSHOT_QUALITY,
          timeout: timeouts.actionMs,
        });
        const size = page.viewportSize() ?? { width: 0, height: 0 };
        const saved = await screenshots.save(jpeg, scenarioId, attempt, size);
        return {
          isError: false,
          content: [{ type: 'image', data: jpeg.toString('base64'), mediaType: 'image/jpeg' }],
          meta: { screenshot: saved },
        };
      },
    },
    {
      name: 'read_page',
      description:
        'Read the whole page as an accessibility snapshot: roles, names, text and links. Elements carry a ref such as [ref=e5] to use as a target; refs are valid until the next read_page.',
      properties: {},
      async run() {
        return textResult(await readPage(page, timeouts.actionMs));
      },
    },
    {
      name: 'click',
      description: 'Click an element.',
      properties: { target: TARGET_SCHEMA },
      required: ['target'],
      run: (input) =>
        onTarget(input, async (resolved) => {
          if (resolved.kind === 'point') {
            await rawInput(() => page.mouse.click(resolved.x, resolved.y));
            return `Clicked at (${resolved.x}, ${resolved.y}).`;
          }
          await resolved.locator.click();
          return `Clicked ${resolved.note}.`;
        }),
    },
    {
      name: 'type',
      description:
        'Type text into a field, replacing what it holds. Set submit to true to press Enter afterwards.',
      properties: {
        target: TARGET_SCHEMA,
        text: { type: 'string' },
        submit: { type: 'boolean', description: 'Press Enter after typing' },
      },
      required: ['target', 'text'],
      run: (input) =>
        onTarget(input, async (resolved) => {
          const text = input.text as string;
          const submit = input.submit === true;
          if (resolved.kind === 'point') {
            await page.mouse.click(resolved.x, resolved.y);
            await page.keyboard.press('ControlOrMeta+A');
            await page.keyboard.type(text);
            if (submit) await rawInput(() => page.keyboard.press('Enter'));
          } else {
            await resolved.locator.fill(text);
            if (submit) await resolved.locator.press('Enter');
          }
          const where =
            resolved.kind === 'point'
              ? `at (${resolved.x}, ${resolved.y})`
              : `into ${resolved.note}`;
          return `Typed ${JSON.stringify(text)} ${where}${submit ? ' and pressed Enter' : ''}.`;
        }),
    },
    {
      name: 'select',
      description: 'Choose an option in a dropdown, by its value or its visible label.',
      properties: { target: TARGET_SCHEMA, value: { type: 'string' } },
      required: ['target', 'value'],
      run: (input) =>
        onTarget(input, async (resolved) => {
          const value = input.value as string;
          const element =
            resolved.kind === 'point'
              ? await elementAtPoint(page, resolved.x, resolved.y)
              : await resolved.locator.elementHandle();
          if (!element) throw new TargetError('the element is gone');
          let selected: string[];
          try {
            const options = await element.evaluate(selectOptions);
            if (!options) throw new TargetError('the element is not a dropdown (<select>)');
            if (!options.some((option) => option.value === value || option.label === value)) {
              throw new TargetError(
                `no option ${JSON.stringify(value)}; options: ${options
                  .map((option) => JSON.stringify(option.label))
                  .join(', ')}`,
              );
            }
            selected = await element.selectOption(value, { timeout: timeouts.actionMs });
          } finally {
            await element.dispose();
          }
          return `Selected ${selected.map((option) => JSON.stringify(option)).join(', ')}.`;
        }),
    },
    {
      name: 'scroll',
      description: 'Scroll the page one screen up or down.',
      properties: { direction: { type: 'string', enum: ['up', 'down'] } },
      required: ['direction'],
      async run(input) {
        const down = input.direction === 'down';
        const position = await page.evaluate<{ before: number; after: number; max: number }>(
          `(() => {
            const before = window.scrollY;
            window.scrollBy({ top: ${down ? '' : '-'}window.innerHeight, behavior: 'instant' });
            return {
              before,
              after: window.scrollY,
              max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
            };
          })()`,
        );
        const after = Math.round(position.after);
        const max = Math.round(position.max);
        if (Math.round(position.before) === after) {
          return textResult(`Already at the ${down ? 'bottom' : 'top'} of the page.`);
        }
        return textResult(`Scrolled ${input.direction as string}. Now at ${after} of ${max} px.`);
      },
    },
    {
      name: 'navigate',
      description: 'Go to a URL. A relative URL resolves against the current page.',
      properties: { url: { type: 'string' } },
      required: ['url'],
      async run(input) {
        let url: URL;
        try {
          url = new URL(input.url as string, page.url());
        } catch {
          return errorResult(`Invalid URL ${JSON.stringify(input.url)}.`);
        }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return errorResult('Only http and https URLs can be opened.');
        }
        const response = await page.goto(url.href, { timeout: timeouts.navigationMs });
        const status = response && !response.ok() ? ` (HTTP ${response.status()})` : '';
        return textResult(`Navigated${status}.\n${await pageLine()}`);
      },
    },
    {
      name: 'back',
      description: 'Go back to the previous page.',
      properties: {},
      async run() {
        const before = page.url();
        const response = await page.goBack({ timeout: timeouts.navigationMs });
        if (page.url() === 'about:blank' && before !== 'about:blank') {
          await page.goForward({ timeout: timeouts.navigationMs });
          return errorResult('There is no previous page.');
        }
        if (!response && page.url() === before) return errorResult('There is no previous page.');
        return textResult(`Went back.\n${await pageLine()}`);
      },
    },
    {
      name: 'wait',
      description: `Wait until the text appears on the page (up to ${timeouts.waitForTextMs / 1000} s), or pause briefly when no text is given.`,
      properties: { text: { type: 'string' } },
      async run(input) {
        const text = input.text as string | undefined;
        if (text === undefined || text === '') {
          await page.waitForTimeout(timeouts.pauseMs);
          return textResult(`Waited ${timeouts.pauseMs / 1000} s.`);
        }
        try {
          await page
            .getByText(text)
            .first()
            .waitFor({ state: 'visible', timeout: timeouts.waitForTextMs });
        } catch (error) {
          if (page.isClosed()) throw error;
          return errorResult(
            `${JSON.stringify(text)} did not appear within ${timeouts.waitForTextMs / 1000} s.`,
          );
        }
        return textResult(`${JSON.stringify(text)} is visible.`);
      },
    },
  ];

  return specs.map((spec) => {
    const inputSchema: JsonSchema = {
      type: 'object',
      properties: spec.properties,
      ...(spec.required ? { required: spec.required } : {}),
      additionalProperties: false,
    };
    const { validate } = compileInputSchema(inputSchema);
    return {
      name: spec.name,
      description: spec.description,
      inputSchema,
      source: 'browser',
      async execute(input) {
        const value = input ?? {};
        const check = validate(value);
        if (!check.ok) return errorResult(`Invalid input for ${spec.name}: ${check.message}.`);
        try {
          return await spec.run(value as Record<string, unknown>);
        } catch (error) {
          return failure(error);
        }
      },
    } satisfies LaneTool;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SelectLike {
  tagName: string;
  options?: ArrayLike<{ value: string; label: string }>;
}

/** The options of a `<select>`, or null for any other element; runs in the page. */
function selectOptions(element: SelectLike): { value: string; label: string }[] | null {
  if (element.tagName !== 'SELECT' || !element.options) return null;
  return Array.from(element.options, ({ value, label }) => ({ value, label }));
}
