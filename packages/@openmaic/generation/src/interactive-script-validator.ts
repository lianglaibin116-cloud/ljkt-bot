import { Script } from 'node:vm';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

export interface InteractiveScriptSyntaxFailure {
  readonly scriptIndex: number;
  readonly message: string;
}

export interface InteractiveCanvasReferenceFailure {
  readonly scriptIndex: number;
  readonly message: string;
}

export interface InteractiveCanvasGeometryFailure {
  readonly scriptIndex: number;
  readonly message: string;
}

/**
 * Classic script type essences. Empty means the type attribute was omitted.
 * The rest are the JavaScript MIME type essences browsers still execute,
 * including legacy `x-` and `javascript1.x` names.
 */
const CLASSIC_JAVASCRIPT_TYPES = new Set([
  '',
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

interface ScriptElement {
  readonly attributes: ReadonlyMap<string, string>;
  readonly source: string;
  /** False inside `<template>`: those scripts do not run until cloned. */
  readonly executable: boolean;
}

function isElement(
  node: DefaultTreeAdapterTypes.ChildNode,
): node is DefaultTreeAdapterTypes.Element {
  return node.nodeName[0] !== '#';
}

function isTemplate(
  node: DefaultTreeAdapterTypes.Element,
): node is DefaultTreeAdapterTypes.Template {
  return node.tagName === 'template' && 'content' in node;
}

function isTextNode(
  node: DefaultTreeAdapterTypes.ChildNode,
): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function scriptSource(element: DefaultTreeAdapterTypes.Element): string {
  let source = '';
  for (const child of element.childNodes) {
    if (isTextNode(child)) source += child.value;
  }
  return source;
}

function scriptAttributes(element: DefaultTreeAdapterTypes.Element): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const attribute of element.attrs) {
    const name = attribute.name.toLowerCase();
    if (!attributes.has(name)) attributes.set(name, attribute.value);
  }
  return attributes;
}

/**
 * Script elements in tree order. parse5 applies HTML5 tokenization, including
 * script-data escaped and double-escaped states, so a `</script>` that is text
 * stays inside the body. Comments, raw text, and RCDATA do not contribute
 * scripts. Template contents are counted but not executable.
 */
function collectScripts(
  parent: DefaultTreeAdapterTypes.ParentNode,
  inTemplate: boolean,
  scripts: ScriptElement[],
): void {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === 'script') {
      scripts.push({
        attributes: scriptAttributes(child),
        source: scriptSource(child),
        executable: !inTemplate,
      });
      continue;
    }
    if (isTemplate(child)) {
      collectScripts(child.content, true, scripts);
      continue;
    }
    collectScripts(child, inTemplate, scripts);
  }
}

function extractScriptElements(markup: string): ScriptElement[] {
  const scripts: ScriptElement[] = [];
  collectScripts(parse(markup), false, scripts);
  return scripts;
}

function collectCanvasIds(
  parent: DefaultTreeAdapterTypes.ParentNode,
  canvasIds: Set<string>,
): void {
  for (const child of parent.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === 'canvas') {
      const id = child.attrs.find((attribute) => attribute.name.toLowerCase() === 'id')?.value;
      if (id) canvasIds.add(id);
    }
    if (isTemplate(child)) {
      collectCanvasIds(child.content, canvasIds);
    } else {
      collectCanvasIds(child, canvasIds);
    }
  }
}

function classicScriptType(attributes: ReadonlyMap<string, string>): string {
  const raw = (attributes.get('type') ?? '').trim().toLowerCase();
  // MIME parameters (`text/javascript; charset=utf-8`) are not part of the type.
  return raw.split(';', 1)[0]!.trim();
}

function isExecutableClassicInline(script: ScriptElement): boolean {
  if (!script.executable || script.attributes.has('src')) return false;
  return CLASSIC_JAVASCRIPT_TYPES.has(classicScriptType(script.attributes));
}

function classicScriptSyntaxError(source: string): string | null {
  try {
    // Compile as a classic Script. Never run the result.
    new Script(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Parse-check classic inline scripts without executing them.
 *
 * Script bodies come from parse5, so they match the HTML the browser would
 * run, including escaped and double-escaped script data. The grammar is a
 * classic Script, not a FunctionBody: top-level `return` is a syntax error.
 * `node:vm` `Script` compiles only; the result is never run.
 *
 * Data scripts, external scripts, and module scripts are skipped. `scriptIndex`
 * counts every parsed `<script>` element, including ones that are skipped.
 * Scripts HTML would not execute — comments, unparsed text, and `<template>` —
 * are not checked. Template scripts are still counted.
 */
export function findInteractiveScriptSyntaxFailure(
  html: string,
): InteractiveScriptSyntaxFailure | null {
  const scripts = extractScriptElements(html);
  for (let index = 0; index < scripts.length; index += 1) {
    const script = scripts[index]!;
    if (!isExecutableClassicInline(script) || !script.source.trim()) continue;
    const message = classicScriptSyntaxError(script.source);
    if (message) return { scriptIndex: index + 1, message };
  }
  return null;
}

/**
 * Catch the common generated-simulation failure where `canvas` is assigned
 * from a static DOM lookup whose target is missing or is not a canvas. This is
 * intentionally limited to explicit canvas declarations; dynamic DOM code
 * and other widget types are outside this static check.
 */
export function findInteractiveCanvasReferenceFailure(
  html: string,
): InteractiveCanvasReferenceFailure | null {
  const canvasIds = new Set<string>();
  collectCanvasIds(parse(html), canvasIds);

  const scripts = extractScriptElements(html);
  const canvasLookup =
    /\b(?:const|let|var)\s+canvas\s*=\s*document\s*\.\s*(?:getElementById\s*\(\s*(['"])([^'"]+)\1\s*\)|querySelector\s*\(\s*(['"])#([^'"]+)\3\s*\))/g;

  for (let index = 0; index < scripts.length; index += 1) {
    const script = scripts[index]!;
    if (!isExecutableClassicInline(script)) continue;

    canvasLookup.lastIndex = 0;
    for (
      let match = canvasLookup.exec(script.source);
      match;
      match = canvasLookup.exec(script.source)
    ) {
      const canvasId = match[2] ?? match[4];
      if (canvasId && !canvasIds.has(canvasId)) {
        return {
          scriptIndex: index + 1,
          message: `canvas is looked up by id "${canvasId}", but no <canvas id="${canvasId}"> exists`,
        };
      }
    }
  }
  return null;
}

/**
 * Catch the unambiguous case where a canvas ellipse is called with a literal
 * negative radius. Dynamic geometry still needs a browser run; this guard is
 * deliberately narrow so it does not reject valid calculations or comments.
 */
export function findInteractiveCanvasGeometryFailure(
  html: string,
): InteractiveCanvasGeometryFailure | null {
  const scripts = extractScriptElements(html);
  const ellipseCall = /\b(?:\w+\.)?ellipse\s*\(/g;

  for (let index = 0; index < scripts.length; index += 1) {
    const script = scripts[index]!;
    if (!isExecutableClassicInline(script)) continue;
    ellipseCall.lastIndex = 0;

    for (
      let match = ellipseCall.exec(script.source);
      match;
      match = ellipseCall.exec(script.source)
    ) {
      const open = ellipseCall.lastIndex - 1;
      let depth = 1;
      let quote = '';
      let escaped = false;
      let argumentStart = open + 1;
      let argumentIndex = 0;

      for (let cursor = open + 1; cursor < script.source.length; cursor += 1) {
        const char = script.source[cursor]!;
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'" || char === '`') {
          quote = char;
          continue;
        }
        if (char === '(' || char === '[' || char === '{') depth += 1;
        else if (char === ')' || char === ']' || char === '}') {
          depth -= 1;
          if (depth === 0) break;
        } else if (char === ',' && depth === 1) {
          const argument = script.source.slice(argumentStart, cursor).trim();
          if (
            (argumentIndex === 2 || argumentIndex === 3) &&
            /^-\s*(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(argument)
          ) {
            return {
              scriptIndex: index + 1,
              message: `ellipse() argument ${argumentIndex + 1} is a negative literal (${argument}); radii must be non-negative`,
            };
          }
          argumentIndex += 1;
          argumentStart = cursor + 1;
        }
      }
    }
  }
  return null;
}
