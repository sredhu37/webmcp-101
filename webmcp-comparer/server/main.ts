import { existsSync } from 'node:fs';
import { createApp } from './app.ts';
import { envFile } from './paths.ts';

// API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY) stay in this process's memory only.
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = 3000;
const dev = process.argv.includes('--dev');

const app = await createApp({ dev });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: 'localhost', port });
console.log(`webMCP-comparer${dev ? ' (dev)' : ''} on http://localhost:${port}`);
