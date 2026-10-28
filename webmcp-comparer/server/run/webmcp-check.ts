import { launchLaneChromium, openLanePage, type LaneBrowserOptions } from '../lane/browser.ts';
import { errorMessage } from '../lane/tool.ts';
import type { WebMcpDescriptor } from '../lane/webmcp-adapter.ts';
import type { Scenario } from '../suite/parse.ts';
import { resolveStartUrl } from '../suite/start-url.ts';

/** The WebMCP tools a selected Scenario's start page registers. */
export interface StartPageTools {
  scenario: string;
  startUrl: string;
  /** Tool names as the site registered them, sorted. */
  tools: string[];
  /** Set when the start page could not be opened or its tools not listed. */
  error: string | null;
}

export interface WebMcpCheckOptions {
  browser?: LaneBrowserOptions;
  /** How long to keep listing an empty tool list after load, for late registration. */
  settleMs?: number;
  pollMs?: number;
  startPageTimeoutMs?: number;
}

/**
 * Opens each selected Scenario's start page in a WebMCP Chromium and lists its tools. A start
 * page shared by several Scenarios is opened once.
 */
export async function checkStartPageTools(
  siteUrl: string,
  scenarios: readonly Scenario[],
  options: WebMcpCheckOptions = {},
): Promise<StartPageTools[]> {
  const byUrl = new Map<string, Promise<Omit<StartPageTools, 'scenario'>>>();
  const browser = await launchLaneChromium('webmcp', options.browser);
  try {
    const results: StartPageTools[] = [];
    for (const scenario of scenarios) {
      const startUrl = resolveStartUrl(siteUrl, scenario);
      let check = byUrl.get(startUrl);
      if (!check) {
        check = listTools(startUrl, () => openLanePage(browser, options.browser), options);
        byUrl.set(startUrl, check);
      }
      results.push({ scenario: scenario.id, ...(await check) });
    }
    return results;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function listTools(
  startUrl: string,
  openPage: () => ReturnType<typeof openLanePage>,
  options: WebMcpCheckOptions,
): Promise<Omit<StartPageTools, 'scenario'>> {
  let page: Awaited<ReturnType<typeof openLanePage>> | undefined;
  try {
    page = await openPage();
    await page.goto(startUrl, { timeout: options.startPageTimeoutMs ?? 15_000 });
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => undefined);
    const settleUntil = performance.now() + (options.settleMs ?? 1_000);
    for (;;) {
      const tools = (await page.webmcp.tools({ timeout: 5_000 })) as WebMcpDescriptor[];
      if (tools.length > 0 || performance.now() >= settleUntil) {
        return { startUrl, tools: tools.map((tool) => tool.name).sort(), error: null };
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 200));
    }
  } catch (error) {
    return { startUrl, tools: [], error: errorMessage(error) };
  } finally {
    await page
      ?.context()
      .close()
      .catch(() => undefined);
  }
}

/** The warnings shown before a Run; none of them blocks it. */
export function webMcpWarnings(results: readonly StartPageTools[]): string[] {
  return results.flatMap((result) => {
    if (result.error) {
      return [
        `Scenario ${result.scenario}: could not list WebMCP tools on ${result.startUrl}: ${result.error}`,
      ];
    }
    if (result.tools.length === 0) {
      return [
        `Scenario ${result.scenario}: the start page ${result.startUrl} has no WebMCP tools, so the WebMCP lane only has Browser tools.`,
      ];
    }
    return [];
  });
}
