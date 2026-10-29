import { errors, type Page } from 'playwright';
import { BROWSER_TOOL_NAMES, FINISH_TOOL_NAME } from './browser-tools.ts';
import { compileInputSchema } from './input-schema.ts';
import {
  errorMessage,
  errorResult,
  type JsonSchema,
  type LaneTool,
  type ToolContent,
  type ToolResult,
} from './tool.ts';

/** A tool as `page.webmcp.tools()` reports it. */
export interface WebMcpDescriptor {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: { readOnly?: boolean; untrustedContent?: boolean; consequential?: boolean };
}

export interface WebMcpToolChange {
  /** Tool names as the agent sees them. */
  added: string[];
  removed: string[];
  changed: string[];
}

export interface WebMcpRefresh {
  tools: LaneTool[];
  /** Null when the tool list is the same as at the last refresh. */
  change: WebMcpToolChange | null;
}

export interface WebMcpToolsOptions {
  callTimeoutMs?: number;
  listTimeoutMs?: number;
  /** Names a site tool must not take; it gets the `site_` prefix instead. */
  reservedNames?: readonly string[];
}

export const WEBMCP_CALL_TIMEOUT_MS = 15_000;

export const SITE_PREFIX = 'site_';

const EMPTY_INPUT_SCHEMA: JsonSchema = { type: 'object', properties: {} };

interface Entry {
  key: string;
  tool: LaneTool;
}

/**
 * The main frame's WebMCP tools as Lane tools. The site's tools change on navigation and late
 * registration, so the agent loop calls `refresh` before every Step.
 */
export class WebMcpTools {
  readonly #page: Page;
  readonly #callTimeoutMs: number;
  readonly #listTimeoutMs: number;
  readonly #reserved: ReadonlySet<string>;
  #entries = new Map<string, Entry>();

  constructor(page: Page, options: WebMcpToolsOptions = {}) {
    this.#page = page;
    this.#callTimeoutMs = options.callTimeoutMs ?? WEBMCP_CALL_TIMEOUT_MS;
    this.#listTimeoutMs = options.listTimeoutMs ?? 5_000;
    this.#reserved = new Set(options.reservedNames ?? [...BROWSER_TOOL_NAMES, FINISH_TOOL_NAME]);
  }

  get tools(): LaneTool[] {
    return [...this.#entries.values()].map((entry) => entry.tool);
  }

  async refresh(): Promise<WebMcpRefresh> {
    const descriptors = (await this.#page.webmcp.tools({
      timeout: this.#listTimeoutMs,
    })) as WebMcpDescriptor[];
    const names = exposedNames(
      descriptors.map((descriptor) => descriptor.name),
      this.#reserved,
    );

    const next = new Map<string, Entry>();
    const change: WebMcpToolChange = { added: [], removed: [], changed: [] };
    descriptors.forEach((descriptor, index) => {
      const name = names[index]!;
      const key = JSON.stringify(descriptor);
      const previous = this.#entries.get(name);
      if (previous?.key === key) {
        next.set(name, previous);
        return;
      }
      (previous ? change.changed : change.added).push(name);
      next.set(name, { key, tool: this.#tool(name, descriptor) });
    });
    for (const name of this.#entries.keys()) {
      if (!next.has(name)) change.removed.push(name);
    }

    this.#entries = next;
    const changed = change.added.length + change.removed.length + change.changed.length > 0;
    return { tools: this.tools, change: changed ? change : null };
  }

  #tool(name: string, descriptor: WebMcpDescriptor): LaneTool {
    const inputSchema = isObject(descriptor.inputSchema)
      ? descriptor.inputSchema
      : EMPTY_INPUT_SCHEMA;
    const { validate } = compileInputSchema(inputSchema);
    const page = this.#page;
    const timeout = this.#callTimeoutMs;
    const siteName = descriptor.name;
    const meta = { webmcpName: siteName };

    return {
      name,
      description: descriptor.description,
      inputSchema,
      source: 'webmcp',
      async execute(input) {
        const value = input ?? {};
        const check = validate(value);
        if (!check.ok) {
          return errorResult(`Invalid input for ${name}: ${check.message}.`, {
            ...meta,
            webmcpFailure: 'invalid_input',
          });
        }
        let raw: unknown;
        try {
          raw = await page.webmcp.callTool(siteName, value, { timeout });
        } catch (error) {
          if (page.isClosed() || !page.context().browser()?.isConnected()) throw error;
          if (error instanceof errors.TimeoutError) {
            return errorResult(`Tool ${name} did not respond within ${timeout / 1000} s.`, {
              ...meta,
              webmcpFailure: 'timeout',
            });
          }
          return errorResult(`Tool ${name} failed: ${errorMessage(error)}`, {
            ...meta,
            webmcpFailure: 'thrown',
          });
        }
        const result = normalizeWebMcpResult(raw);
        return {
          ...result,
          meta: result.isError ? { ...meta, webmcpFailure: 'tool_error' } : meta,
        };
      },
    };
  }
}

/**
 * A site tool takes the name it registered unless that is reserved; then it is `site_<name>`,
 * prefixed again while the result is still taken.
 */
export function exposedNames(
  siteNames: readonly string[],
  reserved: ReadonlySet<string>,
): string[] {
  const taken = new Set([...reserved, ...siteNames.filter((name) => !reserved.has(name))]);
  return siteNames.map((name) => {
    if (!reserved.has(name)) return name;
    let exposed = `${SITE_PREFIX}${name}`;
    while (taken.has(exposed)) exposed = `${SITE_PREFIX}${exposed}`;
    taken.add(exposed);
    return exposed;
  });
}

/**
 * Tool results come back in whatever shape the site's `execute` resolved to. MCP results pass
 * their `content` through; anything else becomes one text part.
 */
export function normalizeWebMcpResult(raw: unknown): Omit<ToolResult, 'meta'> {
  if (isObject(raw) && Array.isArray(raw.content)) {
    const content = raw.content.map(contentPart);
    return {
      isError: raw.isError === true,
      content: content.length > 0 ? content : [{ type: 'text', text: '(empty result)' }],
    };
  }
  if (typeof raw === 'string') return { isError: false, content: [{ type: 'text', text: raw }] };
  const text = raw === undefined || raw === null ? '(no result)' : JSON.stringify(raw);
  return { isError: false, content: [{ type: 'text', text }] };
}

function contentPart(part: unknown): ToolContent {
  if (isObject(part) && part.type === 'text' && typeof part.text === 'string') {
    return { type: 'text', text: part.text };
  }
  if (
    isObject(part) &&
    part.type === 'image' &&
    typeof part.data === 'string' &&
    typeof part.mimeType === 'string'
  ) {
    return { type: 'image', data: part.data, mediaType: part.mimeType };
  }
  return { type: 'text', text: JSON.stringify(part) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
