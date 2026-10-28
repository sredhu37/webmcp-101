import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Scenario } from '../suite/parse.ts';
import { startFixtureSite, type RunningFixtureSite } from '../testing/fixture-site.ts';
import { checkStartPageTools, webMcpWarnings } from './webmcp-check.ts';

const testTimeout = 30_000;
const SITE_TOOLS = ['add_todo', 'list_todos'];
const options = { settleMs: 300, pollMs: 50, startPageTimeoutMs: 5_000 };

let site: RunningFixtureSite;
let plain: Server;
let plainUrl: string;

beforeAll(async () => {
  site = await startFixtureSite();
  plain = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><title>No tools</title><p>Nothing to see.</p>');
  });
  await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
  plainUrl = `http://127.0.0.1:${(plain.address() as AddressInfo).port}`;
}, testTimeout);

afterAll(async () => {
  await site?.close();
  await new Promise((resolve) => plain?.close(resolve));
});

const scenario = (id: string, path?: string): Scenario => ({
  id,
  prompt: 'Do it.',
  ...(path ? { path } : {}),
});

describe('checkStartPageTools', () => {
  it(
    'lists the WebMCP tools of each selected start page',
    async () => {
      const results = await checkStartPageTools(
        site.baseUrl,
        [scenario('home'), scenario('new', '/new'), scenario('again')],
        options,
      );
      expect(results).toEqual([
        { scenario: 'home', startUrl: `${site.baseUrl}/`, tools: SITE_TOOLS, error: null },
        {
          scenario: 'new',
          startUrl: `${site.baseUrl}/new`,
          tools: ['add_todo', 'create_todo', 'list_todos'],
          error: null,
        },
        { scenario: 'again', startUrl: `${site.baseUrl}/`, tools: SITE_TOOLS, error: null },
      ]);
      expect(webMcpWarnings(results)).toEqual([]);
    },
    testTimeout,
  );

  it(
    'warns, without failing, when a start page has no WebMCP tools',
    async () => {
      const results = await checkStartPageTools(plainUrl, [scenario('plain')], options);
      expect(results).toEqual([
        { scenario: 'plain', startUrl: `${plainUrl}/`, tools: [], error: null },
      ]);
      expect(webMcpWarnings(results)).toEqual([
        `Scenario plain: the start page ${plainUrl}/ has no WebMCP tools, so the WebMCP lane only has Browser tools.`,
      ]);
    },
    testTimeout,
  );

  it(
    'warns when a start page cannot be opened',
    async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
      await new Promise((resolve) => closed.close(resolve));

      const results = await checkStartPageTools(url, [scenario('down')], options);
      expect(results[0]).toMatchObject({ scenario: 'down', tools: [] });
      expect(results[0]?.error).toContain('ERR_CONNECTION_REFUSED');
      expect(webMcpWarnings(results)[0]).toMatch(
        /^Scenario down: could not list WebMCP tools on http:\/\/127\.0\.0\.1:\d+\/: /,
      );
    },
    testTimeout,
  );
});
