import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LaneId } from '../lane/browser.ts';
import { BROWSER_TOOL_NAMES } from '../lane/browser-tools.ts';
import { bundledPriceTable } from '../pricing/price-table.ts';
import { parseSuite, type Scenario } from '../suite/parse.ts';
import {
  fixtureSuiteFile,
  startFixtureSite,
  type RunningFixtureSite,
} from '../testing/fixture-site.ts';
import {
  scriptedModel,
  type ScriptedModel,
  type ScriptedReply,
} from '../testing/scripted-model.ts';
import { LOG_EVENTS, LOG_RESULT_LIMIT, openLaneOutput, type LogRecord } from './lane-log.ts';
import { REMINDER, SYSTEM_PROMPT, userMessage } from './prompts.ts';
import { createRedactor } from './redact.ts';
import { DEFAULT_LIMITS, runLane, type LaneAttemptResult, type LaneLimits } from './run-lane.ts';

const testTimeout = 30_000;
const API_KEY = 'sk-ant-test-0123456789abcdefghijklmnop';
const SITE_TOOLS = ['add_todo', 'list_todos'];

let site: RunningFixtureSite;
let scenarios: Record<string, Scenario>;

beforeAll(async () => {
  site = await startFixtureSite();
  const source = await readFile(fixtureSuiteFile, 'utf8');
  const parsed = parseSuite(source);
  if (!parsed.ok) throw new Error('fixture Suite does not parse');
  scenarios = Object.fromEntries(parsed.suite.scenarios.map((s) => [s.id, s]));
}, testTimeout);

afterAll(async () => {
  await site?.close();
});

interface Run {
  result: LaneAttemptResult;
  log: LogRecord[];
  events: LogRecord[];
  runDir: string;
  model: ScriptedModel;
}

interface RunOptions {
  lane?: LaneId;
  scenario?: Scenario;
  limits?: Partial<LaneLimits>;
  signal?: AbortSignal;
  onPage?: (page: Page) => Promise<void>;
}

async function run(model: ScriptedModel, options: RunOptions = {}): Promise<Run> {
  const lane = options.lane ?? 'baseline';
  const runDir = await mkdtemp(join(tmpdir(), 'run-lane-'));
  const output = openLaneOutput(runDir, lane, createRedactor([API_KEY]));
  const events: LogRecord[] = [];
  const result = await runLane({
    lane,
    scenario: options.scenario ?? scenarios['first-open-todo']!,
    attempt: 1,
    siteUrl: site.baseUrl,
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    model,
    priceTable: bundledPriceTable(),
    output,
    onEvent: (record) => events.push(record),
    browser: { actionTimeoutMs: 3_000, navigationTimeoutMs: 5_000 },
    toolTimeouts: { waitForTextMs: 2_000, pauseMs: 100 },
    webmcpCallTimeoutMs: 2_000,
    maxRetries: 0,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onPage ? { onPage: options.onPage } : {}),
  });
  const log = readFileSync(output.log.path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as LogRecord);
  return { result, log, events, runDir, model };
}

function eventsNamed(log: LogRecord[], event: string): LogRecord[] {
  return log.filter((record) => record.event === event);
}

/** The tool names offered to the model in one Step. */
function offeredTools(model: ScriptedModel, step: number): string[] {
  return (model.calls[step]?.tools ?? []).map((tool: { name: string }) => tool.name);
}

const finish = (success: boolean, answer: string): ScriptedReply => ({
  toolCalls: [{ name: 'finish', input: { success, answer } }],
});

describe('Outcome', () => {
  it(
    'passes when the Success checks pass after finish (Baseline lane, Browser tools)',
    async () => {
      const model = scriptedModel([
        {
          text: 'Looking.',
          toolCalls: [{ name: 'navigate', input: { url: '/done' } }],
        },
        { toolCalls: [{ name: 'read_page' }, { name: 'screenshot' }] },
        finish(true, 'The first to-do is Water the plants.'),
      ]);
      const { result, log } = await run(model);

      expect(result).toMatchObject({
        lane: 'baseline',
        scenario: 'first-open-todo',
        attempt: 1,
        outcome: 'pass',
        reason: null,
        answer: 'The first to-do is Water the plants.',
        steps: 3,
        toolCalls: { navigate: 1, read_page: 1, screenshot: 1 },
        toolCallsTotal: 3,
        screenshots: 1,
        webmcpTools: [],
      });
      expect(eventsNamed(log, 'check')).toMatchObject([
        { check: 'answerContains: Water the plants', pass: true },
      ]);
      expect(offeredTools(model, 0)).toEqual([...BROWSER_TOOL_NAMES, 'finish']);
    },
    testTimeout,
  );

  it(
    'creates a to-do with Browser tools and passes the script check',
    async () => {
      const model = scriptedModel([
        {
          toolCalls: [
            { name: 'type', input: { target: { selector: '#new-title' }, text: 'Call the bank' } },
          ],
        },
        { toolCalls: [{ name: 'click', input: { target: { selector: '#new-todo button' } } }] },
        finish(true, 'Created Call the bank.'),
      ]);
      const { result, log } = await run(model, { scenario: scenarios['create-from-new-page'] });

      expect(result.outcome).toBe('pass');
      expect(eventsNamed(log, 'tool_call').map((r) => [r.name, r.target, r.isError])).toEqual([
        ['type', 'selector', false],
        ['click', 'selector', false],
      ]);
      expect(eventsNamed(log, 'lane_start')[0]).toMatchObject({
        startUrl: `${site.baseUrl}/new`,
      });
    },
    testTimeout,
  );

  it(
    'fails with the first failed check when the checks fail',
    async () => {
      const model = scriptedModel([finish(true, 'Done.')]);
      const { result, log } = await run(model, { scenario: scenarios['add-todo'] });

      expect(result.outcome).toBe('fail');
      expect(result.reason).toBe(
        "check failed: script: todos.list().some(t => t.title === 'Buy milk')",
      );
      expect(eventsNamed(log, 'check')[0]).toMatchObject({ pass: false, detail: 'returned false' });
    },
    testTimeout,
  );

  it(
    'lets finish(success) decide when the Scenario has no Success checks',
    async () => {
      const scenario: Scenario = { id: 'no-checks', prompt: 'Look around.' };
      const failed = await run(scriptedModel([finish(false, 'Could not do it.')]), { scenario });
      expect(failed.result).toMatchObject({
        outcome: 'fail',
        reason: 'agent reported failure',
        answer: 'Could not do it.',
      });
      expect(eventsNamed(failed.log, 'check')).toEqual([]);

      const passed = await run(scriptedModel([finish(true, 'Looked.')]), { scenario });
      expect(passed.result).toMatchObject({ outcome: 'pass', reason: null });
    },
    testTimeout,
  );

  it(
    'fails with step limit after the last allowed Step',
    async () => {
      const model = scriptedModel(() => ({
        toolCalls: [{ name: 'scroll', input: { direction: 'down' } }],
      }));
      const { result } = await run(model, { limits: { maxSteps: 2 } });

      expect(result).toMatchObject({
        outcome: 'fail',
        reason: 'step limit',
        steps: 2,
        toolCallsTotal: 2,
      });
      expect(model.calls).toHaveLength(2);
    },
    testTimeout,
  );

  it(
    'fails with time limit when a model call outlasts it, keeping the metrics',
    async () => {
      const model = scriptedModel([{ toolCalls: [{ name: 'read_page' }] }, { hang: true }]);
      const { result, log } = await run(model, { limits: { maxDurationMs: 2_500 } });

      expect(result).toMatchObject({
        outcome: 'fail',
        reason: 'time limit',
        steps: 2,
        toolCallsTotal: 1,
      });
      expect(result.durationMs).toBeGreaterThanOrEqual(2_500);
      expect(result.durationMs).toBeLessThan(10_000);
      expect(eventsNamed(log, 'model_call')[1]).toMatchObject({ finishReason: 'aborted' });
      expect(eventsNamed(log, 'error')).toEqual([]);
    },
    testTimeout,
  );

  it(
    'fails with cost limit after the Step that reaches it, without running checks',
    async () => {
      const model = scriptedModel(() => ({
        toolCalls: [{ name: 'read_page' }],
        usage: { input: 50_000, output: 1_000 },
      }));
      const { result, log } = await run(model, { limits: { maxCostUsd: 0.008 } });

      expect(result).toMatchObject({ outcome: 'fail', reason: 'cost limit', steps: 2 });
      expect(result.costUsd).toBeCloseTo((2 * (50_000 * 0.1 + 1_000 * 0.5)) / 1e6, 12);
      expect(eventsNamed(log, 'check')).toEqual([]);
    },
    testTimeout,
  );

  it(
    'sends one reminder after a text-only reply, then fails with did not call finish',
    async () => {
      const model = scriptedModel([
        { text: 'The first one is Water the plants.' },
        { toolCalls: [{ name: 'read_page' }] },
        { text: 'Still thinking.' },
      ]);
      const { result, log } = await run(model);

      expect(result).toMatchObject({ outcome: 'fail', reason: 'did not call finish', steps: 3 });
      expect(eventsNamed(log, 'reminder')).toHaveLength(1);
      const secondPrompt = model.calls[1]!.prompt;
      expect(secondPrompt.at(-1)).toEqual({
        role: 'user',
        content: [{ type: 'text', text: REMINDER }],
        providerOptions: undefined,
      });
    },
    testTimeout,
  );

  it(
    'passes when the agent calls finish after the reminder',
    async () => {
      const model = scriptedModel([
        { text: 'It is Water the plants.' },
        finish(true, 'Water the plants'),
      ]);
      const { result } = await run(model);
      expect(result).toMatchObject({ outcome: 'pass', steps: 2 });
    },
    testTimeout,
  );

  it(
    'fails with error: <message> on a model API error, and logs the error with keys redacted',
    async () => {
      const model = scriptedModel([
        { toolCalls: [{ name: 'read_page' }] },
        { error: new Error(`401 invalid x-api-key ${API_KEY}`) },
      ]);
      const { result, log, runDir } = await run(model);

      expect(result).toMatchObject({
        outcome: 'fail',
        reason: 'error: 401 invalid x-api-key [redacted]',
        steps: 2,
      });
      expect(eventsNamed(log, 'error')).toMatchObject([
        { message: '401 invalid x-api-key [redacted]' },
      ]);
      const raw = await readFile(join(runDir, 'baseline', 'log.jsonl'), 'utf8');
      expect(raw).not.toContain(API_KEY);
      expect(raw).toContain('[redacted]');
    },
    testTimeout,
  );

  it(
    'fails with error: <message> when the start page cannot be opened',
    async () => {
      const model = scriptedModel([]);
      const { result } = await run(model, {
        scenario: { id: 'closed-port', prompt: 'x' },
        onPage: async (page) => {
          await page.route('**/*', (route) => route.abort('connectionrefused'));
        },
      });
      expect(result.outcome).toBe('fail');
      expect(result.reason).toMatch(/^error: .*ERR_CONNECTION_REFUSED/);
      expect(result.steps).toBe(0);
    },
    testTimeout,
  );

  it(
    'fails with stopped by user when the Run is stopped during a Step',
    async () => {
      const controller = new AbortController();
      const model = scriptedModel([{ toolCalls: [{ name: 'read_page' }] }, { hang: true }]);
      setTimeout(() => controller.abort(), 1_500);
      const { result } = await run(model, { signal: controller.signal });
      expect(result).toMatchObject({ outcome: 'fail', reason: 'stopped by user', steps: 2 });
    },
    testTimeout,
  );
});

describe('Steps and tool calls', () => {
  it(
    'sends the system prompt, the user message and effort medium in every Step',
    async () => {
      const model = scriptedModel([
        { toolCalls: [{ name: 'screenshot' }] },
        finish(true, 'Water the plants'),
      ]);
      await run(model);

      const first = model.calls[0]!;
      expect(first.prompt[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
      expect(first.prompt[1]).toMatchObject({
        role: 'user',
        content: [
          {
            type: 'text',
            text: userMessage('Which to-do is first in the list?', `${site.baseUrl}/`),
          },
        ],
      });
      expect(first.providerOptions).toEqual({
        anthropic: { thinking: { type: 'adaptive' }, effort: 'medium' },
      });

      const toolMessage = model.calls[1]!.prompt.at(-1)!;
      expect(toolMessage.role).toBe('tool');
      const [part] = toolMessage.content as {
        type: string;
        output: { type: string; value: { type: string; mediaType?: string }[] };
      }[];
      expect(part!.output.type).toBe('content');
      expect(part!.output.value.find((v) => v.type === 'file')).toMatchObject({
        mediaType: 'image/jpeg',
      });
    },
    testTimeout,
  );

  it(
    'uses the OpenAI effort field for an OpenAI model',
    async () => {
      const model = scriptedModel([finish(true, 'Water the plants')], { provider: 'openai' });
      const { result } = await run(model);
      expect(result.outcome).toBe('pass');
      expect(model.calls[0]!.providerOptions).toEqual({ openai: { reasoningEffort: 'medium' } });
    },
    testTimeout,
  );

  it(
    'runs several tool calls of one Step in order, and answers unknown and invalid calls with errors',
    async () => {
      const model = scriptedModel([
        {
          toolCalls: [
            { name: 'no_such_tool' },
            { name: 'click', input: '{not json' },
            { name: 'click', input: { target: { ref: 'e999' } } },
            { name: 'finish', input: { success: 'yes' } },
          ],
        },
        finish(true, 'Water the plants'),
      ]);
      const { result, log } = await run(model);

      expect(result).toMatchObject({
        outcome: 'pass',
        toolCalls: { no_such_tool: 1, click: 2 },
        toolCallsTotal: 3,
      });
      const calls = eventsNamed(log, 'tool_call');
      expect(calls.map((c) => [c.name, c.isError])).toEqual([
        ['no_such_tool', true],
        ['click', true],
        ['click', true],
      ]);
      expect(calls[0]!.result).toContain("unavailable tool 'no_such_tool'");
      expect(eventsNamed(log, 'finish')[0]).toMatchObject({
        error: 'finish needs success: true or false.',
      });

      const results = model.calls[1]!.prompt.at(-1)!.content as {
        toolCallId: string;
        output: { type: string };
      }[];
      expect(results.map((r) => [r.toolCallId, r.output.type])).toEqual([
        ['call-1-1', 'error-text'],
        ['call-1-2', 'error-text'],
        ['call-1-3', 'error-text'],
        ['call-1-4', 'error-text'],
      ]);
    },
    testTimeout,
  );

  it(
    'does not run tool calls that come after finish in the same Step',
    async () => {
      const model = scriptedModel([
        {
          toolCalls: [
            { name: 'read_page' },
            { name: 'finish', input: { success: true, answer: 'Water the plants' } },
            { name: 'navigate', input: { url: '/done' } },
          ],
        },
      ]);
      const { result } = await run(model);
      expect(result).toMatchObject({
        outcome: 'pass',
        toolCalls: { read_page: 1 },
        toolCallsTotal: 1,
      });
    },
    testTimeout,
  );
});

describe('WebMCP lane', () => {
  it(
    'offers the site tools and passes with them',
    async () => {
      const model = scriptedModel([
        { toolCalls: [{ name: 'list_todos', input: {} }] },
        {
          toolCalls: [{ name: 'add_todo', input: { title: 'Buy milk' } }],
        },
        finish(true, 'Added Buy milk.'),
      ]);
      const { result, log } = await run(model, {
        lane: 'webmcp',
        scenario: scenarios['add-todo'],
      });

      expect(result).toMatchObject({
        lane: 'webmcp',
        outcome: 'pass',
        toolCalls: { list_todos: 1, add_todo: 1 },
        webmcpTools: ['list_todos', 'add_todo'],
      });
      const offered = offeredTools(model, 0);
      expect(offered.slice(0, BROWSER_TOOL_NAMES.length)).toEqual([...BROWSER_TOOL_NAMES]);
      expect(offered.slice(BROWSER_TOOL_NAMES.length, -1).sort()).toEqual([...SITE_TOOLS].sort());
      expect(offered.at(-1)).toBe('finish');
      const [changed] = eventsNamed(log, 'webmcp_tools_changed');
      expect(changed).toMatchObject({ step: 1, removed: [], changed: [] });
      expect((changed!.added as string[]).sort()).toEqual([...SITE_TOOLS].sort());
      expect(eventsNamed(log, 'tool_call')[1]).toMatchObject({
        name: 'add_todo',
        source: 'webmcp',
        webmcpName: 'add_todo',
        isError: false,
      });
    },
    testTimeout,
  );

  it(
    'refreshes the site tools before every Step and logs changes',
    async () => {
      const model = scriptedModel([
        {
          toolCalls: [{ name: 'add_todo', input: { title: 'Buy milk' } }],
        },
        { toolCalls: [{ name: 'navigate', input: { url: '/new' } }] },
        { toolCalls: [{ name: 'navigate', input: { url: '/' } }] },
        finish(true, 'Water the plants'),
      ]);
      const { log } = await run(model, { lane: 'webmcp' });

      const changes = eventsNamed(log, 'webmcp_tools_changed');
      expect(changes.map((c) => [c.step, (c.added as string[]).sort(), c.removed])).toEqual([
        [1, [...SITE_TOOLS].sort(), []],
        [3, ['create_todo'], []],
        [4, [], ['create_todo']],
      ]);
      expect(offeredTools(model, 2)).toContain('create_todo');
      expect(offeredTools(model, 3)).not.toContain('create_todo');
    },
    testTimeout,
  );

  it(
    'gives a site tool whose name the providers reject a valid name, and logs the mapping',
    async () => {
      const model = scriptedModel([
        { toolCalls: [{ name: 'todos_peek', input: {} }] },
        finish(true, 'Water the plants'),
      ]);
      const { result, log } = await run(model, {
        lane: 'webmcp',
        onPage: async (page) => {
          await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => {
            document.modelContext.registerTool({
              name: 'todos.peek',
              description: 'Peek at the to-dos',
              execute: async () => ({ content: [{ type: 'text', text: 'no to-dos' }] }),
            });
          });`);
        },
      });

      expect(offeredTools(model, 0)).toContain('todos_peek');
      expect(eventsNamed(log, 'webmcp_tools_changed')[0]).toMatchObject({
        renamed: [{ name: 'todos.peek', modelName: 'todos_peek' }],
      });
      expect(eventsNamed(log, 'tool_call')[0]).toMatchObject({
        name: 'todos_peek',
        webmcpName: 'todos.peek',
        result: 'no to-dos',
      });
      expect(result.webmcpTools).toEqual(['todos_peek']);
    },
    testTimeout,
  );
});

describe('log.jsonl', () => {
  it(
    'writes every event with the common fields, cut tool results and screenshot file names',
    async () => {
      const model = scriptedModel([
        {
          text: 'Let me look.',
          reasoning: 'I should read the page.',
          toolCalls: [{ name: 'read_page' }, { name: 'screenshot' }],
        },
        { text: 'Answering.' },
        finish(true, 'Water the plants'),
      ]);
      // Make the page long enough that the logged read_page result gets cut.
      const { result, log, events, runDir } = await run(model, {
        onPage: async (page) => {
          await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => {
            for (let i = 0; i < 100; i++) {
              const p = document.createElement('p');
              p.textContent = 'Filler paragraph number ' + i;
              document.body.append(p);
            }
          });`);
        },
      });

      expect(events).toEqual(log);
      expect(log.map((r) => r.event)).toEqual([
        'lane_start',
        'model_call',
        'tool_call',
        'tool_call',
        'model_call',
        'reminder',
        'model_call',
        'finish',
        'check',
        'lane_end',
      ]);
      for (const record of log) {
        expect(record).toMatchObject({
          lane: 'baseline',
          scenario: 'first-open-todo',
          attempt: 1,
        });
        expect(record.t).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        expect(LOG_EVENTS).toContain(record.event);
      }

      const [modelCall] = eventsNamed(log, 'model_call');
      expect(modelCall).toMatchObject({
        step: 1,
        text: 'Let me look.',
        reasoning: 'I should read the page.',
        finishReason: 'tool-calls',
        toolCalls: [
          { id: 'call-1-1', name: 'read_page', input: {} },
          { id: 'call-1-2', name: 'screenshot', input: {} },
        ],
        usage: {
          input: 1_000,
          cacheRead: 0,
          cacheWrite: 0,
          output: 100,
          reasoning: 20,
          raw: { input_tokens: 1_000 },
        },
      });
      expect(modelCall!.costUsd).toBeCloseTo((1_000 * 0.1 + 100 * 0.5) / 1e6, 12);

      const [readPage, screenshot] = eventsNamed(log, 'tool_call');
      expect((readPage!.result as string).length).toBeLessThanOrEqual(LOG_RESULT_LIMIT + 30);
      expect(readPage!.result).toMatch(/\.\.\. \(cut, \d+ chars\)$/);
      expect(screenshot).toMatchObject({
        screenshot: '001-first-open-todo-attempt-1.jpg',
        result: '[screenshot 001-first-open-todo-attempt-1.jpg]',
      });
      expect(await readdir(join(runDir, 'baseline', 'screenshots'))).toEqual([
        '001-first-open-todo-attempt-1.jpg',
      ]);

      const end = log.at(-1)!;
      expect(end).toMatchObject({
        outcome: 'pass',
        reason: null,
        answer: 'Water the plants',
        steps: 3,
        toolCallsTotal: 2,
        screenshots: 1,
      });
      expect(end.tokens).toEqual(result.tokens);
      expect(result.tokens).toMatchObject({ input: 3_000, output: 300, reasoning: 60 });
      expect(result.tokens.screenshotEstimate).toBeGreaterThan(0);
      expect(result.costUsd).toBeCloseTo((3 * (1_000 * 0.1 + 100 * 0.5)) / 1e6, 12);
    },
    testTimeout,
  );
});
