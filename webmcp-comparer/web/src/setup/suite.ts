import { parseSuite, type SuiteError } from '../../../server/suite/parse.ts';
import { parseSiteUrl } from '../../../server/suite/start-url.ts';

export type { SuiteError };

/** The Suite as Setup sees it: the Scenario ids when valid, every error with its line otherwise. */
export type SuiteCheck =
  { ok: true; scenarios: ScenarioSummary[] } | { ok: false; errors: SuiteError[] };

export interface ScenarioSummary {
  id: string;
  prompt: string;
}

/** Validates the Suite with the same parser the server uses, so the browser and the Run agree. */
export function checkSuite(source: string): SuiteCheck {
  const result = parseSuite(source);
  return result.ok
    ? {
        ok: true,
        scenarios: result.suite.scenarios.map(({ id, prompt }) => ({ id, prompt })),
      }
    : { ok: false, errors: result.errors };
}

/** The Site URL problem, or null when it is a usable http(s) URL. */
export function siteUrlError(siteUrl: string): string | null {
  if (siteUrl.trim() === '') return 'Enter the Site URL.';
  try {
    parseSiteUrl(siteUrl);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
