import { API_KEY_ENV } from '../agent/models.ts';
import { REDACTED, createRedactor } from '../agent/redact.ts';
import { errorMessage } from '../lane/tool.ts';
import { providers, type Provider } from '../pricing/price-table.ts';

export const PROVIDER_NAMES: Record<Provider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
};

export type KeySource = 'request' | 'session' | 'env';

export interface ResolvedKey {
  key: string;
  source: KeySource;
}

export interface KeyStatus {
  envVar: string;
  /** A key is set in the environment or `.env`; the key itself is never returned. */
  inEnv: boolean;
  /** A key pasted earlier in this server session passed the key check and is kept in memory. */
  inSession: boolean;
}

/**
 * The API keys known to the server, in memory only. A key pasted in the UI overrides `.env` for
 * the session once it has passed the key check.
 */
export class ApiKeys {
  readonly #env: Readonly<Record<string, string | undefined>>;
  readonly #session = new Map<Provider, string>();

  constructor(env: Readonly<Record<string, string | undefined>>) {
    this.#env = env;
  }

  resolve(provider: Provider, pasted?: string): ResolvedKey | null {
    if (pasted) return { key: pasted, source: 'request' };
    const session = this.#session.get(provider);
    if (session) return { key: session, source: 'session' };
    const env = this.#fromEnv(provider);
    return env ? { key: env, source: 'env' } : null;
  }

  remember(provider: Provider, key: string): void {
    this.#session.set(provider, key);
  }

  status(): Record<Provider, KeyStatus> {
    return Object.fromEntries(
      providers.map((provider) => [
        provider,
        {
          envVar: API_KEY_ENV[provider],
          inEnv: this.#fromEnv(provider) !== undefined,
          inSession: this.#session.has(provider),
        },
      ]),
    ) as Record<Provider, KeyStatus>;
  }

  /** Every key the server knows, for the redaction step. */
  all(): string[] {
    return [
      ...this.#session.values(),
      ...providers.map((provider) => this.#fromEnv(provider)).filter((key) => key !== undefined),
    ];
  }

  #fromEnv(provider: Provider): string | undefined {
    return this.#env[API_KEY_ENV[provider]]?.trim() || undefined;
  }
}

/** Free models-list endpoints, used to check a key before any Lane starts. */
export const MODELS_LIST_URLS: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com/v1/models?limit=1',
  openai: 'https://api.openai.com/v1/models',
};

export const ANTHROPIC_VERSION = '2023-06-01';

const MASKED_KEY = /\bsk-[A-Za-z0-9_-]*\*{3,}[A-Za-z0-9_-]*/g;

export type KeyCheck = { ok: true } | { ok: false; status: number | null; message: string };

export interface KeyCheckOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/** One models-list call with the key. The message never contains the key. */
export async function checkKey(
  provider: Provider,
  key: string,
  options: KeyCheckOptions = {},
): Promise<KeyCheck> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const redactKey = createRedactor([key]);
  // OpenAI echoes a masked key (`sk-proj-****abcd`); its ends are part of the key, so drop it too.
  const redact = (text: string): string => redactKey(text).replace(MASKED_KEY, REDACTED);
  const name = PROVIDER_NAMES[provider];
  const headers: Record<string, string> =
    provider === 'anthropic'
      ? { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }
      : { authorization: `Bearer ${key}` };

  let response: Response;
  try {
    response = await fetchFn(MODELS_LIST_URLS[provider], {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: redact(`Could not reach the ${name} API to check the key: ${errorMessage(error)}`),
    };
  }
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true };
  }

  const detail = await responseError(response);
  const what =
    response.status === 401 || response.status === 403
      ? `${name} rejected the API key`
      : `The ${name} key check failed`;
  return {
    ok: false,
    status: response.status,
    message: redact(`${what} (HTTP ${response.status}${detail ? `: ${detail}` : ''}).`),
  };
}

/** The provider's error message from a JSON error body, if there is one. */
async function responseError(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return '';
  }
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON.
  }
  return text.trim().slice(0, 200);
}
