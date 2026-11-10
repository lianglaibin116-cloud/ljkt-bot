// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PPTTableElement } from '@ljkt/dsl';
import { StaticTable } from '../../../src/elements/table/StaticTable';

const table: PPTTableElement = {
  id: 'table-1',
  type: 'table',
  left: 0,
  top: 0,
  width: 240,
  height: 80,
  rotate: 0,
  colWidths: [1],
  cellMinHeight: 80,
  outline: { width: 1, color: '#333333', style: 'solid' },
  data: [[{ id: 'cell-1', colspan: 1, rowspan: 1, text: 'Centered by default' }]],
};

describe('StaticTable', () => {
  it('vertically centers a cell when no explicit vertical alignment is stored', () => {
    const { container } = render(<StaticTable elementInfo={table} />);

    expect(
      (container.querySelector('.slide-renderer-cell-text') as HTMLElement).style.justifyContent,
    ).toBe('center');
  });

  it('uses unique keys when runtime cell ids are missing or duplicated', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtimeTable = {
      ...table,
      colWidths: [1 / 3, 1 / 3, 1 / 3],
      data: [
        [
          { colspan: 1, rowspan: 1, text: 'Missing id' },
          { id: 'duplicate', colspan: 1, rowspan: 1, text: 'Duplicate id A' },
          { id: 'duplicate', colspan: 1, rowspan: 1, text: 'Duplicate id B' },
        ],
      ],
    } as unknown as PPTTableElement;

    try {
      const { getByText } = render(<StaticTable elementInfo={runtimeTable} />);

      expect(getByText('Missing id')).toBeTruthy();
      expect(getByText('Duplicate id A')).toBeTruthy();
      expect(getByText('Duplicate id B')).toBeTruthy();
      expect(
        consoleError.mock.calls.filter(
          ([message]) => typeof message === 'string' && message.toLowerCase().includes('key'),
        ),
      ).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('normalizes malformed runtime rows instead of crashing the slide', () => {
    const runtimeTable = {
      ...table,
      data: [
        { id: 'flat-cell', colspan: 1, rowspan: 1, text: 'Flattened cell' },
        null,
        'invalid row',
        [{ id: 'valid-cell', colspan: 1, rowspan: 1, text: 'Valid nested cell' }],
      ],
    } as unknown as PPTTableElement;

    const { getByText, queryByText } = render(<StaticTable elementInfo={runtimeTable} />);

    expect(getByText('Flattened cell')).toBeTruthy();
    expect(getByText('Valid nested cell')).toBeTruthy();
    expect(queryByText('invalid row')).toBeNull();
  });
});
