// A stand-in for document.modelContext, so tests can list and run the tools a page registers.
export function installFakeModelContext() {
  const tools = new Map<string, WebMCP.ModelContextTool>();

  const modelContext = {
    registerTool(tool: WebMCP.ModelContextTool, options: WebMCP.ModelContextRegisterToolOptions = {}) {
      if (tools.has(tool.name)) return Promise.reject(new Error(`Tool ${tool.name} is already registered.`));
      tools.set(tool.name, tool);
      options.signal?.addEventListener('abort', () => tools.delete(tool.name));
      return Promise.resolve();
    },
  };
  Object.defineProperty(document, 'modelContext', { value: modelContext, configurable: true });

  return {
    names: () => [...tools.keys()].sort(),
    tool: (name: string) => tools.get(name),
    run: (name: string, input: Record<string, unknown> = {}) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool ${name} is not registered.`);
      return Promise.resolve(tool.execute(input, { signal: new AbortController().signal }));
    },
    uninstall: () => Reflect.deleteProperty(document, 'modelContext'),
  };
}
