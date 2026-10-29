import { dynamicTool, jsonSchema, type ToolResultPart, type ToolSet } from 'ai';
import { FINISH_TOOL_NAME } from '../lane/browser-tools.ts';
import type { JsonSchema, LaneTool, ToolResult } from '../lane/tool.ts';
import type { FinishReport } from '../suite/checks.ts';
import type { ToolNameMap } from './tool-names.ts';

export type ToolResultOutput = ToolResultPart['output'];

export const FINISH_DESCRIPTION =
  'End the task. Call once when the task is done, or when you are sure it cannot be done.';

export const FINISH_INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: 'Whether the task was completed.' },
    answer: {
      type: 'string',
      description: 'The answer, for a question; a one-line summary of what you did, for an action.',
    },
  },
  required: ['success', 'answer'],
  additionalProperties: false,
};

/**
 * The tools offered to the model for one Step, under their model names. The loop executes tool
 * calls itself, one at a time and in order, so these definitions carry no `execute`.
 */
export function modelToolSet(tools: readonly LaneTool[], names: ToolNameMap): ToolSet {
  const set: ToolSet = {};
  for (const tool of tools) {
    set[names.modelName(tool.name)] = dynamicTool({
      description: tool.description,
      inputSchema: jsonSchema(tool.inputSchema),
    });
  }
  set[FINISH_TOOL_NAME] = dynamicTool({
    description: FINISH_DESCRIPTION,
    inputSchema: jsonSchema(FINISH_INPUT_SCHEMA),
  });
  return set;
}

export function parseFinishInput(input: unknown): FinishReport | string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return 'finish needs an object with success and answer.';
  }
  const { success, answer } = input as Record<string, unknown>;
  if (typeof success !== 'boolean') return 'finish needs success: true or false.';
  if (typeof answer !== 'string') return 'finish needs answer as a string.';
  return { success, answer };
}

/** A Lane tool result as the model receives it: text, error text, or text and images. */
export function toModelOutput(result: Pick<ToolResult, 'isError' | 'content'>): ToolResultOutput {
  if (result.content.every((part) => part.type === 'text')) {
    const value = result.content.map((part) => part.text).join('\n');
    return result.isError ? { type: 'error-text', value } : { type: 'text', value };
  }
  return {
    type: 'content',
    value: result.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'file', mediaType: part.mediaType, data: { type: 'data', data: part.data } },
    ),
  };
}

/** A Lane tool result as text for the log: images are named, never embedded. */
export function resultText(result: ToolResult): string {
  return result.content
    .map((part) => {
      if (part.type === 'text') return part.text;
      return result.meta.screenshot
        ? `[screenshot ${result.meta.screenshot.fileName}]`
        : `[image ${part.mediaType}]`;
    })
    .join('\n');
}
