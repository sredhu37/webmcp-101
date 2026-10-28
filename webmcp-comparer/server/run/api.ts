import { readFile } from 'node:fs/promises';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import { EFFORT, MODELS, defaultModel } from '../agent/models.ts';
import { createRedactor } from '../agent/redact.ts';
import { DEFAULT_LIMITS } from '../agent/run-lane.ts';
import { providers } from '../pricing/price-table.ts';
import { PROVIDER_NAMES, type ApiKeys } from './keys.ts';
import { RunError, type RunManager } from './orchestrator.ts';
import {
  isRunId,
  listRuns,
  readResults,
  readStream,
  runFolder,
  screenshotPath,
  zipRunFolder,
} from './run-folder.ts';
import { DEFAULT_ATTEMPTS, DEFAULT_SITE_URL, MAX_ATTEMPTS, parseRunRequest } from './settings.ts';

export interface RunApiOptions {
  manager: RunManager;
  keys: ApiKeys;
  /** The Suite prefilled in Setup; a placeholder Suite when the file is missing. */
  defaultSuiteFile: string;
}

/**
 * The Run HTTP API under `/api`. Keys are accepted in request bodies and never sent back; every
 * error message passes the redaction step of the Run that produced it.
 */
export async function registerRunApi(app: FastifyInstance, options: RunApiOptions): Promise<void> {
  await app.register((api, _opts, done) => {
    routes(api, options);
    done();
  });
}

function routes(app: FastifyInstance, options: RunApiOptions): void {
  const { manager, keys } = options;

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const redact = createRedactor([pastedKey(request.body), ...keys.all()]);
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    return reply.code(statusCode).send({ error: redact(error.message) });
  });

  app.get('/api/models', () => ({
    effort: EFFORT,
    providers: providers.map((provider) => ({
      id: provider,
      name: PROVIDER_NAMES[provider],
      defaultModel: defaultModel(provider).id,
    })),
    models: MODELS.map((model) => ({
      ...model,
      default: defaultModel(model.provider).id === model.id,
    })),
  }));

  app.get('/api/keys', () => keys.status());

  app.get('/api/defaults', async () => ({
    siteUrl: DEFAULT_SITE_URL,
    suite: await readDefaultSuite(options.defaultSuiteFile),
    provider: providers[0],
    model: defaultModel(providers[0]!).id,
    attempts: DEFAULT_ATTEMPTS,
    maxAttempts: MAX_ATTEMPTS,
    limits: DEFAULT_LIMITS,
  }));

  app.post('/api/preflight', async (request, reply) => {
    const parsed = parseRunRequest(request.body);
    if (!parsed.ok) return badRequest(reply, parsed);
    return manager.preflight(parsed.request);
  });

  app.post('/api/runs', async (request, reply) => {
    const parsed = parseRunRequest(request.body);
    if (!parsed.ok) return badRequest(reply, parsed);
    try {
      const run = await manager.start(parsed.request);
      return await reply.code(202).send({ id: run.id, results: run.results });
    } catch (error) {
      if (error instanceof RunError) {
        return reply.code(error.statusCode).send({
          error: error.message,
          ...(error.statusCode === 409 ? { running: manager.current?.id ?? null } : {}),
        });
      }
      throw error;
    }
  });

  app.get('/api/runs', async () => {
    const running = manager.current?.id ?? null;
    return { running, runs: await listRuns(manager.runsDir, running) };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (request, reply) => {
    const { id } = request.params;
    const current = manager.current;
    if (current?.id === id) return current.results;
    const results = await readResults(manager.runsDir, id);
    return results ?? notFound(reply, id);
  });

  app.post<{ Params: { id: string } }>('/api/runs/:id/stop', async (request, reply) => {
    const { id } = request.params;
    if (manager.stop(id)) return reply.code(202).send({ id, stopping: true });
    if (runFolder(manager.runsDir, id)) {
      return reply.code(409).send({ error: `Run ${id} is not running.` });
    }
    return notFound(reply, id);
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id/zip', async (request, reply) => {
    const { id } = request.params;
    const dir = runFolder(manager.runsDir, id);
    if (!dir) return notFound(reply, id);
    if (manager.current?.id === id) {
      return reply.code(409).send({ error: `Run ${id} is still going.` });
    }
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="webmcp-comparer-${id}.zip"`)
      .send(zipRunFolder(dir, id));
  });

  app.get<{ Params: { id: string; lane: string; file: string } }>(
    '/api/runs/:id/:lane/screenshots/:file',
    async (request, reply) => {
      const { id, lane, file } = request.params;
      const path = screenshotPath(manager.runsDir, id, lane, file);
      if (!path) return reply.code(404).send({ error: 'Screenshot not found.' });
      return reply.type('image/jpeg').send(readStream(path));
    },
  );
}

function badRequest(
  reply: FastifyReply,
  parsed: { errors: string[]; suiteErrors?: unknown },
): FastifyReply {
  return reply.code(400).send({
    error: parsed.errors.join(' '),
    errors: parsed.errors,
    ...(parsed.suiteErrors ? { suiteErrors: parsed.suiteErrors } : {}),
  });
}

function notFound(reply: FastifyReply, id: string): FastifyReply {
  return reply.code(404).send({ error: isRunId(id) ? `No Run ${id}.` : `Not a Run id: ${id}` });
}

function pastedKey(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const key = (body as { apiKey?: unknown }).apiKey;
  return typeof key === 'string' ? key.trim() : undefined;
}

/** Shown in Setup when the default Suite file does not exist, so the app still starts. */
export const PLACEHOLDER_SUITE = `# No Suite found at ../app/suite.yaml. Write your Scenarios here.
scenarios:
  - id: first-scenario
    prompt: Describe what the agent should do on the site.
`;

async function readDefaultSuite(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return PLACEHOLDER_SUITE;
    throw error;
  }
}
