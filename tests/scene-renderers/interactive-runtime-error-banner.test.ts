// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveIframeHost } from '@/components/scene-renderers/InteractiveIframeHost';
import { useInteractiveIframePool } from '@/lib/store/interactive-iframe-pool';
import { useSceneRuntimeErrors } from '@/lib/store/scene-runtime-errors';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      if (key === 'chat.interactiveRuntimeError.title') return 'This interactive failed to run';
      if (key === 'chat.interactiveRuntimeError.dependencyTitle') {
        return 'An external resource is unavailable';
      }
      if (key === 'chat.interactiveRuntimeError.dependencyHint')
        return 'Check connection and retry.';
      if (key === 'chat.interactiveRuntimeError.dismiss') return 'Dismiss';
      if (key === 'chat.interactiveRuntimeError.reload') return 'Reload this page';
      return key;
    },
  }),
}));

const resetInteractiveIframePool = useInteractiveIframePool.getState().reset;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHost() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(InteractiveIframeHost));
    await Promise.resolve();
  });
}

function poolEntry(srcDoc: string) {
  return {
    srcDoc,
    rect: { left: 0, top: 0, width: 960, height: 540 },
    clip: { left: 0, top: 0, width: 960, height: 540 },
    owner: 'test-owner',
    tick: 1,
  };
}

describe('interactive runtime error banner', () => {
  beforeEach(() => {
    useSceneRuntimeErrors.setState({ errors: {} });
    useInteractiveIframePool.setState({ reset: resetInteractiveIframePool });
    resetInteractiveIframePool();
    useWidgetIframeStore.setState({
      sendMessageByScene: {},
      documentTokenByScene: {},
      readyByScene: {},
      pendingMessagesByScene: {},
      activeSceneId: null,
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    useSceneRuntimeErrors.setState({ errors: {} });
    resetInteractiveIframePool();
  });

  it('shows a truncated failure on the active interactive scene and not on another scene', async () => {
    const longDetail = 'x'.repeat(400);
    useInteractiveIframePool.setState({
      entries: {
        'scene-active': poolEntry('<div>Active</div>'),
        'scene-idle': poolEntry('<div>Idle</div>'),
      },
      activeSceneId: 'scene-active',
      tick: 1,
    });
    await renderHost();

    await act(async () => {
      useSceneRuntimeErrors.getState().addError('scene-active', `[error] ${longDetail}`);
      useSceneRuntimeErrors.getState().addError('scene-idle', '[error] idle only');
    });

    const banners = [...document.querySelectorAll('[data-testid="interactive-runtime-error"]')];
    expect(banners).toHaveLength(1);
    const banner = banners[0];
    expect(banner?.closest('iframe')).toBeNull();
    expect(banner?.textContent).toContain('This interactive failed to run');
    expect(banner?.textContent).toContain('x'.repeat(40));
    expect(banner?.textContent).not.toContain(longDetail);
    expect(banner?.textContent).not.toContain('idle only');
  });

  it('hides the banner on dismiss and shows it again when a new error arrives', async () => {
    useInteractiveIframePool.setState({
      entries: { 'scene-active': poolEntry('<div>Active</div>') },
      activeSceneId: 'scene-active',
      tick: 1,
    });
    await renderHost();

    await act(async () => {
      useSceneRuntimeErrors
        .getState()
        .addError('scene-active', '[error] Cannot read properties of undefined');
    });

    const dismiss = document.querySelector<HTMLButtonElement>(
      '[data-testid="interactive-runtime-error-dismiss"]',
    );
    expect(dismiss?.textContent).toBe('Dismiss');
    await act(async () => {
      dismiss?.click();
    });

    expect(document.querySelector('[data-testid="interactive-runtime-error"]')).toBeNull();
    expect(useSceneRuntimeErrors.getState().errors['scene-active']).toEqual([
      { kind: 'runtime', message: '[error] Cannot read properties of undefined' },
    ]);

    await act(async () => {
      useSceneRuntimeErrors.getState().addError('scene-active', '[error] second failure');
    });
    const banner = document.querySelector('[data-testid="interactive-runtime-error"]');
    expect(banner?.textContent).toContain('This interactive failed to run');
    expect(banner?.textContent).toContain('second failure');
    expect(banner?.textContent).not.toContain('Cannot read properties of undefined');
  });

  it('drops the banner when the scene document changes and clearScene runs', async () => {
    useInteractiveIframePool.setState({
      entries: { 'scene-active': poolEntry('<div>Active</div>') },
      activeSceneId: 'scene-active',
      tick: 1,
    });
    await renderHost();

    await act(async () => {
      useSceneRuntimeErrors.getState().addError('scene-active', '[error] TypeError: boom');
    });
    expect(document.querySelector('[data-testid="interactive-runtime-error"]')).not.toBeNull();

    await act(async () => {
      useInteractiveIframePool.setState((state) => ({
        entries: {
          ...state.entries,
          'scene-active': {
            ...state.entries['scene-active']!,
            srcDoc: '<div>Repaired</div>',
          },
        },
      }));
    });

    expect(useSceneRuntimeErrors.getState().errors['scene-active']).toBeUndefined();
    expect(document.querySelector('[data-testid="interactive-runtime-error"]')).toBeNull();
  });

  it('offers retry for an external dependency without losing the current page state', async () => {
    useInteractiveIframePool.getState().mount('scene-active', { sourceHtml: '<p>Active</p>' });
    useInteractiveIframePool.getState().claim('scene-active', 'test-owner');
    useInteractiveIframePool.getState().setRect('scene-active', {
      left: 0,
      top: 0,
      width: 960,
      height: 540,
    });
    useInteractiveIframePool.getState().setActive('scene-active');
    await renderHost();

    const originalIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Interactive Scene scene-active"]',
    );
    const postMessage = vi.spyOn(originalIframe!.contentWindow!, 'postMessage');
    await act(async () => {
      useSceneRuntimeErrors.getState().addError('scene-active', {
        kind: 'dependency',
        message: 'Interactive script could not load: https://cdn.example.test/lib.js',
      });
    });

    const banner = document.querySelector('[data-testid="interactive-runtime-error"]');
    expect(banner?.textContent).toContain('An external resource is unavailable');
    expect(banner?.textContent).toContain('Check connection and retry.');
    const retry = document.querySelector<HTMLButtonElement>(
      '[data-testid="interactive-runtime-error-retry"]',
    );
    expect(retry?.textContent).toBe('Reload this page');

    await act(async () => {
      retry?.click();
    });

    expect(useSceneRuntimeErrors.getState().errors['scene-active']).toBeUndefined();
    const retriedIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Interactive Scene scene-active"]',
    );
    expect(retriedIframe).toBe(originalIframe);
    expect(postMessage).toHaveBeenCalledWith({ __maicRetryDependency: true }, '*');
    expect(document.querySelector('[data-testid="interactive-runtime-error"]')).toBeNull();
  });

  it('reloads a URL-backed interactive when the user retries a dependency', async () => {
    useInteractiveIframePool.setState({
      entries: {
        'scene-url': {
          ...poolEntry(''),
          srcDoc: undefined,
          src: 'https://interactive.example.test/demo',
        },
      },
      activeSceneId: 'scene-url',
      tick: 1,
    });
    await renderHost();

    const originalIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Interactive Scene scene-url"]',
    );
    await act(async () => {
      useSceneRuntimeErrors.getState().addError('scene-url', {
        kind: 'dependency',
        message: 'Interactive service returned HTTP 503',
      });
    });

    const retry = document.querySelector<HTMLButtonElement>(
      '[data-testid="interactive-runtime-error-retry"]',
    );
    await act(async () => {
      retry?.click();
      await Promise.resolve();
    });

    const retriedIframe = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Interactive Scene scene-url"]',
    );
    expect(retriedIframe).not.toBe(originalIframe);
    expect(retriedIframe?.src).toBe('https://interactive.example.test/demo');
    expect(useSceneRuntimeErrors.getState().errors['scene-url']).toBeUndefined();
  });
});
