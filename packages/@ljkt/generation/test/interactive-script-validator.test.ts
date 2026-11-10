import { describe, expect, it } from 'vitest';

import {
  findInteractiveCanvasGeometryFailure,
  findInteractiveCanvasReferenceFailure,
  findInteractiveScriptSyntaxFailure,
} from '../src/interactive-script-validator.js';

describe('findInteractiveScriptSyntaxFailure', () => {
  it('accepts valid classic inline scripts', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<html><body><button id="go">Go</button><script>document.getElementById("go")?.addEventListener("click", () => console.log("go"));</script></body></html>',
      ),
    ).toBeNull();
  });

  it('reports the first syntactically invalid classic inline script', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<html><body><script>const ok = 1;</script><script>const broken = ;</script></body></html>',
      ),
    ).toMatchObject({
      scriptIndex: 2,
      message: expect.stringMatching(/Unexpected token/),
    });
  });

  it('reports a Flink-like bare declaration and counts skipped scripts', () => {
    const failure = findInteractiveScriptSyntaxFailure(
      [
        '<html><body>',
        '<script type="application/json" id="widget-config">{"type":"simulation"}</script>',
        '<script>state counts = new Array(10).fill(0);</script>',
        '</body></html>',
      ].join(''),
    );

    expect(failure).toMatchObject({
      scriptIndex: 2,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });

  it.each([
    [
      'widget config JSON',
      '<script type="application/json" id="widget-config">{"type":"simulation"}</script>',
    ],
    ['external scripts', '<script src="https://example.com/widget.js"></script>'],
    [
      'module scripts',
      '<script type="module">import value from "./value.js"; console.log(value);</script>',
    ],
  ])('skips %s because it is not a classic inline script body', (_label, script) => {
    expect(findInteractiveScriptSyntaxFailure(`<html><body>${script}</body></html>`)).toBeNull();
  });

  it('accepts classic JavaScript MIME types with parameters', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<script type="text/javascript; charset=utf-8">const value = 1;</script>',
      ),
    ).toBeNull();
  });

  it.each([
    'application/x-javascript',
    'application/x-ecmascript',
    'text/x-javascript',
    'text/x-ecmascript',
    'text/jscript',
    'text/livescript',
    'text/javascript1.0',
    'text/javascript1.1',
    'text/javascript1.2',
    'text/javascript1.3',
    'text/javascript1.4',
    'text/javascript1.5',
    'text/javascript1.5; charset=utf-8',
  ])('checks legacy classic MIME type %s', (type) => {
    expect(
      findInteractiveScriptSyntaxFailure(`<script type="${type}">state counts = [];</script>`),
    ).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });

  it('accepts a classic script whose quoted attribute contains a greater-than', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<script data-note="a > b">window.widgetRan = true;</script>',
      ),
    ).toBeNull();
  });

  it('still checks the script body when an attribute value contains a greater-than', () => {
    expect(
      findInteractiveScriptSyntaxFailure('<script data-note="a > b">state counts = [];</script>'),
    ).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });

  it('does not let a greater-than inside quotes hide a later type attribute', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<script data-note="a > b" type="application/json">{"a":1}</script>',
      ),
    ).toBeNull();
  });

  it('does not treat a script inside an HTML comment as executable', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<!-- <script>state counts = [];</script> --><script>window.widgetRan = true;</script>',
      ),
    ).toBeNull();
  });

  it('checks the script that follows an HTML comment and does not count the comment', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<!-- <script>state counts = [];</script> --><script>state counts = [];</script>',
      ),
    ).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });

  it('ends an abruptly closed comment before the next script', () => {
    expect(
      findInteractiveScriptSyntaxFailure('<!--> <script>state counts = [];</script>'),
    ).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });

  it.each([
    [
      'noscript',
      '<noscript><script>state counts = [];</script></noscript><script>window.widgetRan = true;</script>',
    ],
    [
      'textarea',
      '<textarea><script>state counts = [];</script></textarea><script>window.widgetRan = true;</script>',
    ],
  ])('does not treat a script inside %s as executable', (_label, html) => {
    expect(findInteractiveScriptSyntaxFailure(html)).toBeNull();
  });

  it('rejects a top-level return, which is illegal in a classic script', () => {
    expect(findInteractiveScriptSyntaxFailure('<script>return;</script>')).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Illegal return statement/),
    });
  });

  it('accepts a return nested inside a function', () => {
    expect(
      findInteractiveScriptSyntaxFailure('<script>function stop() { return; }</script>'),
    ).toBeNull();
  });

  it('ends a classic script at the HTML end tag, even inside a JavaScript string', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<script>const value = "</script>"; window.widgetRan = true;</script>',
      ),
    ).toMatchObject({
      scriptIndex: 1,
      message: expect.stringMatching(/Invalid or unexpected token/),
    });
  });

  it('accepts a classic script whose double-escaped script data contains </script>', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<script><!--\nvar s = "<script>x</script>";\nwindow.widgetRan = true;\n--></script>',
      ),
    ).toBeNull();
  });

  it('does not syntax-check a script nested in a template', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<template><script>state counts = [];</script></template><script>window.widgetRan = true;</script>',
      ),
    ).toBeNull();
  });

  it('counts a template script toward the index of a later classic script', () => {
    expect(
      findInteractiveScriptSyntaxFailure(
        '<template><script>window.widgetRan = true;</script></template><script>state counts = [];</script>',
      ),
    ).toMatchObject({
      scriptIndex: 2,
      message: expect.stringMatching(/Unexpected identifier 'counts'/),
    });
  });
});

describe('findInteractiveCanvasReferenceFailure', () => {
  it('reports a canvas lookup whose id is absent from the markup', () => {
    expect(
      findInteractiveCanvasReferenceFailure(
        '<canvas id="scene"></canvas><script>const canvas = document.getElementById("canvas"); draw(canvas.clientWidth);</script>',
      ),
    ).toEqual({
      scriptIndex: 1,
      message: 'canvas is looked up by id "canvas", but no <canvas id="canvas"> exists',
    });
  });

  it('accepts an id that identifies an actual canvas', () => {
    expect(
      findInteractiveCanvasReferenceFailure(
        '<canvas id="scene"></canvas><script>const canvas = document.querySelector("#scene");</script>',
      ),
    ).toBeNull();
  });

  it('rejects a matching id attached to a non-canvas element', () => {
    expect(
      findInteractiveCanvasReferenceFailure(
        '<div id="scene"></div><script>const canvas = document.getElementById("scene");</script>',
      ),
    ).not.toBeNull();
  });

  it('does not constrain dynamic canvas bindings or scripts without a canvas binding', () => {
    expect(
      findInteractiveCanvasReferenceFailure(
        '<div id="host"></div><script>const canvas = document.createElement("canvas");</script>',
      ),
    ).toBeNull();
  });
});

describe('findInteractiveCanvasGeometryFailure', () => {
  it('rejects a negative literal ellipse radius before the widget is returned', () => {
    expect(
      findInteractiveCanvasGeometryFailure(
        '<canvas></canvas><script>ctx.ellipse(10, 20, -12.5, 8, 0, 0, Math.PI * 2);</script>',
      ),
    ).toEqual({
      scriptIndex: 1,
      message: 'ellipse() argument 3 is a negative literal (-12.5); radii must be non-negative',
    });
  });

  it('does not mistake nested commas or quoted commas for ellipse arguments', () => {
    expect(
      findInteractiveCanvasGeometryFailure(
        '<script>ctx.ellipse(point(1, 2), 20, Math.max(0, width - 2), Math.abs(height), 0, 0, 1);</script>',
      ),
    ).toBeNull();
  });

  it('does not validate scripts inside a template', () => {
    expect(
      findInteractiveCanvasGeometryFailure(
        '<template><script>ctx.ellipse(0,0,-1,2,0,0,1)</script></template><script>ctx.ellipse(0,0,1,2,0,0,1)</script>',
      ),
    ).toBeNull();
  });
});
