import { describe, expect, it } from 'vitest';
import { ApiKeys, checkKey, type KeyCheck } from './keys.ts';

const ANTHROPIC_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD';

interface Captured {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
}

function stubFetch(respond: () => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      method: init?.method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('checkKey', () => {
  it('lists Anthropic models with the key and API version headers', async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: [] }));
    await expect(checkKey('anthropic', ANTHROPIC_KEY, { fetch })).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        method: 'GET',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      },
    ]);
  });

  it('lists OpenAI models with a bearer token', async () => {
    const { fetch, calls } = stubFetch(() => json(200, { data: [] }));
    await expect(checkKey('openai', OPENAI_KEY, { fetch })).resolves.toEqual({ ok: true });
    expect(calls[0]).toEqual({
      url: 'https://api.openai.com/v1/models',
      method: 'GET',
      headers: { authorization: `Bearer ${OPENAI_KEY}` },
    });
  });

  it('reports a rejected key with the provider message and without the key', async () => {
    const { fetch } = stubFetch(() =>
      json(401, {
        error: { type: 'authentication_error', message: `invalid x-api-key ${ANTHROPIC_KEY}` },
      }),
    );
    const check = await checkKey('anthropic', ANTHROPIC_KEY, { fetch });
    expect(check).toEqual<KeyCheck>({
      ok: false,
      status: 401,
      message: 'Anthropic rejected the API key (HTTP 401: invalid x-api-key [redacted]).',
    });
  });

  it('drops the masked key OpenAI echoes in its error', async () => {
    const { fetch } = stubFetch(() =>
      json(401, {
        error: {
          message:
            'Incorrect API key provided: sk-proj-************************************ABCD. You can find your API key at https://platform.openai.com/account/api-keys.',
        },
      }),
    );
    const check = await checkKey('openai', OPENAI_KEY, { fetch });
    expect(check).toMatchObject({
      ok: false,
      message:
        'OpenAI rejected the API key (HTTP 401: Incorrect API key provided: [redacted]. You can find your API key at https://platform.openai.com/account/api-keys.).',
    });
  });

  it('reports other HTTP failures and plain-text bodies', async () => {
    const { fetch } = stubFetch(() => new Response('upstream overloaded', { status: 503 }));
    await expect(checkKey('openai', OPENAI_KEY, { fetch })).resolves.toEqual({
      ok: false,
      status: 503,
      message: 'The OpenAI key check failed (HTTP 503: upstream overloaded).',
    });
  });

  it('reports a network failure without throwing', async () => {
    const { fetch } = stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(checkKey('openai', OPENAI_KEY, { fetch })).resolves.toEqual({
      ok: false,
      status: null,
      message: 'Could not reach the OpenAI API to check the key: fetch failed',
    });
  });
});

describe('ApiKeys', () => {
  it('prefers a pasted key, then a session key, then the environment', () => {
    const keys = new ApiKeys({ ANTHROPIC_API_KEY: ` ${ANTHROPIC_KEY} ` });
    expect(keys.resolve('anthropic')).toEqual({ key: ANTHROPIC_KEY, source: 'env' });
    expect(keys.resolve('anthropic', 'sk-ant-pasted-key-1234567890')).toEqual({
      key: 'sk-ant-pasted-key-1234567890',
      source: 'request',
    });
    keys.remember('anthropic', 'sk-ant-session-key-1234567890');
    expect(keys.resolve('anthropic')).toEqual({
      key: 'sk-ant-session-key-1234567890',
      source: 'session',
    });
    expect(keys.resolve('openai')).toBeNull();
  });

  it('reports which keys are present, never the keys themselves', () => {
    const keys = new ApiKeys({ OPENAI_API_KEY: OPENAI_KEY, ANTHROPIC_API_KEY: '  ' });
    const status = keys.status();
    expect(status).toEqual({
      anthropic: { envVar: 'ANTHROPIC_API_KEY', inEnv: false, inSession: false },
      openai: { envVar: 'OPENAI_API_KEY', inEnv: true, inSession: false },
    });
    expect(JSON.stringify(status)).not.toContain(OPENAI_KEY);
    expect(keys.all()).toEqual([OPENAI_KEY]);
  });
});
