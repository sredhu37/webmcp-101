// Registers one WebMCP tool while the calling component is mounted.
import { useEffect, useRef } from 'react';

type Definition = Omit<WebMCP.ModelContextTool, 'execute'>;
type Execute<Input> = (input: Input, options: WebMCP.ToolExecuteCallbackOptions) => Promise<string>;

// Chrome gives the agent only a generic "invocation failed" when a tool throws.
// Returning the message as the result lets the agent read it and correct itself.
async function run<Input>(execute: Execute<Input>, input: Input, options: WebMCP.ToolExecuteCallbackOptions) {
  try {
    return await execute(input, options);
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

export function useWebMCPTool<Input extends object>(tool: Definition, execute: Execute<Input>) {
  // The tool is registered once, but it always calls the newest `execute`,
  // so it sees the component's current state and functions.
  const latestExecute = useRef(execute);
  useEffect(() => {
    latestExecute.current = execute;
  });

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) return; // Browser without WebMCP: the shop works as before.

    // Aborting the signal unregisters the tool.
    const controller = new AbortController();
    modelContext
      .registerTool(
        { ...tool, execute: (input, options) => run(latestExecute.current, input as Input, options) },
        { signal: controller.signal },
      )
      .catch((error: unknown) => {
        // Leaving the page before registration finishes aborts it. That is not a problem.
        if (!controller.signal.aborted) console.warn(`Could not register tool ${tool.name}`, error);
      });
    return () => controller.abort();
  }, [tool]);
}
