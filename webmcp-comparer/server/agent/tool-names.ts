/** Tool names both providers accept (OpenAI's rule; Anthropic's is the same or wider). */
export const MODEL_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const MAX_LENGTH = 64;

export interface ToolRename {
  /** The name the Lane tool has (the site's name, or `site_<name>` on a clash). */
  name: string;
  /** The name the model sees. */
  modelName: string;
}

/**
 * Maps Lane tool names to names the providers accept, for one Attempt. Valid names pass through;
 * others have every run of invalid characters replaced by `_`, are cut to 64 characters, and get
 * `_2`, `_3`, ... while the result is taken. A name keeps its model name for the whole Attempt.
 */
export class ToolNameMap {
  readonly #toModel = new Map<string, string>();
  readonly #fromModel = new Map<string, string>();

  /** `reserved` names map to themselves and are never given to another tool. */
  constructor(reserved: readonly string[] = []) {
    for (const name of reserved) this.#assign(name, name);
  }

  /** Assigns model names to any new names; returns the names that had to change. */
  add(names: readonly string[]): ToolRename[] {
    const fresh = [...new Set(names)].filter((name) => !this.#toModel.has(name));
    for (const name of fresh) {
      if (MODEL_TOOL_NAME_PATTERN.test(name) && !this.#fromModel.has(name)) {
        this.#assign(name, name);
      }
    }
    const renames: ToolRename[] = [];
    for (const name of fresh) {
      if (this.#toModel.has(name)) continue;
      const modelName = this.#free(sanitizeToolName(name));
      this.#assign(name, modelName);
      renames.push({ name, modelName });
    }
    return renames;
  }

  modelName(name: string): string {
    const modelName = this.#toModel.get(name);
    if (modelName === undefined) throw new Error(`Tool ${name} has no model name`);
    return modelName;
  }

  /** The Lane tool name behind a model name, if any. */
  laneName(modelName: string): string | undefined {
    return this.#fromModel.get(modelName);
  }

  #assign(name: string, modelName: string): void {
    this.#toModel.set(name, modelName);
    this.#fromModel.set(modelName, name);
  }

  #free(base: string): string {
    if (!this.#fromModel.has(base)) return base;
    for (let n = 2; ; n++) {
      const suffix = `_${n}`;
      const candidate = `${base.slice(0, MAX_LENGTH - suffix.length)}${suffix}`;
      if (!this.#fromModel.has(candidate)) return candidate;
    }
  }
}

export function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, MAX_LENGTH);
  return cleaned === '' || cleaned === '_' ? 'tool' : cleaned;
}
