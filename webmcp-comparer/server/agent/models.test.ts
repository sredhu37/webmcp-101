import { streamText, type ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { bundledPriceTable, findModelPrices } from '../pricing/price-table.ts';
import {
  EFFORT_PROVIDER_OPTIONS,
  MODELS,
  createModelHandle,
  defaultModel,
  findModel,
  type ModelHandle,
} from './models.ts';
import { SYSTEM_PROMPT } from './prompts.ts';
import { modelToolSet } from './tool-set.ts';
import { ToolNameMap } from './tool-names.ts';

const KEY = 'test-key-not-real-0123456789';

interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** Builds the model with a fetch that records the request and answers 400, so nothing leaves the machine. */
function capturingModel(modelId: string): { handle: ModelHandle; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    });
    return Promise.resolve(
      new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'stub' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { handle: createModelHandle(modelId, { apiKey: KEY, fetch }), requests };
}

/** One Step with a screenshot tool result in the history, as the Lane loop sends it. */
async function sendStep(handle: ModelHandle): Promise<void> {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Task: look\nYou are on: http://localhost:4000/' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'screenshot', input: {} }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'screenshot',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'Screenshot 001.jpg' },
              { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: '/9j/AA==' } },
            ],
          },
        },
      ],
    },
  ];
  const stream = streamText({
    model: handle.model,
    instructions: SYSTEM_PROMPT,
    messages,
    tools: modelToolSet(
      [
        {
          name: 'screenshot',
          description: 'Screenshot',
          inputSchema: { type: 'object', properties: {} },
          source: 'browser',
          execute: () => Promise.reject(new Error('not called')),
        },
      ],
      new ToolNameMap(['screenshot']),
    ),
    providerOptions: EFFORT_PROVIDER_OPTIONS[handle.provider],
    maxRetries: 0,
    onError: () => undefined,
  });
  for await (const part of stream.fullStream) void part;
}

describe('model registry', () => {
  it('lists the six models of spec section 7 with their labels', () => {
    expect(MODELS.map((m) => [m.provider, m.id, m.label])).toEqual([
      ['anthropic', 'claude-haiku-5-5', 'recommended'],
      ['anthropic', 'claude-sonnet-5-5', 'ok'],
      ['anthropic', 'claude-opus-5-5', 'not recommended'],
      ['openai', 'gpt-6-luna', 'recommended'],
      ['openai', 'gpt-6.1-sol', 'ok'],
      ['openai', 'gpt-5.6-sol', 'not recommended'],
    ]);
    expect(defaultModel('anthropic').id).toBe('claude-haiku-5-5');
    expect(defaultModel('openai').id).toBe('gpt-6-luna');
    expect(findModel('gpt-4o')).toBeUndefined();
  });

  it('has a price for every model', () => {
    for (const model of MODELS) {
      expect(findModelPrices(bundledPriceTable(), model.id)?.provider).toBe(model.provider);
    }
  });

  it('refuses a model outside the lists', () => {
    expect(() => createModelHandle('anthropic/claude-haiku-5-5', { apiKey: KEY })).toThrow(
      'Unknown model: anthropic/claude-haiku-5-5',
    );
  });
});

describe('requests', () => {
  it.each(MODELS.filter((m) => m.provider === 'anthropic').map((m) => m.id))(
    '%s goes to the Anthropic API with the key, adaptive thinking and effort medium',
    async (modelId) => {
      const { handle, requests } = capturingModel(modelId);
      await sendStep(handle);

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request!.url).toBe('https://api.anthropic.com/v1/messages');
      expect(request!.headers.get('x-api-key')).toBe(KEY);
      expect(request!.body).toMatchObject({
        model: modelId,
        stream: true,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
      });
      const toolResult = (request!.body.messages as { content: unknown[] }[])[2]!.content[0];
      expect(toolResult).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'call_1',
        content: [
          { type: 'text', text: 'Screenshot 001.jpg' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AA==' } },
        ],
      });
    },
  );

  it.each(MODELS.filter((m) => m.provider === 'openai').map((m) => m.id))(
    '%s goes to the OpenAI Responses API with the key and reasoning effort medium',
    async (modelId) => {
      const { handle, requests } = capturingModel(modelId);
      await sendStep(handle);

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request!.url).toBe('https://api.openai.com/v1/responses');
      expect(request!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
      expect(request!.body).toMatchObject({
        model: modelId,
        stream: true,
        reasoning: { effort: 'medium' },
      });
      const output = (request!.body.input as { type?: string; output?: unknown }[]).find(
        (item) => item.type === 'function_call_output',
      );
      expect(output).toMatchObject({
        call_id: 'call_1',
        output: [
          { type: 'input_text', text: 'Screenshot 001.jpg' },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,/9j/AA==' },
        ],
      });
    },
  );
});
