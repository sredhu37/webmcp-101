import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('app server', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('production', () => {
    let webDist: string;

    beforeAll(async () => {
      webDist = await mkdtemp(join(tmpdir(), 'webmcp-comparer-web-'));
      await writeFile(join(webDist, 'index.html'), '<!doctype html><title>built app</title>');
      await writeFile(join(webDist, 'app.js'), 'console.log(1);');
    });

    afterAll(async () => {
      await rm(webDist, { recursive: true, force: true });
    });

    it('answers the health check', async () => {
      app = await createApp({ webDist });
      const response = await app.inject({ method: 'GET', url: '/api/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });

    it('serves the built index and static files', async () => {
      app = await createApp({ webDist });

      const index = await app.inject({ method: 'GET', url: '/' });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain('built app');

      const script = await app.inject({ method: 'GET', url: '/app.js' });
      expect(script.statusCode).toBe(200);
      expect(script.body).toBe('console.log(1);');
    });

    it('falls back to the index for client routes but not for unknown API routes', async () => {
      app = await createApp({ webDist });

      const page = await app.inject({ method: 'GET', url: '/runs/latest' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('built app');

      const api = await app.inject({ method: 'GET', url: '/api/missing' });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toEqual({ error: 'Not found' });
    });

    it('refuses to start without a build', async () => {
      await expect(createApp({ webDist: join(webDist, 'missing') })).rejects.toThrow(
        'npm run build',
      );
    });
  });

  describe('dev', () => {
    it('serves web/ through Vite and keeps API routes on Fastify', async () => {
      app = await createApp({ dev: true });

      const index = await app.inject({
        method: 'GET',
        url: '/',
        headers: { accept: 'text/html' },
      });
      expect(index.statusCode).toBe(200);
      expect(index.body).toContain('/@vite/client');
      expect(index.body).toContain('<div id="root"></div>');

      const health = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { accept: '*/*' },
      });
      expect(health.json()).toEqual({ ok: true });
    });
  });
});
