import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { ModelHandle } from '../agent/models.ts';
import type { Provider } from '../pricing/price-table.ts';

type CallOptions = MockLanguageModelV4['doStreamCalls'][number];

type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never;

export interface ScriptedToolCall {
  name: string;
  /** Sent as JSON; a string is sent as is, to script unparsable input. */
  input?: unknown;
}

export interface ScriptedUsage {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
  output?: number;
  reasoning?: number;
}

/** One model reply: text, tool calls or both; or a failure; or a call that never answers. */
export type ScriptedReply =
  | { text?: string; reasoning?: string; toolCalls?: ScriptedToolCall[]; usage?: ScriptedUsage }
  | { error: Error }
  | { hang: true };

export interface ScriptedModel extends ModelHandle {
  mock: MockLanguageModelV4;
  /** The options of every model call, in order. */
  calls: CallOptions[];
}

const DEFAULT_USAGE: Required<ScriptedUsage> = {
  input: 1_000,
  cacheRead: 0,
  cacheWrite: 0,
  output: 100,
  reasoning: 20,
};

/**
 * A mock model answering each Step with the next scripted reply. `replies` may be a function of
 * the Step index, for scripts that repeat forever.
 */
export function scriptedModel(
  replies: ScriptedReply[] | ((index: number) => ScriptedReply),
  options: {
    provider?: Provider;
    modelId?: string;
    /** Each reply waits this long first (aborted with the call), to make Steps take time. */
    delayMs?: number;
  } = {},
): ScriptedModel {
  const provider = options.provider ?? 'anthropic';
  const modelId = options.modelId ?? (provider === 'anthropic' ? 'claude-haiku-5-5' : 'gpt-6-luna');
  let index = 0;
  const next = (): ScriptedReply => {
    const reply = typeof replies === 'function' ? replies(index) : replies[index];
    index += 1;
    if (!reply) throw new Error(`The script has no reply ${index}`);
    return reply;
  };

  const mock = new MockLanguageModelV4({
    provider: `${provider}.mock`,
    modelId,
    doStream: async (call) => {
      if (options.delayMs) await delay(options.delayMs, call.abortSignal);
      const reply = next();
      if ('error' in reply) throw reply.error;
      if ('hang' in reply) return { stream: hangingStream(call.abortSignal) };
      return { stream: convertArrayToReadableStream(replyParts(reply, index)) };
    },
  });
  return { provider, modelId, model: mock, mock, calls: mock.doStreamCalls };
}

function replyParts(
  reply: Exclude<ScriptedReply, { error: Error } | { hang: true }>,
  index: number,
): StreamPart[] {
  const usage = { ...DEFAULT_USAGE, ...reply.usage };
  const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  if (reply.reasoning) {
    const id = `r${index}`;
    parts.push(
      { type: 'reasoning-start', id },
      { type: 'reasoning-delta', id, delta: reply.reasoning },
      { type: 'reasoning-end', id },
    );
  }
  if (reply.text) {
    const id = `t${index}`;
    parts.push(
      { type: 'text-start', id },
      { type: 'text-delta', id, delta: reply.text },
      { type: 'text-end', id },
    );
  }
  const toolCalls = reply.toolCalls ?? [];
  toolCalls.forEach((call, n) => {
    parts.push({
      type: 'tool-call',
      toolCallId: `call-${index}-${n + 1}`,
      toolName: call.name,
      input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? {}),
    });
  });
  parts.push({
    type: 'finish',
    finishReason:
      toolCalls.length > 0
        ? { unified: 'tool-calls', raw: 'tool_use' }
        : { unified: 'stop', raw: 'end_turn' },
    usage: {
      inputTokens: {
        total: usage.input + usage.cacheRead + usage.cacheWrite,
        noCache: usage.input,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
      },
      outputTokens: {
        total: usage.output,
        text: usage.output - usage.reasoning,
        reasoning: usage.reasoning,
      },
      raw: {
        input_tokens: usage.input,
        cache_read_input_tokens: usage.cacheRead,
        cache_creation_input_tokens: usage.cacheWrite,
        output_tokens: usage.output,
      },
    },
  });
  return parts;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** A response stream that stays silent until the call is aborted. */
function hangingStream(signal: AbortSignal | undefined): ReadableStream<StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      const abort = (): void => controller.error(signal?.reason ?? new Error('aborted'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    },
  });
}
