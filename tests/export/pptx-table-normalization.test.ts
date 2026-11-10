import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { PPTTableElement, Slide, TableCell } from '@ljkt/dsl';
import { buildPptxBlob, normalizeRuntimeTableData } from '@/lib/export/use-export-pptx';

const cell = (id: string, text: string): TableCell => ({
  id,
  text,
  colspan: 1,
  rowspan: 1,
});

function slideWith(element: PPTTableElement): Slide {
  return {
    id: 'slide',
    viewportSize: 960,
    viewportRatio: 0.5625,
    theme: {
      fontName: 'Arial',
      fontColor: '#000000',
      backgroundColor: '#ffffff',
      themeColors: ['#000000'],
    },
    elements: [element],
    background: { type: 'solid', color: '#ffffff' },
  };
}

describe('PPTX table normalization', () => {
  it('recovers one-dimensional generated table payloads as one-cell rows', () => {
    const first = cell('cell-1', '权限');
    const second = cell('cell-2', '角色');

    expect(normalizeRuntimeTableData([first, second])).toEqual([[first], [second]]);
  });

  it('exports a malformed generated table instead of passing an empty table to PptxGenJS', async () => {
    const element = {
      id: 'table',
      type: 'table',
      left: 100,
      top: 100,
      width: 600,
      height: 240,
      data: [cell('cell-1', '权限'), cell('cell-2', '角色')],
      colWidths: [1],
      rowHeights: [80, 80],
      cellMinHeight: 40,
      outline: { width: 1, style: 'solid', color: '#000000' },
    } as unknown as PPTTableElement;

    const blob = await buildPptxBlob([slideWith(element)], [], 0.5625, 960, 96, 96 / 72);
    const archive = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await archive.file('ppt/slides/slide1.xml')!.async('string');

    expect(xml).toContain('权限');
    expect(xml).toContain('角色');
  });
});
