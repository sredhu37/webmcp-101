import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { REMINDER, SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION, userMessage } from './prompts.ts';

async function spec(): Promise<string> {
  return readFile(new URL('../../docs/spec.md', import.meta.url), 'utf8');
}

describe('prompts', () => {
  it('uses the system prompt of spec section 6 word for word', async () => {
    const text = await spec();
    const block = /System prompt \(fixed[^\n]*\n\n```\n([\s\S]*?)\n```/.exec(text)?.[1];
    expect(block).toBeDefined();
    expect(SYSTEM_PROMPT).toBe(block);
    expect(SYSTEM_PROMPT_VERSION).toBe('1');
  });

  it('never mentions WebMCP', () => {
    expect(`${SYSTEM_PROMPT}\n${REMINDER}\n${userMessage('p', 'u')}`).not.toMatch(/webmcp|mcp/i);
  });

  it('uses the reminder of spec section 6', async () => {
    expect(await spec()).toContain(`Reminder (once, after a text-only reply): \`${REMINDER}\``);
  });

  it('builds the user message from the Prompt and the start URL', () => {
    expect(userMessage('Add a hat.', 'http://localhost:4000/products/black-hat')).toBe(
      'Task: Add a hat.\nYou are on: http://localhost:4000/products/black-hat',
    );
  });
});
