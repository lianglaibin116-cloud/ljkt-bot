import { describe, expect, it } from 'vitest';
import {
  countInteractiveLayoutChanges,
  normalizeInteractiveLayoutOverride,
  readInteractiveLayoutOverrides,
  writeInteractiveLayoutOverrides,
} from '@/lib/interactive/layout-overrides';

const html =
  '<!doctype html><html><head><title>demo</title></head><body><main id="panel"><button>Run</button></main></body></html>';

describe('interactive layout overrides', () => {
  it('accepts bounded positions and safe selectors', () => {
    expect(
      normalizeInteractiveLayoutOverride({
        selector: 'main.panel > button:nth-of-type(2)',
        x: 12.345,
        y: -8.1,
      }),
    ).toEqual({ selector: 'main.panel > button:nth-of-type(2)', x: 12.35, y: -8.1 });

    expect(normalizeInteractiveLayoutOverride({ selector: '#panel;body', x: 2, y: 3 })).toBeNull();
    expect(normalizeInteractiveLayoutOverride({ selector: '#panel', x: 4097, y: 0 })).toBeNull();
    expect(
      normalizeInteractiveLayoutOverride({ selector: '#panel', x: Number.NaN, y: 0 }),
    ).toBeNull();
  });

  it('round-trips positions in a single style block while preserving authored markup', () => {
    const first = writeInteractiveLayoutOverrides(html, [
      { selector: '#panel', x: 24, y: -12 },
      { selector: 'main.panel > button', x: 5.5, y: 0 },
    ]);
    const updated = writeInteractiveLayoutOverrides(first, [{ selector: '#panel', x: 40, y: 16 }]);

    expect(updated).toContain('<body><main id="panel"><button>Run</button></main></body>');
    expect(updated.match(/data-maic-interactive-layout=/g)).toHaveLength(1);
    expect(readInteractiveLayoutOverrides(updated)).toEqual([{ selector: '#panel', x: 40, y: 16 }]);
  });

  it('counts moved, removed, and restored elements as draft changes', () => {
    expect(
      countInteractiveLayoutChanges(
        [
          { selector: '#first', x: 0, y: 0 },
          { selector: '#second', x: 10, y: 10 },
        ],
        [
          { selector: '#first', x: 0, y: 20 },
          { selector: '#third', x: 1, y: 1 },
        ],
      ),
    ).toBe(3);
  });
});
