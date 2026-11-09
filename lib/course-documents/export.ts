import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { courseDocumentLabel, type CourseDocument } from './types';
import { safeKatexOptions } from '@/lib/standalone-player/math-render';

type Node = DefaultTreeAdapterMap['node'];
function children(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}
function tag(node: Node): string {
  return 'tagName' in node ? node.tagName : '';
}
function attr(node: Node, name: string): string | undefined {
  return 'attrs' in node ? node.attrs.find((a) => a.name === name)?.value : undefined;
}
function plain(node: Node): string {
  return 'value' in node ? node.value : children(node).map(plain).join('');
}
function formula(node: Node): string | undefined {
  if (tag(node) === 'annotation' && attr(node, 'encoding')?.includes('tex')) return plain(node);
  for (const child of children(node)) {
    const found = formula(child);
    if (found) return found;
  }
}

export function courseDocumentFileName(
  document: CourseDocument,
  extension: 'docx' | 'pdf',
): string {
  const stem =
    document.title
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '')
      .trim()
      .slice(0, 140) || courseDocumentLabel(document.kind);
  return `${stem}.${extension}`;
}

/** Uses the saved document's rendered preview: one Markdown interpretation across exports. */
export async function buildCourseDocumentWord(html: string): Promise<Blob> {
  const d = await import('docx');
  const [{ default: temml }, { mml2omml }] = await Promise.all([
    import('temml'),
    import('mathml2omml'),
  ]);
  type Run = import('docx').ParagraphChild;
  const math = (latex: string): Run => {
    try {
      const mml = temml
        .renderToString(latex, safeKatexOptions())
        .replace(/<\/?mpadded\b[^>]*>/g, '');
      // Word needs the original w:rPr; the PPTX converter intentionally removes it.
      const xml = String(mml2omml(mml));
      const imported = d.ImportedXmlComponent.fromXmlString(xml) as unknown as { root: Run[] };
      if (!imported.root[0]) throw new Error('Empty formula');
      return imported.root[0];
    } catch {
      return new d.TextRun({ text: `$${latex}$`, font: 'Cambria Math' });
    }
  };
  const inline = (
    node: Node,
    style: { bold?: boolean; italics?: boolean; font?: string } = {},
  ): Run[] => {
    if ('value' in node) return [new d.TextRun({ text: node.value, ...style })];
    if (['script', 'style', 'button', 'svg', 'iframe', 'img'].includes(tag(node))) return [];
    if (attr(node, 'class')?.split(' ').includes('katex')) {
      const latex = formula(node);
      return latex ? [math(latex)] : [new d.TextRun({ text: plain(node), ...style })];
    }
    if (tag(node) === 'br') return [new d.TextRun({ break: 1 })];
    return children(node).flatMap((child) =>
      inline(child, {
        ...style,
        ...(['b', 'strong'].includes(tag(node)) ? { bold: true } : {}),
        ...(['em', 'i'].includes(tag(node)) ? { italics: true } : {}),
        ...(tag(node) === 'code' ? { font: 'Consolas' } : {}),
      }),
    );
  };
  const blocks = (node: Node): (import('docx').Paragraph | import('docx').Table)[] => {
    const name = tag(node);
    if (['script', 'style', 'button', 'svg', 'iframe', 'img'].includes(name)) return [];
    if (/^h[1-6]$/.test(name)) {
      const levels = [
        d.HeadingLevel.HEADING_1,
        d.HeadingLevel.HEADING_2,
        d.HeadingLevel.HEADING_3,
        d.HeadingLevel.HEADING_4,
        d.HeadingLevel.HEADING_5,
        d.HeadingLevel.HEADING_6,
      ];
      return [
        new d.Paragraph({
          children: inline(node),
          heading: name === 'h1' ? d.HeadingLevel.TITLE : levels[Number(name[1]) - 1],
          keepNext: true,
          spacing: { before: 220, after: 100 },
        }),
      ];
    }
    if (name === 'table') {
      const rows: Node[] = [];
      const walk = (n: Node) => {
        if (tag(n) === 'tr') rows.push(n);
        else children(n).forEach(walk);
      };
      walk(node);
      if (!rows.length) return [];
      return [
        new d.Table({
          borders: Object.fromEntries(
            ['top', 'bottom', 'left', 'right', 'insideHorizontal', 'insideVertical'].map((side) => [
              side,
              { style: d.BorderStyle.SINGLE, color: 'D9D9D9', size: 4 },
            ]),
          ),
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          rows: rows.map(
            (row) =>
              new d.TableRow({
                tableHeader: children(row).some((cell) => tag(cell) === 'th'),
                children: children(row)
                  .filter((n) => ['th', 'td'].includes(tag(n)))
                  .map(
                    (cell) =>
                      new d.TableCell({
                        verticalAlign: d.VerticalAlign.CENTER,
                        margins: { top: 90, bottom: 90, left: 110, right: 110 },
                        shading: tag(cell) === 'th' ? { fill: 'E8EDE7' } : undefined,
                        children: [
                          new d.Paragraph({
                            children: inline(cell, tag(cell) === 'th' ? { bold: true } : {}),
                          }),
                        ],
                      }),
                  ),
              }),
          ),
        }),
      ];
    }
    if (name === 'pre') {
      const code = children(node).find((child) => tag(child) === 'code');
      const parent = 'parentNode' in node ? node.parentNode : null;
      const lines = code ? children(code).filter((child) => tag(child) === 'span') : [];
      // Streamdown stores each code line in a separate span, without newline text nodes.
      const codeText =
        parent && attr(parent, 'data-streamdown') === 'code-block-body' && lines.length
          ? lines.map(plain).join('\n')
          : plain(node);
      return codeText
        .replace(/\n$/, '')
        .split('\n')
        .map(
          (line) =>
            new d.Paragraph({
              children: [new d.TextRun({ text: line, font: 'Consolas', size: 19 })],
              spacing: { after: 0 },
              shading: { fill: 'F3F5F1' },
            }),
        );
    }
    if (name === 'ol' || name === 'ul')
      return children(node)
        .filter((child) => tag(child) === 'li')
        .map(
          (child, index) =>
            new d.Paragraph({
              children: [new d.TextRun(name === 'ol' ? `${index + 1}. ` : '• '), ...inline(child)],
              spacing: { after: 60 },
            }),
        );
    if (name === 'li')
      return [
        new d.Paragraph({ children: inline(node), bullet: { level: 0 }, spacing: { after: 60 } }),
      ];
    if (name === 'p' || name === 'blockquote' || attr(node, 'class')?.includes('katex-display'))
      return [new d.Paragraph({ children: inline(node), spacing: { after: 120 } })];
    if ('value' in node) return node.value.trim() ? [new d.Paragraph({ text: node.value })] : [];
    return children(node).flatMap(blocks);
  };
  const document = new d.Document({
    creator: '灵境课堂',
    styles: {
      default: {
        document: {
          run: { font: 'Microsoft YaHei', size: 23 },
          paragraph: { spacing: { line: 330 } },
        },
        title: { run: { color: '000000', size: 34, bold: true } },
        heading1: { run: { color: '000000', size: 34 } },
        heading2: { run: { color: '000000', size: 28, bold: true } },
        heading3: { run: { color: '000000', size: 24, bold: true } },
        heading4: { run: { color: '000000', size: 22, bold: true } },
        heading5: { run: { color: '000000', size: 21, bold: true } },
        heading6: { run: { color: '000000', size: 20, bold: true } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children: blocks(parseFragment(html)),
      },
    ],
  });
  return d.Packer.toBlob(document);
}

function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function courseDocumentPrintHtml(title: string, body: string, styles = ''): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>${escapeAttribute(title)}</title>${styles}<style>
    @page{size:A4;margin:20mm} html,body{height:auto!important;overflow:visible!important;background:white!important;color:#17251d!important;margin:0!important}
    body{font:12pt/1.65 "Microsoft YaHei","PingFang SC",sans-serif;width:170mm;max-width:100%} article{max-width:none!important;width:auto!important;padding:0!important}
    @media print{body{width:auto}}
    h1,h2,h3,h4{color:#2f5b48;break-after:avoid} h1{font-size:22pt}h2{font-size:16pt;margin-top:1.2em}h3{font-size:13pt}
    p,li{orphans:3;widows:3} pre,code{white-space:pre-wrap!important;overflow-wrap:anywhere!important;font-family:Consolas,monospace;font-size:10pt}pre{background:#f5f6f2!important;padding:10px}
    table{border-collapse:collapse;width:100%;font-size:10pt}td,th{border:1px solid #bbb;padding:5px}tr{break-inside:avoid}thead{display:table-header-group}
    button,[data-streamdown=code-block-header],[data-streamdown=code-block-actions]{display:none!important}.katex-display{overflow:visible!important;font-size:1em} .katex{white-space:normal}
    .course-document-sources{font-size:9pt;color:#687367} section{break-inside:auto} *{box-shadow:none!important;text-shadow:none!important}
  </style></head><body>${body}</body></html>`;
}

/** Isolated frame prevents the application chrome or the other document from being printed. */
export function printCourseDocument(title: string, html: string): void {
  const frame = document.createElement('iframe');
  frame.title = title;
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;';
  const styles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]'))
    .map((node) => node.outerHTML)
    .join('');
  frame.onload = async () => {
    const target = frame.contentWindow;
    if (!target) {
      frame.remove();
      return;
    }
    await frame.contentDocument?.fonts?.ready;
    // Measure at the A4 content width so a long equation cannot be clipped at the paper edge.
    for (const equation of frame.contentDocument?.querySelectorAll<HTMLElement>(
      '.katex-display .katex',
    ) ?? []) {
      const available = equation.parentElement?.clientWidth ?? 0;
      if (available > 0 && equation.scrollWidth > available)
        equation.style.fontSize = `${Math.floor((available / equation.scrollWidth) * 100)}%`;
    }
    target.addEventListener('afterprint', () => frame.remove(), { once: true });
    target.focus();
    target.print();
  };
  const mathStyles = `<link rel="stylesheet" href="${escapeAttribute(window.location.origin)}/vendor/interactive-katex/katex.min.css">`;
  frame.srcdoc = courseDocumentPrintHtml(title, html, styles + mathStyles);
  document.body.append(frame);
  setTimeout(() => frame.remove(), 300_000);
}
