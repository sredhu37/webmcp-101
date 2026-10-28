import type { Page } from 'playwright';

export const READ_PAGE_LIMIT = 30_000;

export const TRUNCATED = '(truncated)';

/**
 * The page as Playwright's AI-mode aria snapshot. Elements carry refs like `[ref=e5]` that
 * `page.getByRef` resolves against the latest snapshot of the frame, so every `read_page`
 * replaces the refs of the one before.
 */
export async function readPage(page: Page, timeoutMs: number): Promise<string> {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  const snapshot = await page.ariaSnapshot({ mode: 'ai', timeout: timeoutMs });
  const title = await page.title();
  return truncate(`Page: ${title}\nURL: ${page.url()}\n\n${snapshot}`, READ_PAGE_LIMIT);
}

export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n${TRUNCATED}`;
}
