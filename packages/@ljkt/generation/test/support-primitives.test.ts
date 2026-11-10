import { describe, expect, it } from 'vitest';
import { parseActionsFromStructuredOutput, postProcessInteractiveHtml } from '@ljkt/generation';

describe('action parser', () => {
  it('repairs malformed structured output and preserves interleaving', () => {
    const actions = parseActionsFromStructuredOutput(
      '[{"type":"text","content":"Start"},{"type":"action","name":"widget_setState","params":{}}',
      'interactive',
      ['widget_setState'],
    );
    expect(actions).toEqual([
      expect.objectContaining({ type: 'speech', text: 'Start' }),
      expect.objectContaining({ type: 'widget_setState', state: {} }),
    ]);
  });

  it('filters slide-only actions from non-slide scenes', () => {
    expect(
      parseActionsFromStructuredOutput(
        '[{"type":"action","name":"spotlight","params":{"elementId":"x"}}]',
        'quiz',
      ),
    ).toEqual([]);
  });

  it('converts a model-labelled text action into speech without losing narration', () => {
    const actions = parseActionsFromStructuredOutput(
      JSON.stringify([
        { type: 'action', name: 'text', params: { content: 'Explain the lunar rover.' } },
        { type: 'action', name: 'speech', params: { text: 'Continue.' } },
      ]),
      'slide',
    );
    expect(actions.map((action) => action.type)).toEqual(['speech', 'speech']);
    expect(actions[0]).toMatchObject({ text: 'Explain the lunar rover.' });
  });

  it('rejects unknown or incomplete actions and prevents params from replacing the action type', () => {
    const actions = parseActionsFromStructuredOutput(
      JSON.stringify([
        { type: 'action', name: 'text', params: {} },
        { type: 'action', name: 'name', params: { content: 'invalid' } },
        { type: 'action', name: 'play_video', params: {} },
        { type: 'action', name: 'speech', params: { type: 'text', text: 'Valid speech' } },
        { type: 'action', name: 'play_video', params: { elementId: 'video-1' } },
      ]),
      'slide',
    );
    expect(actions).toEqual([
      expect.objectContaining({ type: 'speech', text: 'Valid speech' }),
      expect.objectContaining({ type: 'play_video', elementId: 'video-1' }),
    ]);
  });
});

describe('interactive HTML post-processing', () => {
  it('converts math, protects scripts, and injects KaTeX once', () => {
    const source =
      '<html><head></head><body>$x+1$<script>const price = "$5";</script></body></html>';
    const once = postProcessInteractiveHtml(source);
    const twice = postProcessInteractiveHtml(once);
    expect(once).toContain('\\(x+1\\)');
    expect(once).toContain('const price = "$5";');
    expect(once).toContain('katex.min.css');
    expect(twice.match(/katex\.min\.css/g) ?? []).toHaveLength(1);
  });

  it('still injects auto-render when KaTeX is only mentioned in the authored page', () => {
    const html =
      '<html><head></head><body><script>renderMathInElement(document.body); // katex</script></body></html>';
    const processed = postProcessInteractiveHtml(html);
    expect(processed).toContain('contrib/auto-render.min.js');
    expect(processed.indexOf('contrib/auto-render.min.js')).toBeLessThan(
      processed.indexOf('renderMathInElement(document.body); // katex'),
    );
  });
});
