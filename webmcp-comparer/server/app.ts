import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { runsDir, defaultSuiteFile, viteConfigFile, webDist } from './paths.ts';
import { registerLiveTransport, type LiveHub, type LiveTransportOptions } from './live/live-hub.ts';
import { registerRunApi } from './run/api.ts';
import { ApiKeys } from './run/keys.ts';
import { RunManager, type RunManagerOptions } from './run/orchestrator.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** The Run orchestrator, for the live transport. */
    runs: RunManager;
    /** The live view: screencasts and live metrics over `GET /api/live` (WebSocket). */
    live: LiveHub;
  }
}

export interface RunApiAppOptions extends Partial<Omit<RunManagerOptions, 'keys'>> {
  /** Where API keys are read from; `.env` is loaded into `process.env` by main.ts. */
  env?: Readonly<Record<string, string | undefined>>;
  defaultSuiteFile?: string;
}

export interface AppOptions {
  /** Serve web/ through Vite with hot reload instead of the production build. */
  dev?: boolean;
  /** Folder holding the production build of web/. */
  webDist?: string;
  runs?: RunApiAppOptions;
  live?: Omit<LiveTransportOptions, 'refuseOtherUpgrades'>;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify();

  app.get('/api/health', () => ({ ok: true }));

  const { env, defaultSuiteFile: suiteFile, ...runOptions } = options.runs ?? {};
  const keys = new ApiKeys(env ?? process.env);
  const manager = new RunManager({ runsDir, ...runOptions, keys });
  app.decorate('runs', manager);
  app.addHook('preClose', () => manager.close());
  await registerRunApi(app, { manager, keys, defaultSuiteFile: suiteFile ?? defaultSuiteFile });
  app.decorate(
    'live',
    registerLiveTransport(app, manager, { ...options.live, refuseOtherUpgrades: !options.dev }),
  );

  if (options.dev) {
    await serveWithVite(app);
  } else {
    await serveBuild(app, options.webDist ?? webDist);
  }

  return app;
}

function isApiUrl(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

async function serveWithVite(app: FastifyInstance): Promise<void> {
  const [{ createServer }, { default: middie }] = await Promise.all([
    import('vite'),
    import('@fastify/middie'),
  ]);
  const vite = await createServer({
    configFile: viteConfigFile,
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server: app.server } },
  });
  app.addHook('preClose', () => vite.close());

  await app.register(middie);
  app.use((req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => {
    if (isApiUrl(req.url ?? '/')) {
      next();
    } else {
      vite.middlewares(req, res, next);
    }
  });
}

async function serveBuild(app: FastifyInstance, root: string): Promise<void> {
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`No web build in ${root}. Run "npm run build" first.`);
  }

  await app.register(fastifyStatic, { root });

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && !isApiUrl(request.url)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}
