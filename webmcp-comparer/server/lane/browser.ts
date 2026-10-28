import { chromium, type Browser, type Page } from 'playwright';

export type LaneId = 'baseline' | 'webmcp';

export const VIEWPORT = { width: 1280, height: 800 } as const;

export const WEBMCP_FLAG = '--enable-features=WebMCP';

export interface LaneBrowserOptions {
  launchTimeoutMs?: number;
  /** Default bound for page actions such as clicks and snapshots. */
  actionTimeoutMs?: number;
  navigationTimeoutMs?: number;
}

export interface LaneBrowser {
  browser: Browser;
  page: Page;
  close(): Promise<void>;
}

const DEFAULTS = {
  launchTimeoutMs: 30_000,
  actionTimeoutMs: 5_000,
  navigationTimeoutMs: 15_000,
} as const;

/** The only launch difference between the Lanes is the WebMCP flag. */
export function chromiumArgs(lane: LaneId): string[] {
  return lane === 'webmcp' ? [WEBMCP_FLAG] : [];
}

/** A fresh headless Chromium for one Lane. */
export async function launchLaneChromium(
  lane: LaneId,
  options: LaneBrowserOptions = {},
): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: chromiumArgs(lane),
    timeout: options.launchTimeoutMs ?? DEFAULTS.launchTimeoutMs,
  });
}

/** A page in a new browser context, so cart and storage start empty. */
export async function openLanePage(
  browser: Browser,
  options: LaneBrowserOptions = {},
): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  context.setDefaultTimeout(options.actionTimeoutMs ?? DEFAULTS.actionTimeoutMs);
  context.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? DEFAULTS.navigationTimeoutMs);
  return context.newPage();
}

export async function launchLaneBrowser(
  lane: LaneId,
  options: LaneBrowserOptions = {},
): Promise<LaneBrowser> {
  const browser = await launchLaneChromium(lane, options);
  try {
    const page = await openLanePage(browser, options);
    return { browser, page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
