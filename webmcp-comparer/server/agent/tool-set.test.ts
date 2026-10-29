import { describe, expect, it } from 'vitest';
import type { ToolResult } from '../lane/tool.ts';
import { parseFinishInput, resultText, toModelOutput } from './tool-set.ts';

const screenshot = {
  fileName: '001-s-attempt-1.jpg',
  path: '/tmp/001-s-attempt-1.jpg',
  width: 1280,
  height: 800,
};

describe('toModelOutput', () => {
  it('sends text as text and errors as error text', () => {
    expect(toModelOutput({ isError: false, content: [{ type: 'text', text: 'ok' }] })).toEqual({
      type: 'text',
      value: 'ok',
    });
    expect(
      toModelOutput({
        isError: true,
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ).toEqual({ type: 'error-text', value: 'a\nb' });
  });

  it('sends images as file content next to the text', () => {
    expect(
      toModelOutput({
        isError: false,
        content: [
          { type: 'text', text: 'Screenshot' },
          { type: 'image', data: 'QUJD', mediaType: 'image/jpeg' },
        ],
      }),
    ).toEqual({
      type: 'content',
      value: [
        { type: 'text', text: 'Screenshot' },
        { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: 'QUJD' } },
      ],
    });
  });
});

describe('resultText', () => {
  it('names a saved screenshot and never embeds image data', () => {
    const result: ToolResult = {
      isError: false,
      content: [
        { type: 'text', text: 'Screenshot' },
        { type: 'image', data: 'QUJD', mediaType: 'image/jpeg' },
      ],
      meta: { screenshot },
    };
    expect(resultText(result)).toBe('Screenshot\n[screenshot 001-s-attempt-1.jpg]');
    expect(
      resultText({
        ...result,
        content: [{ type: 'image', data: 'QUJD', mediaType: 'image/png' }],
        meta: {},
      }),
    ).toBe('[image image/png]');
  });
});

describe('parseFinishInput', () => {
  it('accepts success and answer', () => {
    expect(parseFinishInput({ success: false, answer: '' })).toEqual({
      success: false,
      answer: '',
    });
  });

  it.each([
    [null, 'finish needs an object with success and answer.'],
    [[true], 'finish needs an object with success and answer.'],
    [{ success: 'true', answer: 'x' }, 'finish needs success: true or false.'],
    [{ success: true }, 'finish needs answer as a string.'],
  ])('rejects %j', (input, message) => {
    expect(parseFinishInput(input)).toBe(message);
  });
});
