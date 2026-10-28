import type { Page } from 'playwright';

export const CHECK_KINDS = [
  'urlContains',
  'textVisible',
  'elementExists',
  'script',
  'answerContains',
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/** One Success check, written in the Suite as `<kind>: <text>`. */
export type Check = { [K in CheckKind]: { [P in K]: string } }[CheckKind];

export interface CheckResult {
  check: Check;
  pass: boolean;
  /** Why the check failed, for the log; never part of the Outcome reason. */
  detail?: string;
}

export type SuccessDecision =
  { pass: true; checks: CheckResult[] } | { pass: false; reason: string; checks: CheckResult[] };

export interface FinishReport {
  success: boolean;
  answer: string;
}

export interface CheckOptions {
  /** Upper bound for each page operation, in milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function isCheckKind(value: string): value is CheckKind {
  return (CHECK_KINDS as readonly string[]).includes(value);
}

export function checkKind(check: Check): CheckKind {
  return Object.keys(check)[0] as CheckKind;
}

export function checkValue(check: Check): string {
  return (check as Record<CheckKind, string>)[checkKind(check)];
}

/** The check as written in the Suite, e.g. `urlContains: /cart`. */
export function describeCheck(check: Check): string {
  return `${checkKind(check)}: ${checkValue(check)}`;
}

/**
 * Decides whether a Lane that called `finish` passed: its Success checks decide
 * when the Scenario has any, otherwise the agent's own report does.
 */
export async function decideFinish(
  page: Page,
  finish: FinishReport,
  checks: readonly Check[] | undefined,
  options: CheckOptions = {},
): Promise<SuccessDecision> {
  if (!checks || checks.length === 0) {
    return finish.success
      ? { pass: true, checks: [] }
      : { pass: false, reason: 'agent reported failure', checks: [] };
  }
  return runChecks(page, checks, finish.answer, options);
}

/**
 * Evaluates every check on the final page and the `finish` answer. All must
 * pass; the reason names the first one that failed.
 */
export async function runChecks(
  page: Page,
  checks: readonly Check[],
  answer: string,
  options: CheckOptions = {},
): Promise<SuccessDecision> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (checks.some((check) => checkKind(check) !== 'answerContains')) {
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined);
  }

  const results: CheckResult[] = [];
  for (const check of checks) {
    results.push(await evaluateCheck(page, check, answer, timeoutMs));
  }
  const failed = results.find((result) => !result.pass);
  return failed
    ? { pass: false, reason: `check failed: ${describeCheck(failed.check)}`, checks: results }
    : { pass: true, checks: results };
}

export async function evaluateCheck(
  page: Page,
  check: Check,
  answer: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<CheckResult> {
  const value = checkValue(check);
  try {
    switch (checkKind(check)) {
      case 'urlContains': {
        const url = page.url();
        return url.includes(value) ? { check, pass: true } : fail(check, `final URL: ${url}`);
      }
      case 'textVisible': {
        const text = await page.locator('body').innerText({ timeout: timeoutMs });
        return containsText(text, value) ? { check, pass: true } : fail(check, 'text not visible');
      }
      case 'elementExists': {
        const count = await withTimeout(page.locator(`css=${value}`).count(), timeoutMs);
        return count > 0 ? { check, pass: true } : fail(check, 'no matching element');
      }
      case 'script': {
        const result: unknown = await withTimeout(page.evaluate(value), timeoutMs);
        return result === true
          ? { check, pass: true }
          : fail(check, `returned ${describeValue(result)}`);
      }
      case 'answerContains':
        return containsText(answer, value)
          ? { check, pass: true }
          : fail(check, 'answer does not contain the text');
    }
  } catch (error) {
    return fail(check, error instanceof Error ? firstLine(error.message) : String(error));
  }
}

/** Case-insensitive substring match; runs of whitespace count as one space. */
export function containsText(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function fail(check: Check, detail: string): CheckResult {
  return { check, pass: false, detail };
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'bigint') return `${value}n`;
  return JSON.stringify(value);
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0]!;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
