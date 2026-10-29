import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openLaneOutput } from './lane-log.ts';
import { REDACTED, createRedactor, redactValue } from './redact.ts';

const ANTHROPIC_KEY = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const OPENAI_KEY = 'sk-proj-ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210abcdef';

describe('createRedactor', () => {
  it('replaces every occurrence of every known key', () => {
    const redact = createRedactor([ANTHROPIC_KEY, OPENAI_KEY]);
    expect(redact(`a ${ANTHROPIC_KEY} b ${OPENAI_KEY} c ${ANTHROPIC_KEY}`)).toBe(
      `a ${REDACTED} b ${REDACTED} c ${REDACTED}`,
    );
  });

  it('replaces a known key of any shape', () => {
    const redact = createRedactor(['my-custom-gateway-secret']);
    expect(redact('Bearer my-custom-gateway-secret')).toBe(`Bearer ${REDACTED}`);
  });

  it('replaces text shaped like a provider key even when the key is not known', () => {
    const redact = createRedactor([]);
    expect(redact(`key ${ANTHROPIC_KEY}.`)).toBe(`key ${REDACTED}.`);
    expect(redact(`key ${OPENAI_KEY}`)).toBe(`key ${REDACTED}`);
  });

  it('ignores empty and very short secrets and leaves ordinary text alone', () => {
    const redact = createRedactor(['', undefined, 'abc']);
    const text = 'The cheapest red shirt (sku sk-1) costs 19.99 abc';
    expect(redact(text)).toBe(text);
  });
});

describe('redactValue', () => {
  it('redacts strings at any depth, including keys, and keeps other values', () => {
    const redact = createRedactor([OPENAI_KEY]);
    expect(
      redactValue(
        { a: OPENAI_KEY, b: [1, true, null, { c: `x${OPENAI_KEY}x` }], [OPENAI_KEY]: 2 },
        redact,
      ),
    ).toEqual({ a: REDACTED, b: [1, true, null, { c: `x${REDACTED}x` }], [REDACTED]: 2 });
  });
});

describe('log.jsonl redaction', () => {
  it('never writes a known key, whatever field carries it', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'redact-'));
    const output = openLaneOutput(runDir, 'webmcp', createRedactor([ANTHROPIC_KEY, OPENAI_KEY]));
    const records = [
      output.log.write('s', 1, 'model_call', { text: `my key is ${ANTHROPIC_KEY}` }),
      output.log.write('s', 1, 'tool_call', {
        input: { text: OPENAI_KEY },
        result: `typed ${OPENAI_KEY}`,
      }),
      output.log.write('s', 1, 'error', {
        message: `401 Incorrect API key provided: ${OPENAI_KEY}`,
      }),
    ];

    const written = await readFile(output.log.path, 'utf8');
    expect(written).not.toContain(ANTHROPIC_KEY);
    expect(written).not.toContain(OPENAI_KEY);
    expect(written.match(/\[redacted\]/g)).toHaveLength(4);
    expect(
      written
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual(records);
    expect(records[1]).toMatchObject({ input: { text: REDACTED }, result: `typed ${REDACTED}` });
  });
});
