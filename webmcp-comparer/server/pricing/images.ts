import {
  findModelPrices,
  type ImageTokenRules,
  type PriceTable,
  type Provider,
} from './price-table.ts';

/**
 * Estimated input tokens for one image. Neither provider reports image tokens, so this is
 * an estimate from the documented patch formulas: Claude covers the image with 28 px patches
 * after fitting it to the model's edge and token limits; OpenAI covers it with 32 px patches
 * after its resize rules and multiplies the patch count by the model multiplier.
 */
export function estimateImageTokens(
  provider: Provider,
  rules: ImageTokenRules,
  width: number,
  height: number,
): number {
  const patches =
    provider === 'anthropic'
      ? claudePatches(rules, width, height)
      : openAIPatches(rules, width, height);
  return Math.ceil(roundOff(patches * rules.multiplier));
}

/** Estimated tokens for one screenshot sent to the model, or null when the model has no image rules. */
export function estimateScreenshotTokens(
  table: PriceTable,
  modelId: string,
  width: number,
  height: number,
): number | null {
  const found = findModelPrices(table, modelId);
  if (!found?.prices.image) return null;
  return estimateImageTokens(found.provider, found.prices.image, width, height);
}

function patchCount(width: number, height: number, patchPx: number): number {
  return Math.ceil(width / patchPx) * Math.ceil(height / patchPx);
}

function claudePatches(rules: ImageTokenRules, width: number, height: number): number {
  const [w, h] = claudeResizedSize(rules, width, height);
  return patchCount(w, h, rules.patchPx);
}

/** Largest aspect-preserving size within the edge and patch limits (Anthropic's reference algorithm). */
export function claudeResizedSize(
  rules: ImageTokenRules,
  width: number,
  height: number,
): [number, number] {
  const { patchPx } = rules;
  const maxEdge = rules.maxLongEdgePx ?? Infinity;
  const maxPatches = rules.maxPatches ?? Infinity;
  const fits = (w: number, h: number): boolean =>
    Math.ceil(w / patchPx) * patchPx <= maxEdge &&
    Math.ceil(h / patchPx) * patchPx <= maxEdge &&
    patchCount(w, h, patchPx) <= maxPatches;

  if (fits(width, height)) return [width, height];
  if (height > width) {
    const [h, w] = claudeResizedSize(rules, height, width);
    return [w, h];
  }
  const aspectRatio = width / height;
  const heightFor = (w: number): number => Math.max(roundTiesToEven(w / aspectRatio), 1);
  let lo = 1;
  let hi = width;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid, heightFor(mid))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lo, heightFor(lo)];
}

function openAIPatches(rules: ImageTokenRules, width: number, height: number): number {
  const { patchPx } = rules;
  let w = width;
  let h = height;
  const maxEdge = rules.maxLongEdgePx;
  if (maxEdge !== undefined && Math.max(w, h) > maxEdge) {
    const scale = maxEdge / Math.max(w, h);
    w = Math.max(Math.round(w * scale), 1);
    h = Math.max(Math.round(h * scale), 1);
  }

  const budget = rules.maxPatches;
  if (budget === undefined || patchCount(w, h, patchPx) <= budget) {
    return patchCount(w, h, patchPx);
  }
  const shrink = Math.sqrt((patchPx ** 2 * budget) / (w * h));
  const scaledW = (w * shrink) / patchPx;
  const scaledH = (h * shrink) / patchPx;
  const adjusted = shrink * Math.min(Math.floor(scaledW) / scaledW, Math.floor(scaledH) / scaledH);
  return patchCount(Math.floor(w * adjusted), Math.floor(h * adjusted), patchPx);
}

function roundTiesToEven(value: number): number {
  const floor = Math.floor(value);
  if (value - floor !== 0.5) return Math.round(value);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Drops binary floating point noise such as 1024 * 1.2 = 1228.8000000000002 before rounding up. */
function roundOff(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
