import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (white-label demo build)', () => {
  it('uses the demo product identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('灵境课堂');
    expect(DEFAULT_BRAND.shortName).toBe('灵境');
    expect(DEFAULT_BRAND.markSrc).toBe('/lingjing-mark.png');
    expect(DEFAULT_BRAND.themeColor).toBe('#315846');
  });

  it('marks its full logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(true);
    expect(DEFAULT_BRAND.logoSrc).toBe('/lingjing-logo.png');
  });
});
