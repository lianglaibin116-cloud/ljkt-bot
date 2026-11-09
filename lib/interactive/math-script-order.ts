import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;

/** Load KaTeX's UMD globals before Monaco installs its anonymous AMD loader. */
export function orderMathScriptsBeforeAmd(html: string): string {
  const scripts: Element[] = [];
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if (
      node.nodeName === 'script' &&
      (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml'
    ) {
      scripts.push(node as Element);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(html, { sourceCodeLocationInfo: true }));

  const src = (script: Element) => script.attrs.find((attr) => attr.name === 'src')?.value ?? '';
  const isClassic = (script: Element) => {
    const type = script.attrs.find((attr) => attr.name === 'type')?.value.toLowerCase();
    return !type || type === 'text/javascript' || type === 'application/javascript';
  };
  const amdLoader = scripts.find(
    (script) =>
      isClassic(script) && /\/(?:vs\/loader|require(?:\.min)?)\.js(?:[?#]|$)/i.test(src(script)),
  );
  if (!amdLoader) return html;

  const mathScripts = scripts.filter(
    (script) =>
      isClassic(script) &&
      /\/(?:katex|auto-render)(?:\.min)?\.js(?:[?#]|$)/i.test(src(script)) &&
      /(?:katex|interactive-katex)/i.test(src(script)) &&
      script.sourceCodeLocation,
  );
  if (mathScripts.length === 0) return html;

  // Core must precede auto-render even if the authored tags are reversed.
  const ordered = [...mathScripts].sort(
    (a, b) => Number(/\/auto-render/i.test(src(a))) - Number(/\/auto-render/i.test(src(b))),
  );
  if (
    ordered.every(
      (script, index) =>
        script === mathScripts[index] &&
        script.sourceCodeLocation!.endOffset <= (amdLoader.sourceCodeLocation?.startOffset ?? 0) &&
        !script.attrs.some((attr) => attr.name === 'async' || attr.name === 'defer'),
    )
  )
    return html;

  function synchronousMarkup(script: Element): string {
    const location = script.sourceCodeLocation!;
    let markup = html.slice(location.startOffset, location.endOffset);
    // Remove only actual scheduling attributes, preserving URLs and nonces.
    const schedulingAttrs = ['async', 'defer']
      .map((name) => location.attrs?.[name])
      .filter((attr) => attr !== undefined)
      .sort((a, b) => b.startOffset - a.startOffset);
    for (const attr of schedulingAttrs) {
      const start = attr.startOffset - location.startOffset;
      const end = attr.endOffset - location.startOffset;
      markup = markup.slice(0, start) + markup.slice(end);
    }
    return markup;
  }

  let remaining = html;
  for (const script of [...mathScripts].reverse()) {
    const location = script.sourceCodeLocation!;
    remaining = remaining.slice(0, location.startOffset) + remaining.slice(location.endOffset);
  }
  // Insert at the loader, rather than at the beginning of head, so an existing
  // CSP meta element still governs every resource that it originally covered.
  const loaderOffset = amdLoader.sourceCodeLocation!.startOffset;
  const removedBeforeLoader = mathScripts.reduce((removed, script) => {
    const location = script.sourceCodeLocation!;
    return (
      removed +
      (location.startOffset < loaderOffset ? location.endOffset - location.startOffset : 0)
    );
  }, 0);
  const offset = loaderOffset - removedBeforeLoader;
  // Preserve authored URLs: standalone exports may bundle these themselves.
  return (
    remaining.slice(0, offset) +
    ordered.map(synchronousMarkup).join('\n') +
    '\n' +
    remaining.slice(offset)
  );
}
