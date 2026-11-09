import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { describe, expect, it } from 'vitest';
import { orderMathScriptsBeforeAmd } from '@/lib/interactive/math-script-order';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

const require = createRequire(import.meta.url);
const katexDir = path.dirname(require.resolve('katex'));
const core = readFileSync(path.join(katexDir, 'katex.min.js'), 'utf8');
const autoRender = readFileSync(path.join(katexDir, 'contrib/auto-render.min.js'), 'utf8');
const loader =
  '<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>';
const math =
  '<script src="/vendor/interactive-katex/katex.min.js"></script><script src="/vendor/interactive-katex/auto-render.min.js"></script>';

/** Exercise the real installed UMD bundles with Monaco's anonymous-define rule. */
function executeDependencies(html: string) {
  let anonymousDefinitions = 0;
  const context = vm.createContext({});
  function visit(node: DefaultTreeAdapterTypes.Node) {
    if (node.nodeName === 'script') {
      const script = node as DefaultTreeAdapterTypes.Element;
      const src = script.attrs.find((attr) => attr.name === 'src')?.value;
      if (src?.endsWith('/vs/loader.js')) {
        context.define = Object.assign(
          () => {
            if (++anonymousDefinitions > 1)
              throw new Error('Can only have one anonymous define call per script file');
          },
          { amd: {} },
        );
      } else if (src?.endsWith('/katex.min.js')) {
        vm.runInContext(core, context);
      } else if (src?.endsWith('/auto-render.min.js')) {
        vm.runInContext(autoRender, context);
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(html));
  return { context, anonymousDefinitions };
}

describe('interactive math alongside an AMD editor', () => {
  it('reproduces the saved page failure, then keeps math globals out of Monaco', () => {
    const html = `<html><head>${loader}${math}</head><body></body></html>`;
    expect(() => executeDependencies(html)).toThrow('Can only have one anonymous define');
    const { context, anonymousDefinitions } = executeDependencies(patchHtmlForIframe(html));
    expect(anonymousDefinitions).toBe(0);
    expect(context.katex.renderToString('x^2')).toContain('katex');
    expect(typeof context.renderMathInElement).toBe('function');
    expect(typeof context.define).toBe('function');
  });

  it('orders core before auto-render and removes async/defer without losing other attributes', () => {
    const html = `<html><head>${loader}</head><body><script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js" nonce="keep"></script><script async="async" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script><script>lesson()</script></body></html>`;
    const output = orderMathScriptsBeforeAmd(html);
    expect(output.indexOf('/katex.min.js')).toBeLessThan(output.indexOf('/auto-render.min.js'));
    expect(output.indexOf('/auto-render.min.js')).toBeLessThan(output.indexOf('/vs/loader.js'));
    expect(output).not.toMatch(/<script\s+(?:defer|async)/);
    expect(output).toContain('nonce="keep"');
    expect(output).toContain('<script>lesson()</script>');
    expect(orderMathScriptsBeforeAmd(output)).toBe(output);
  });

  it('ignores script-looking comments, templates, and modules', () => {
    const html = `<html><head><!-- ${loader} --><script type="module" src="/vs/loader.js"></script></head><body><template>${loader}${math}</template>${math}</body></html>`;
    expect(orderMathScriptsBeforeAmd(html)).toBe(html);
  });

  it('keeps resources behind their authored CSP and leaves foreign scripts inert', () => {
    const csp = '<meta http-equiv="Content-Security-Policy" content="script-src none">';
    const html = `<html><head>${csp}${loader}${math}</head><body></body></html>`;
    const output = orderMathScriptsBeforeAmd(html);
    expect(output.indexOf(csp)).toBeLessThan(
      output.indexOf('/vendor/interactive-katex/katex.min.js'),
    );
    const foreign = `<html><head>${math}</head><body><svg>${loader}</svg></body></html>`;
    expect(orderMathScriptsBeforeAmd(foreign)).toBe(foreign);
  });
});
