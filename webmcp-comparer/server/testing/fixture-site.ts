import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

const fixtureDir = new URL('../../test/fixture/', import.meta.url);

/** The test-only Suite for the fixture site. */
export const fixtureSuiteFile = fileURLToPath(new URL('suite.yaml', fixtureDir));

export interface RunningFixtureSite {
  baseUrl: string;
  close(): Promise<void>;
}

/** The to-do fixture site (test/fixture/) on a random local port, for integration tests. */
export async function startFixtureSite(): Promise<RunningFixtureSite> {
  const [page, script] = await Promise.all([
    readFile(new URL('page.html', fixtureDir), 'utf8'),
    readFile(new URL('todos.js', fixtureDir), 'utf8'),
  ]);
  const pages = new Set(['/', '/done', '/new']);

  const app = Fastify();
  app.get('/favicon.ico', (_request, reply) => reply.code(204).send());
  app.get('/todos.js', (_request, reply) => reply.type('text/javascript').send(script));
  app.get('/*', (request, reply) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    return reply
      .code(pages.has(pathname) ? 200 : 404)
      .type('text/html; charset=utf-8')
      .send(page);
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  return {
    baseUrl: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`,
    close: () => app.close(),
  };
}
