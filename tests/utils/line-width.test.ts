import { describe, expect, it } from 'vitest';

import { getRenderableLineWidth } from '@/lib/utils/element';

describe('getRenderableLineWidth', () => {
  it('preserves normal strokes and repairs values that would cover the slide', () => {
    expect(getRenderableLineWidth(3)).toBe(3);
    expect(getRenderableLineWidth(12)).toBe(12);
    expect(getRenderableLineWidth(880)).toBe(3);
    expect(getRenderableLineWidth(0)).toBe(3);
    expect(getRenderableLineWidth(Number.NaN)).toBe(3);
  });
});
