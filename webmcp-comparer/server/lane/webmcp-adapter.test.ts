import type { Browser, Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFixtureSite, type RunningFixtureSite } from '../testing/fixture-site.ts';
import { launchLaneChromium, openLanePage } from './browser.ts';
import { BROWSER_TOOL_NAMES, FINISH_TOOL_NAME } from './browser-tools.ts';
import type { LaneTool, ToolResult } from './tool.ts';
import {
  WEBMCP_CALL_TIMEOUT_MS,
  WebMcpTools,
  exposedNames,
  normalizeWebMcpResult,
} from './webmcp-adapter.ts';

const setupTimeout = 30_000;
const testTimeout = 20_000;

let site: RunningFixtureSite;
let browser: Browser;

beforeAll(async () => {
  [site, browser] = await Promise.all([startFixtureSite(), launchLaneChromium('webmcp')]);
}, setupTimeout);

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

let page: Page;
let webmcp: WebMcpTools;

beforeEach(async () => {
  page = await openLanePage(browser, { actionTimeoutMs: 2_000, navigationTimeoutMs: 5_000 });
  webmcp = new WebMcpTools(page, { callTimeoutMs: 1_000 });
});

afterEach(async () => {
  await page?.context().close();
});

async function open(path: string): Promise<void> {
  await page.goto(`${site.baseUrl}${path}`);
}

function text(result: ToolResult): string {
  return result.content.map((part) => (part.type === 'text' ? part.text : '[image]')).join('\n');
}

function json(result: ToolResult): unknown {
  return JSON.parse(text(result));
}

async function toolNamed(name: string): Promise<LaneTool> {
  const { tools } = await webmcp.refresh();
  const found = tools.find((tool) => tool.name === name);
  if (!found) throw new Error(`no tool ${name} in ${tools.map((tool) => tool.name).join(', ')}`);
  return found;
}

/** Registers an extra tool on the fixture page; `execute` is the body of an async function. */
async function register(name: string, execute: string, extra = ''): Promise<void> {
  await page.evaluate(`document.modelContext.registerTool({
    name: ${JSON.stringify(name)},
    description: 'Test tool ' + ${JSON.stringify(name)},
    ${extra}
    execute: async (input) => { ${execute} },
  })`);
}

async function todoTitles(): Promise<string[]> {
  return page.evaluate('todos.list().map((todo) => todo.title)');
}

const SEED_TITLES = ['Water the plants', 'Pay the electricity bill', 'Book a dentist appointment'];

describe('tool list', () => {
  it(
    'exposes the site tools with their name, description and input schema',
    async () => {
      await open('/');
      const { tools, change } = await webmcp.refresh();

      expect(tools.map((tool) => tool.name).sort()).toEqual(['add_todo', 'list_todos']);
      expect(change?.added.sort()).toEqual(tools.map((tool) => tool.name).sort());
      const addTodo = tools.find((tool) => tool.name === 'add_todo')!;
      expect(addTodo).toMatchObject({
        source: 'webmcp',
        description: 'Add a to-do. Returns the new to-do.',
        inputSchema: { type: 'object', required: ['title'] },
      });
    },
    testTimeout,
  );

  it(
    'reports no change when the list is the same and keeps the tool objects',
    async () => {
      await open('/');
      const first = await webmcp.refresh();
      const second = await webmcp.refresh();

      expect(second.change).toBeNull();
      expect(second.tools).toEqual(first.tools);
      second.tools.forEach((tool, index) => expect(tool).toBe(first.tools[index]));
    },
    testTimeout,
  );

  it(
    'follows navigation, late registration and changed descriptors',
    async () => {
      await open('/');
      await webmcp.refresh();

      await open('/new');
      expect((await webmcp.refresh()).change).toEqual({
        added: ['create_todo'],
        removed: [],
        changed: [],
      });

      await register('late_tool', "return 'late';");
      expect((await webmcp.refresh()).change).toEqual({
        added: ['late_tool'],
        removed: [],
        changed: [],
      });

      await open('/done');
      await register(
        'late_tool',
        "return 'late';",
        "inputSchema: { type: 'object', properties: { n: { type: 'number' } } },",
      );
      expect((await webmcp.refresh()).change).toEqual({
        added: [],
        removed: ['create_todo'],
        changed: ['late_tool'],
      });
    },
    testTimeout,
  );

  it(
    'reports an empty list on a page without tools',
    async () => {
      await page.goto('about:blank');
      expect(await webmcp.refresh()).toEqual({ tools: [], change: null });
    },
    testTimeout,
  );
});

describe('name clash', () => {
  it(
    'prefixes a site tool named like a Browser tool with site_',
    async () => {
      await open('/');
      await register('click', "return 'site click ran';");
      await register(FINISH_TOOL_NAME, "return 'site finish ran';");
      const { tools } = await webmcp.refresh();
      const names = tools.map((tool) => tool.name);

      expect(names).toContain('site_click');
      expect(names).toContain('site_finish');
      expect(names).not.toContain('click');
      const result = await (await toolNamed('site_click')).execute({});
      expect(text(result)).toBe('site click ran');
      expect(result.meta).toEqual({ webmcpName: 'click' });
    },
    testTimeout,
  );

  it('keeps prefixing while the prefixed name is taken', () => {
    const reserved = new Set<string>([...BROWSER_TOOL_NAMES, FINISH_TOOL_NAME]);
    expect(exposedNames(['click', 'site_click', 'search'], reserved)).toEqual([
      'site_site_click',
      'site_click',
      'search',
    ]);
  });
});

describe('calling a tool', () => {
  it(
    'passes MCP content through for the fixture site tools',
    async () => {
      await open('/done');

      const openTodos = await (await toolNamed('list_todos')).execute({ done: false });
      expect(openTodos.isError).toBe(false);
      expect(openTodos.meta).toEqual({ webmcpName: 'list_todos' });
      expect((json(openTodos) as { title: string }[]).map((todo) => todo.title)).toEqual([
        'Water the plants',
        'Pay the electricity bill',
      ]);

      const added = await (
        await toolNamed('add_todo')
      ).execute({
        title: 'Buy milk',
        priority: 'high',
      });
      expect(json(added)).toEqual({ id: 4, title: 'Buy milk', priority: 'high', done: false });
      expect(page.url()).toBe(`${site.baseUrl}/done`);

      const all = await (await toolNamed('list_todos')).execute({});
      expect(json(all)).toHaveLength(4);
    },
    testTimeout,
  );

  it(
    'wraps the declarative form result as text and the page moves on',
    async () => {
      await open('/new');

      const result = await (await toolNamed('create_todo')).execute({ title: 'Call the bank' });
      expect(result.isError).toBe(false);
      expect(json(result)).toEqual({ id: 4, title: 'Call the bank' });

      await page.waitForURL(`${site.baseUrl}/`);
      const { tools, change } = await webmcp.refresh();
      expect(change?.removed).toEqual(['create_todo']);
      expect(tools.map((tool) => tool.name)).not.toContain('create_todo');
      expect(await todoTitles()).toContain('Call the bank');
    },
    testTimeout,
  );

  it(
    'validates input against the input schema before calling',
    async () => {
      await open('/');
      const addTodo = await toolNamed('add_todo');

      const missing = await addTodo.execute({ priority: 'high' });
      expect(missing).toEqual({
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Invalid input for add_todo: missing required property "title".',
          },
        ],
        meta: { webmcpName: 'add_todo', webmcpFailure: 'invalid_input' },
      });

      const empty = await addTodo.execute({ title: '' });
      expect(text(empty)).toBe(
        'Invalid input for add_todo: title must NOT have fewer than 1 characters.',
      );

      const priority = await addTodo.execute({ title: 'Buy milk', priority: 'urgent' });
      expect(text(priority)).toBe(
        'Invalid input for add_todo: priority must be one of "low", "normal", "high".',
      );

      const notObject = await addTodo.execute('Buy milk');
      expect(text(notObject)).toBe('Invalid input for add_todo: input must be object.');
      expect(await todoTitles()).toEqual(SEED_TITLES);
    },
    testTimeout,
  );

  it(
    'returns an isError result as a tool error',
    async () => {
      await open('/');
      const result = await (await toolNamed('add_todo')).execute({ title: 'Water the plants' });

      expect(result.isError).toBe(true);
      expect(text(result)).toBe('A to-do called "Water the plants" already exists.');
      expect(result.meta).toEqual({ webmcpName: 'add_todo', webmcpFailure: 'tool_error' });
    },
    testTimeout,
  );

  it(
    'returns a thrown error as a tool error',
    async () => {
      await open('/');
      await register('boom', "throw new Error('kaput');");
      const result = await (await toolNamed('boom')).execute({});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/^Tool boom failed: /);
      expect(result.meta).toEqual({ webmcpName: 'boom', webmcpFailure: 'thrown' });
    },
    testTimeout,
  );

  it(
    'returns a tool error when the tool is gone after navigation',
    async () => {
      await open('/');
      const listTodos = await toolNamed('list_todos');
      await page.goto('about:blank');
      const result = await listTodos.execute({});

      expect(result.isError).toBe(true);
      expect(result.meta.webmcpFailure).toBe('thrown');
    },
    testTimeout,
  );

  it(
    'times out a call that never returns',
    async () => {
      expect(WEBMCP_CALL_TIMEOUT_MS).toBe(15_000);
      const quick = new WebMcpTools(page, { callTimeoutMs: 300 });
      await open('/');
      await register('hang', 'await new Promise(() => {});');
      const hang = (await quick.refresh()).tools.find((tool) => tool.name === 'hang')!;

      const started = Date.now();
      const result = await hang.execute({});
      expect(Date.now() - started).toBeLessThan(3_000);
      expect(result.isError).toBe(true);
      expect(text(result)).toBe('Tool hang did not respond within 0.3 s.');
      expect(result.meta).toEqual({ webmcpName: 'hang', webmcpFailure: 'timeout' });
    },
    testTimeout,
  );

  it(
    'wraps plain string, object and empty results as text and passes images through',
    async () => {
      await open('/');
      await register('plain_string', "return 'hello ' + input.who;");
      await register('plain_object', 'return { ok: true, items: [1, 2] };');
      await register('nothing', 'return undefined;');
      await register(
        'picture',
        "return { content: [{ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }, { type: 'text', text: 'a dot' }] };",
      );

      const plain = await (await toolNamed('plain_string')).execute({ who: 'agent' });
      expect(plain.content).toEqual([{ type: 'text', text: 'hello agent' }]);
      const object = await (await toolNamed('plain_object')).execute({});
      expect(object.content).toEqual([{ type: 'text', text: '{"ok":true,"items":[1,2]}' }]);
      const nothing = await (await toolNamed('nothing')).execute({});
      expect(nothing.content).toEqual([{ type: 'text', text: '(no result)' }]);
      const picture = await (await toolNamed('picture')).execute({});
      expect(picture.content).toEqual([
        { type: 'image', data: 'iVBORw0KGgo=', mediaType: 'image/png' },
        { type: 'text', text: 'a dot' },
      ]);
    },
    testTimeout,
  );
});

describe('normalizeWebMcpResult', () => {
  it('keeps isError, turns unknown content parts into JSON text and fills an empty list', () => {
    expect(
      normalizeWebMcpResult({ content: [{ type: 'text', text: 'no' }], isError: true }),
    ).toEqual({ isError: true, content: [{ type: 'text', text: 'no' }] });
    expect(
      normalizeWebMcpResult({ content: [{ type: 'resource', resource: { uri: 'x:1' } }] }),
    ).toEqual({
      isError: false,
      content: [{ type: 'text', text: '{"type":"resource","resource":{"uri":"x:1"}}' }],
    });
    expect(normalizeWebMcpResult({ content: [] })).toEqual({
      isError: false,
      content: [{ type: 'text', text: '(empty result)' }],
    });
    expect(normalizeWebMcpResult(null).content).toEqual([{ type: 'text', text: '(no result)' }]);
    expect(normalizeWebMcpResult(42).content).toEqual([{ type: 'text', text: '42' }]);
    expect(normalizeWebMcpResult([1, 2]).content).toEqual([{ type: 'text', text: '[1,2]' }]);
  });
});
