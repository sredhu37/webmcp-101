/**
 * Provider-neutral tool definitions shared by the Browser tools and the WebMCP tools. The agent
 * loop wraps each one for the model SDK; nothing here depends on a model provider.
 */

/** A JSON Schema object, as sent to the model and used to validate tool input. */
export type JsonSchema = Record<string, unknown>;

export type ToolSource = 'browser' | 'webmcp';

/** How a Browser tool call picked its element. */
export type TargetMethod = 'ref' | 'selector' | 'coordinates';

export type ToolContent =
  | { type: 'text'; text: string }
  /** `data` is base64 without a data URL prefix. */
  | { type: 'image'; data: string; mediaType: string };

export interface SavedScreenshot {
  fileName: string;
  path: string;
  width: number;
  height: number;
}

/** Why a WebMCP tool call returned an error to the agent. */
export type WebMcpFailure = 'invalid_input' | 'timeout' | 'thrown' | 'tool_error';

/** Facts about a tool call for the log and the metrics; never shown to the model. */
export interface ToolMeta {
  target?: TargetMethod;
  /** Set when the call took a screenshot, which counts towards the Lane's screenshots. */
  screenshot?: SavedScreenshot;
  /** Name the site registered, which differs from the tool name on a name clash. */
  webmcpName?: string;
  webmcpFailure?: WebMcpFailure;
}

export interface ToolResult {
  isError: boolean;
  content: ToolContent[];
  meta: ToolMeta;
}

export interface LaneTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  source: ToolSource;
  /** Never throws for a bad input or a failed page action: those come back as `isError` results. */
  execute(input: unknown): Promise<ToolResult>;
}

export function textResult(text: string, meta: ToolMeta = {}): ToolResult {
  return { isError: false, content: [{ type: 'text', text }], meta };
}

export function errorResult(text: string, meta: ToolMeta = {}): ToolResult {
  return { isError: true, content: [{ type: 'text', text }], meta };
}

/** First line of an error message, without Playwright's call log. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n', 1)[0]!.trim();
}
