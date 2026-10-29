import type { ElementHandle, Locator, Page } from 'playwright';
import type { JsonSchema, TargetMethod } from './tool.ts';

export type Target = { ref: string } | { selector: string } | { x: number; y: number };

export const TARGET_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'The element to act on. Give exactly one of: ref (from read_page), selector (CSS), or x and y (viewport coordinates in CSS pixels).',
  properties: {
    ref: { type: 'string', description: 'Element ref from the latest read_page, e.g. "e5"' },
    selector: { type: 'string', description: 'CSS selector' },
    x: { type: 'number', description: 'Viewport x coordinate' },
    y: { type: 'number', description: 'Viewport y coordinate' },
  },
  additionalProperties: false,
};

export class TargetError extends Error {}

/** Checks that the target names exactly one way to find the element. */
export function parseTarget(value: Record<string, unknown>): Target {
  const hasRef = value.ref !== undefined;
  const hasSelector = value.selector !== undefined;
  const hasPoint = value.x !== undefined || value.y !== undefined;
  if (Number(hasRef) + Number(hasSelector) + Number(hasPoint) !== 1) {
    throw new TargetError('target needs exactly one of: ref, selector, or x and y');
  }
  if (hasRef) return { ref: value.ref as string };
  if (hasSelector) return { selector: value.selector as string };
  if (value.x === undefined || value.y === undefined) {
    throw new TargetError('target needs both x and y');
  }
  return { x: value.x as number, y: value.y as number };
}

export function targetMethod(target: Target): TargetMethod {
  if ('ref' in target) return 'ref';
  if ('selector' in target) return 'selector';
  return 'coordinates';
}

export type ResolvedTarget =
  { kind: 'element'; locator: Locator; note: string } | { kind: 'point'; x: number; y: number };

/**
 * Finds the element without waiting: an unknown or stale ref and a selector without a match fail
 * at once with an error that tells the agent what to do. A selector matching several elements
 * picks the first.
 */
export async function resolveTarget(page: Page, target: Target): Promise<ResolvedTarget> {
  if ('ref' in target) {
    const locator = page.getByRef(target.ref);
    const count = await locator.count().catch(() => 0);
    if (count === 0) {
      throw new TargetError(
        `ref "${target.ref}" is not on the page; refs come from the latest read_page, call it again`,
      );
    }
    return { kind: 'element', locator, note: `ref ${target.ref}` };
  }
  if ('selector' in target) {
    const locator = page.locator(`css=${target.selector}`);
    let count: number;
    try {
      count = await locator.count();
    } catch (error) {
      throw new TargetError(`invalid selector "${target.selector}"`, { cause: error });
    }
    if (count === 0) throw new TargetError(`no element matches selector "${target.selector}"`);
    const note =
      count === 1
        ? `selector ${target.selector}`
        : `selector ${target.selector} (first of ${count} matches)`;
    return { kind: 'element', locator: locator.first(), note };
  }
  const viewport = page.viewportSize();
  if (
    viewport &&
    (target.x < 0 || target.y < 0 || target.x >= viewport.width || target.y >= viewport.height)
  ) {
    throw new TargetError(
      `point (${target.x}, ${target.y}) is outside the ${viewport.width} x ${viewport.height} viewport`,
    );
  }
  return { kind: 'point', x: target.x, y: target.y };
}

/** The element at a viewport point, for actions that need an element rather than a mouse click. */
export async function elementAtPoint(page: Page, x: number, y: number): Promise<ElementHandle> {
  const handle = await page.evaluateHandle(`document.elementFromPoint(${x}, ${y})`);
  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    throw new TargetError(`no element at (${x}, ${y})`);
  }
  return element as ElementHandle;
}
