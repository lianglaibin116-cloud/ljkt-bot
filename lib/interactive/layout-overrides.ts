import { injectIntoDocumentHead } from '@/lib/utils/html-document';

export interface InteractiveLayoutOverride {
  readonly selector: string;
  readonly x: number;
  readonly y: number;
}

const SIMPLE_SELECTOR = String.raw`(?:#[a-z][a-z0-9_-]*|[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9_-]*)*(?::nth-of-type\([1-9][0-9]*\))?)`;
const SAFE_SELECTOR = new RegExp(`^${SIMPLE_SELECTOR}(?:\\s*>\\s*${SIMPLE_SELECTOR})*$`, 'i');
const LAYOUT_STYLE_BLOCK =
  /<style\b(?=[^>]*\bdata-maic-interactive-layout(?:\s|=|>))[^>]*>[\s\S]*?<\/style\s*>/i;
const LAYOUT_STYLE_CONTENT =
  /<style\b(?=[^>]*\bdata-maic-interactive-layout(?:\s|=|>))[^>]*>([\s\S]*?)<\/style\s*>/i;
const LAYOUT_RULE =
  /([^{}]+)\{\s*translate:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))px\s+(-?(?:\d+(?:\.\d+)?|\.\d+))px\s*!important;?\s*\}/gi;
const MAX_TRANSLATION = 4096;

export function normalizeInteractiveLayoutOverride(
  value: unknown,
): InteractiveLayoutOverride | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<InteractiveLayoutOverride>;
  if (
    typeof candidate.selector !== 'string' ||
    candidate.selector.length > 512 ||
    !SAFE_SELECTOR.test(candidate.selector) ||
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    Math.abs(candidate.x) > MAX_TRANSLATION ||
    Math.abs(candidate.y) > MAX_TRANSLATION
  ) {
    return null;
  }
  return {
    selector: candidate.selector,
    x: cleanNumber(candidate.x),
    y: cleanNumber(candidate.y),
  };
}

export function readInteractiveLayoutOverrides(html: string): InteractiveLayoutOverride[] {
  const style = html.match(LAYOUT_STYLE_CONTENT)?.[1];
  if (!style) return [];

  const overrides = new Map<string, InteractiveLayoutOverride>();
  for (const match of style.matchAll(LAYOUT_RULE)) {
    const override = normalizeInteractiveLayoutOverride({
      selector: match[1]?.trim(),
      x: Number(match[2]),
      y: Number(match[3]),
    });
    if (override) overrides.set(override.selector, override);
  }
  return [...overrides.values()];
}

export function writeInteractiveLayoutOverrides(html: string, values: readonly unknown[]): string {
  const overrides = new Map<string, InteractiveLayoutOverride>();
  for (const value of values) {
    const override = normalizeInteractiveLayoutOverride(value);
    if (override) overrides.set(override.selector, override);
  }

  const rules = [...overrides.values()]
    .map(
      ({ selector, x, y }) =>
        `${selector} { translate: ${formatNumber(x)}px ${formatNumber(y)}px !important; }`,
    )
    .join('\n');
  const style = `<style data-maic-interactive-layout="v1">\n${rules}\n</style>`;
  return LAYOUT_STYLE_BLOCK.test(html)
    ? html.replace(LAYOUT_STYLE_BLOCK, style)
    : injectIntoDocumentHead(html, style);
}

export function countInteractiveLayoutChanges(
  initial: readonly InteractiveLayoutOverride[],
  current: readonly InteractiveLayoutOverride[],
): number {
  const initialBySelector = new Map(initial.map((item) => [item.selector, item]));
  let changes = 0;
  for (const item of current) {
    const previous = initialBySelector.get(item.selector);
    if (!previous || previous.x !== item.x || previous.y !== item.y) changes += 1;
    initialBySelector.delete(item.selector);
  }
  return changes + initialBySelector.size;
}

function cleanNumber(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatNumber(value: number): string {
  return String(cleanNumber(value));
}
