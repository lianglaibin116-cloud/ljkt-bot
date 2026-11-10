import { Parser } from 'htmlparser2';
import { DOCUMENT_MIME_TYPES } from '../mime';
import type { DocumentExtractorProvider } from '../types';
import { getDocumentExtractorManifestEntry } from './manifest';

function textDecoderForBuffer(buffer: Buffer): TextDecoder {
  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le');
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be');
  }

  return new TextDecoder('utf-8');
}

const HTML_IGNORED_ELEMENTS = new Set([
  'canvas',
  'embed',
  'iframe',
  'noscript',
  'object',
  'script',
  'style',
  'svg',
  'template',
]);
const HTML_VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const HTML_BLOCK_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

interface OpenHtmlElement {
  name: string;
  suppressed: boolean;
  preservesWhitespace: boolean;
}

/** Extract readable static HTML text without executing scripts or loading assets. */
function extractHtmlText(buffer: Buffer): string {
  let text = '';
  let suppressedDepth = 0;
  let preformattedDepth = 0;
  const stack: OpenHtmlElement[] = [];

  const boundary = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const appendVisibleText = (value: string) => {
    if (!value) return;
    if (preformattedDepth > 0) {
      text += value;
      return;
    }
    const normalized = value.replace(/\s+/gu, ' ');
    if (!normalized.trim() && (!text || text.endsWith('\n'))) return;
    text += normalized;
  };

  const parser = new Parser(
    {
      onopentag(name, attributes) {
        const parentSuppressed = suppressedDepth > 0;
        const style = attributes.style ?? '';
        const hiddenByStyle =
          /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/iu.test(
            style,
          );
        const suppresses =
          parentSuppressed ||
          HTML_IGNORED_ELEMENTS.has(name) ||
          Object.hasOwn(attributes, 'hidden') ||
          attributes['aria-hidden']?.toLowerCase() === 'true' ||
          hiddenByStyle;

        if (!suppresses) {
          if (HTML_BLOCK_ELEMENTS.has(name) || name === 'br' || name === 'hr') boundary();
          if (name === 'meta') {
            const metaName = (attributes.name ?? attributes.property ?? '').toLowerCase();
            const description =
              metaName === 'description' || metaName === 'og:description'
                ? attributes.content?.trim()
                : undefined;
            if (description) {
              appendVisibleText(`页面说明：${description}`);
              boundary();
            }
          }
          if (name === 'img' && attributes.alt?.trim()) {
            appendVisibleText(`[图片：${attributes.alt.trim()}]`);
            boundary();
          }
          if (name === 'input' && attributes.placeholder?.trim()) {
            appendVisibleText(`[输入提示：${attributes.placeholder.trim()}]`);
            boundary();
          }
        }

        if (!HTML_VOID_ELEMENTS.has(name)) {
          const preservesWhitespace = name === 'pre' && !suppresses;
          stack.push({ name, suppressed: suppresses, preservesWhitespace });
          if (suppresses) suppressedDepth += 1;
          if (preservesWhitespace) preformattedDepth += 1;
        }
      },
      ontext(value) {
        if (suppressedDepth === 0) appendVisibleText(value);
      },
      onclosetag(name) {
        if (HTML_VOID_ELEMENTS.has(name)) return;
        let index = stack.length - 1;
        while (index >= 0 && stack[index]?.name !== name) index -= 1;
        if (index < 0) return;

        const closed = stack.splice(index);
        for (let closedIndex = closed.length - 1; closedIndex >= 0; closedIndex -= 1) {
          const element = closed[closedIndex]!;
          if (element.suppressed) suppressedDepth = Math.max(0, suppressedDepth - 1);
          if (element.preservesWhitespace) preformattedDepth = Math.max(0, preformattedDepth - 1);
        }
        if (suppressedDepth === 0 && (HTML_BLOCK_ELEMENTS.has(name) || name === 'pre')) boundary();
        if (
          suppressedDepth === 0 &&
          (name === 'td' || name === 'th') &&
          text &&
          !/[\t\n]$/u.test(text)
        )
          text += '\t';
      },
    },
    { decodeEntities: true },
  );

  const decoder = textDecoderForBuffer(buffer);
  const chunkSize = 64 * 1024;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    parser.write(
      decoder.decode(buffer.subarray(offset, Math.min(offset + chunkSize, buffer.length)), {
        stream: true,
      }),
    );
  }
  parser.end(decoder.decode());

  return text
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export const textDocumentExtractorProvider: DocumentExtractorProvider = {
  // Metadata is mirrored in the browser-safe manifest; version 2 adds safe
  // static HTML extraction while preserving the plain-text provider identity.
  ...getDocumentExtractorManifestEntry('plain-text')!,
  async extract(input) {
    const isHtml = input.mimeType === DOCUMENT_MIME_TYPES.html;
    const text = isHtml
      ? extractHtmlText(input.buffer)
      : textDecoderForBuffer(input.buffer).decode(input.buffer);
    const isMarkdown =
      input.mimeType === DOCUMENT_MIME_TYPES.markdown || input.mimeType === 'text/x-markdown';
    return {
      metadata: {
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        providerId: 'plain-text',
      },
      blocks: [
        {
          id: 'text_1',
          type: isMarkdown ? 'markdown' : 'text',
          text,
        },
      ],
      assets: [],
      diagnostics: [],
    };
  },
};
