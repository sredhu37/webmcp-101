import { describe, expect, it } from 'vitest';
import { chromiumArgs, launchLaneBrowser, VIEWPORT, WEBMCP_FLAG, type LaneId } from './browser.ts';
import { screenshotFileName } from './screenshots.ts';

const launchTimeout = 30_000;

describe('Lane browser', () => {
  it('differs between the Lanes only by the WebMCP flag', () => {
    expect(chromiumArgs('baseline')).toEqual([]);
    expect(chromiumArgs('webmcp')).toEqual([WEBMCP_FLAG]);
    expect(WEBMCP_FLAG).toBe('--enable-features=WebMCP');
  });

  it(
    'launches a fresh headless Chromium at 1280 x 800 per Lane',
    async () => {
      const lanes: LaneId[] = ['baseline', 'webmcp'];
      const browsers = await Promise.all(lanes.map((lane) => launchLaneBrowser(lane)));
      try {
        for (const [index, { browser, page }] of browsers.entries()) {
          expect(page.viewportSize()).toEqual(VIEWPORT);
          expect(browser.contexts()).toHaveLength(1);
          await expect(page.evaluate('[innerWidth, innerHeight]')).resolves.toEqual([1280, 800]);
          const tools = page.webmcp.tools({ timeout: 2_000 });
          if (lanes[index] === 'webmcp') {
            await expect(tools).resolves.toEqual([]);
          } else {
            await expect(tools).rejects.toThrow(/WebMCP is not enabled/);
          }
        }
        expect(browsers[0]!.browser).not.toBe(browsers[1]!.browser);
      } finally {
        await Promise.all(browsers.map((lane) => lane.close()));
      }
    },
    launchTimeout,
  );
});

describe('screenshotFileName', () => {
  it('numbers with three digits, then grows', () => {
    expect(screenshotFileName(1, 'find-red-shirt', 1)).toBe('001-find-red-shirt-attempt-1.jpg');
    expect(screenshotFileName(42, 'checkout', 3)).toBe('042-checkout-attempt-3.jpg');
    expect(screenshotFileName(1000, 'x', 10)).toBe('1000-x-attempt-10.jpg');
  });
});
