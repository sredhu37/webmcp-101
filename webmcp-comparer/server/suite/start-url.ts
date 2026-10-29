import type { Scenario } from './parse.ts';

/**
 * The page a Scenario starts on: its `path` appended to the Site URL, or the
 * Site URL itself when it has none. The Site URL's own query and fragment are
 * dropped when a `path` is appended.
 */
export function resolveStartUrl(siteUrl: string, scenario: Pick<Scenario, 'path'>): string {
  const site = parseSiteUrl(siteUrl);
  if (scenario.path === undefined) return site.href;
  const base = site.pathname.replace(/\/+$/, '');
  return new URL(`${site.origin}${base}${scenario.path}`).href;
}

export function parseSiteUrl(siteUrl: string): URL {
  let url: URL;
  try {
    url = new URL(siteUrl.trim());
  } catch {
    throw new Error(`Site URL is not a valid URL: ${siteUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Site URL must start with http:// or https://: ${siteUrl}`);
  }
  return url;
}
