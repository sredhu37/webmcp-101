/**
 * The fixed prompts given to the agent in both Lanes. Change the text only together with
 * `SYSTEM_PROMPT_VERSION`, which every Run records.
 */

export const SYSTEM_PROMPT_VERSION = '1';

export const SYSTEM_PROMPT = `You are a browser agent completing a task on a website for a user.
Use only the tools provided.

- Stay on this website. Do not open other sites.
- The user cannot answer questions. If something is unclear, make a
  reasonable choice, or finish with success = false.
- If a tool returns an error, read it and try another way.
- When the task is done, or you are sure it cannot be done, call
  finish once:
    success: true or false
    answer:  the answer, for a question; a one-line summary of what
             you did, for an action.
- Every reply must call a tool.`;

export const REMINDER =
  'You replied without calling a tool. Continue with a tool call, or call finish if you are done.';

export function userMessage(prompt: string, startUrl: string): string {
  return `Task: ${prompt}\nYou are on: ${startUrl}`;
}
