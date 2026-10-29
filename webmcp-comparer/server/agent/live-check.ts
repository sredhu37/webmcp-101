/**
 * One tiny real call per model, to confirm effort medium is accepted, an image inside a tool
 * result goes through, and which usage fields each provider reports. Reads ANTHROPIC_API_KEY and
 * OPENAI_API_KEY from the environment or `.env`; models without a key are skipped.
 *
 *   npm run live-check                      all six models
 *   npm run live-check -- claude-haiku-5-5  only the named models
 */
import { existsSync } from 'node:fs';
import { streamText, type ModelMessage } from 'ai';
import { errorMessage } from '../lane/tool.ts';
import { computeCost } from '../pricing/cost.ts';
import { loadPriceTable } from '../pricing/price-table.ts';
import { normalizeUsage } from '../pricing/usage.ts';
import {
  API_KEY_ENV,
  EFFORT,
  EFFORT_PROVIDER_OPTIONS,
  MODELS,
  createModelHandle,
  type ModelInfo,
} from './models.ts';
import { SYSTEM_PROMPT, userMessage } from './prompts.ts';
import { createRedactor } from './redact.ts';
import { modelToolSet } from './tool-set.ts';
import { ToolNameMap } from './tool-names.ts';

/** A 32 x 32 red PNG, sent as the result of an earlier screenshot call. */
const RED_SQUARE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IyJCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ3LED3QqzauAAAAAElFTkSuQmCC';

if (existsSync('.env')) process.loadEnvFile('.env');

const keys = {
  anthropic: process.env[API_KEY_ENV.anthropic]?.trim() || undefined,
  openai: process.env[API_KEY_ENV.openai]?.trim() || undefined,
};
const redact = createRedactor([keys.anthropic, keys.openai]);
const print = (text: string): void => console.log(redact(text));

const wanted = process.argv.slice(2);
const unknown = wanted.filter((id) => !MODELS.some((model) => model.id === id));
if (unknown.length > 0) {
  print(`Unknown model: ${unknown.join(', ')}. Models: ${MODELS.map((m) => m.id).join(', ')}`);
  process.exit(2);
}
const selected = MODELS.filter((model) => wanted.length === 0 || wanted.includes(model.id));
const runnable = selected.filter((model) => keys[model.provider]);

if (runnable.length === 0) {
  print(
    `No API key: set ${[...new Set(selected.map((m) => API_KEY_ENV[m.provider]))].join(' and/or ')} ` +
      'in the environment or in .env, then run again. No calls were made.',
  );
  process.exit(2);
}
for (const model of selected.filter((m) => !keys[m.provider])) {
  print(`skip ${model.id}: ${API_KEY_ENV[model.provider]} is not set`);
}

const priceTable = await loadPriceTable();
let failures = 0;
for (const model of runnable) {
  try {
    await check(model, keys[model.provider]!);
  } catch (error) {
    failures += 1;
    print(`FAIL ${model.id}: ${errorMessage(error)}`);
  }
}
print(
  failures === 0
    ? `\nAll ${runnable.length} calls succeeded.`
    : `\n${failures} of ${runnable.length} calls failed.`,
);
process.exit(failures === 0 ? 0 : 1);

async function check(info: ModelInfo, apiKey: string): Promise<void> {
  const handle = createModelHandle(info.id, { apiKey });
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: userMessage(
        'What colour is the square in the screenshot? Answer in one word.',
        'http://localhost:4000/',
      ),
    },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call_live_1', toolName: 'screenshot', input: {} },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_live_1',
          toolName: 'screenshot',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'Screenshot of the visible page.' },
              {
                type: 'file',
                mediaType: 'image/png',
                data: { type: 'data', data: RED_SQUARE_PNG },
              },
            ],
          },
        },
      ],
    },
  ];
  const tools = modelToolSet(
    [
      {
        name: 'screenshot',
        description: 'Take a screenshot of the visible page.',
        inputSchema: { type: 'object', properties: {} },
        source: 'browser',
        execute: () => Promise.reject(new Error('not used')),
      },
    ],
    new ToolNameMap(['screenshot']),
  );

  const started = performance.now();
  let streamError: unknown;
  const stream = streamText({
    model: handle.model,
    instructions: SYSTEM_PROMPT,
    messages,
    tools,
    providerOptions: EFFORT_PROVIDER_OPTIONS[info.provider],
    maxRetries: 0,
    onError: ({ error }) => {
      streamError ??= error;
    },
  });
  for await (const part of stream.fullStream) {
    if (part.type === 'error') streamError ??= part.error;
  }
  if (streamError !== undefined) {
    throw new Error(errorMessage(streamError));
  }

  const metadata = await stream.providerMetadata;
  const serviceTier = metadata?.openai?.serviceTier;
  const usage = normalizeUsage(info.provider, await stream.usage, {
    serviceTier: typeof serviceTier === 'string' ? serviceTier : null,
  });
  const cost = computeCost(priceTable, info.id, usage);
  const toolCalls = (await stream.toolCalls).map((call) => ({
    name: call.toolName,
    input: call.input as unknown,
  }));
  const { raw, ...buckets } = usage;

  print(
    `\nOK ${info.id} (${info.provider}, effort ${EFFORT}) in ${Math.round(performance.now() - started)} ms`,
  );
  print(`  finish reason: ${await stream.finishReason}`);
  print(`  warnings: ${JSON.stringify((await stream.warnings) ?? [])}`);
  print(`  text: ${JSON.stringify(await stream.text)}`);
  print(`  tool calls: ${JSON.stringify(toolCalls)}`);
  print(`  normalized usage: ${JSON.stringify(buckets)}`);
  print(`  raw usage: ${JSON.stringify(raw)}`);
  print(`  cost: ${cost.costUsd === null ? `unpriced (${cost.reason})` : `$${cost.costUsd}`}`);
}
