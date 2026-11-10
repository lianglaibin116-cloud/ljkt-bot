import type { ParsedPdfContent } from '@/lib/types/pdf';
// Import the narrow server-safe parser modules directly. The public package
// entry also exports browser rendering helpers that pull PDF.js into the
// server bundle, where it expects XMLHttpRequest.
import { buildPresentation } from '../../packages/@ljkt/importer/src/model/Presentation';
import { parseZip } from '../../packages/@ljkt/importer/src/parser/ZipParser';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function textFromTextBody(value: unknown): string[] {
  const body = asRecord(value);
  const paragraphs = Array.isArray(body?.paragraphs) ? body.paragraphs : [];
  return paragraphs
    .map((paragraph) => {
      const runs = asRecord(paragraph)?.runs;
      if (!Array.isArray(runs)) return '';
      return runs
        .map((run) => cleanText(asRecord(run)?.text))
        .filter(Boolean)
        .join('');
    })
    .map(cleanText)
    .filter(Boolean);
}

function xmlText(value: unknown): string {
  const node = asRecord(value);
  if (typeof node?.text !== 'function') return '';
  try {
    return cleanText((node.text as () => unknown)());
  } catch {
    return '';
  }
}

function collectNodeText(nodeValue: unknown, charts: Map<string, unknown>): string[] {
  const node = asRecord(nodeValue);
  if (!node) return [];

  switch (node.nodeType) {
    case 'shape':
      return textFromTextBody(node.textBody);
    case 'table': {
      if (!Array.isArray(node.rows)) return [];
      return node.rows
        .map((row) => {
          const cells = asRecord(row)?.cells;
          if (!Array.isArray(cells)) return '';
          return cells
            .map((cell) => textFromTextBody(asRecord(cell)?.textBody).join(' '))
            .filter(Boolean)
            .join(' | ');
        })
        .map(cleanText)
        .filter(Boolean);
    }
    case 'math':
      return [cleanText(node.plainText)].filter(Boolean);
    case 'group':
      return Array.isArray(node.children) ? node.children.map(xmlText).filter(Boolean) : [];
    case 'chart': {
      const chartPath = typeof node.chartPath === 'string' ? node.chartPath : '';
      return [xmlText(charts.get(chartPath))].filter(Boolean);
    }
    default: {
      const source = asRecord(node.source);
      const description =
        typeof source?.attr === 'function'
          ? cleanText((source.attr as (name: string) => unknown)('descr'))
          : '';
      return [description].filter(Boolean);
    }
  }
}

/**
 * Extract slide text locally when a remote document parser is not configured
 * or cannot process a PPTX. This preserves editable text, tables, formulas,
 * chart labels, and grouped-shape text without sending the deck to a service.
 */
export async function extractPptxTextLocally(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<ParsedPdfContent> {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  const files = await parseZip(arrayBuffer);
  const presentation = buildPresentation(files);
  const charts = presentation.charts as Map<string, unknown>;
  const slideTexts = presentation.slides.map((slide, index) => {
    const nodes = slide.nodes.flatMap((node) => collectNodeText(node, charts));
    return nodes.length ? `## 第 ${index + 1} 页\n${nodes.join('\n')}` : '';
  });
  const text = slideTexts.filter(Boolean).join('\n\n');

  if (!text) {
    throw new Error('The PPTX contains no extractable slide text.');
  }

  return {
    text,
    images: [],
    metadata: {
      pageCount: presentation.slides.length,
      fileName,
      fileSize: buffer.byteLength,
      mimeType,
      parser: 'openmaic-pptx',
    },
  };
}
