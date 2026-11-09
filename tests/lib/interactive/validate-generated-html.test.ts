// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTERACTIVE_VALIDATION_DRIVER,
  listExternalInteractiveResources,
  validateGeneratedInteractiveHtml,
} from '@/lib/interactive/validate-generated-html';

describe('validateGeneratedInteractiveHtml', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function check(messages: Array<{ errorKind: string; message: string }>) {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 0),
    );
    const result = validateGeneratedInteractiveHtml('<html><body>Lesson</body></html>');
    const frame = document.querySelector('iframe')!;
    for (const data of messages) {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          data: { __maicInteractive: true, kind: 'runtime-error', ...data },
        }),
      );
    }
    frame.dispatchEvent(new Event('load'));
    await vi.runAllTimersAsync();
    const validation = await result;
    expect(document.querySelector('iframe')).toBeNull();
    return validation;
  }

  it('keeps unrelated script errors blocking after a dependency failure', async () => {
    const result = await check([
      { errorKind: 'dependency', message: 'Optional CDN script could not load' },
      { errorKind: 'error', message: 'Uncaught ReferenceError: localRenderMissing is not defined' },
    ]);
    expect(result.errors).toEqual([
      '[error] Uncaught ReferenceError: localRenderMissing is not defined',
    ]);
    expect(result.warnings).toEqual(['[dependency] Optional CDN script could not load']);
  });

  it('keeps external resource failures as warnings when no script error occurs', async () => {
    const result = await check([{ errorKind: 'dependency', message: 'CDN unavailable' }]);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['[dependency] CDN unavailable']);
  });

  it('blocks a visual layout failure and removes the disposable iframe', async () => {
    const result = await check([
      { errorKind: 'layout', message: 'Hidden element remains displayed (#error-box).' },
    ]);
    expect(result.errors).toEqual(['[layout] Hidden element remains displayed (#error-box).']);
    expect(result.warnings).toEqual([]);
  });
});

describe('listExternalInteractiveResources', () => {
  it('finds external scripts and stylesheets while ignoring local and inline resources', () => {
    expect(
      listExternalInteractiveResources(`
        <script src="https://cdn.example.test/widget.js"></script>
        <link rel="stylesheet" href="https://cdn.example.test/widget.css">
        <script src=//cdn.example.test/unquoted.js></script>
        <script src="/vendor/local.js"></script>
        <script>window.ready = true;</script>
      `),
    ).toEqual([
      'https://cdn.example.test/widget.js',
      'https://cdn.example.test/widget.css',
      '//cdn.example.test/unquoted.js',
    ]);
  });

  it('deduplicates repeated resource URLs', () => {
    expect(
      listExternalInteractiveResources(
        '<script src="https://cdn.example.test/a.js"></script><script src="https://cdn.example.test/a.js"></script>',
      ),
    ).toEqual(['https://cdn.example.test/a.js']);
  });

  it('exercises labeled start, step, reset buttons and range endpoints', () => {
    const driver = INTERACTIVE_VALIDATION_DRIVER.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(driver).toBeTruthy();

    const interactions: string[] = [];
    const scheduled: Array<{ delay: number; callback: () => void }> = [];
    const range = {
      value: '5',
      getAttribute: (name: string) => ({ min: '0', max: '10' })[name] ?? null,
      dispatchEvent: (event: { type: string }) => {
        interactions.push(`${event.type}:${range.value}`);
        return true;
      },
    };
    const makeButton = (label: string) => ({
      innerText: label,
      disabled: false,
      click: () => interactions.push(label),
    });
    const buttons = [makeButton('▶ 运行代码'), makeButton('⏭ 单步'), makeButton('↺ 重置')];
    let domReady: (() => void) | undefined;
    const fakeWindow = {
      addEventListener: (type: string, callback: () => void) => {
        if (type === 'DOMContentLoaded') domReady = callback;
      },
      setTimeout: (callback: () => void, delay: number) => {
        scheduled.push({ delay, callback });
        return scheduled.length;
      },
    };
    const fakeDocument = {
      querySelectorAll: (selector: string) =>
        selector.startsWith('input') ? [range] : selector === 'button' ? buttons : [],
    };

    new Function('window', 'document', 'Event', driver as string)(
      fakeWindow,
      fakeDocument,
      class FakeEvent {
        constructor(readonly type: string) {}
      },
    );
    domReady?.();
    scheduled.sort((a, b) => a.delay - b.delay).forEach((timer) => timer.callback());

    expect(interactions).toContain('▶ 运行代码');
    expect(interactions).toContain('⏭ 单步');
    expect(interactions).toContain('↺ 重置');
    expect(interactions).toContain('input:0');
    expect(interactions).toContain('input:10');
    expect(interactions).toContain('change:5');
  });
});
