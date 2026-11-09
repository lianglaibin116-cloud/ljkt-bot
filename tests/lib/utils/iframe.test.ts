import { describe, expect, it } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

function installErrorShim(win: unknown, shim: string) {
  const doc = {
    baseURI: 'about:srcdoc',
    documentElement: { contains: () => true },
    addEventListener: () => undefined,
  };
  new Function('window', 'document', shim)(win, doc);
}

describe('patchHtmlForIframe', () => {
  it('injects the storage shim and sizing CSS after <head>', () => {
    const out = patchHtmlForIframe(
      '<!DOCTYPE html><html><head><title>t</title></head><body></body></html>',
    );
    expect(out).toContain('data-iframe-storage-shim');
    expect(out).toContain('data-iframe-action-rescue-shim');
    expect(out).toContain('data-iframe-patch');
    expect(out).toContain('data-iframe-playback-speed-shim');
  });

  it('runs the storage shim before the page scripts', () => {
    const html =
      '<!DOCTYPE html><html><head><script>window.__x = localStorage.getItem("k");</script></head><body></body></html>';
    const out = patchHtmlForIframe(html);
    // The shim must appear before the page's own <script> so storage is safe by then.
    expect(out.indexOf('data-iframe-storage-shim')).toBeLessThan(out.indexOf('window.__x'));
    expect(out.indexOf('data-iframe-playback-speed-shim')).toBeLessThan(out.indexOf('window.__x'));
  });

  it('the shim provides a working in-memory storage when the real one throws', () => {
    // Execute the injected shim against a fake window whose localStorage getter
    // throws (mirroring a null-origin sandboxed iframe), then assert the shim
    // installed a usable in-memory store.
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-storage-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const win: Record<string, unknown> = {};
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('sandboxed');
      },
    });
    Object.defineProperty(win, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('sandboxed');
      },
    });
    installErrorShim(win, shim as string);

    const ls = win.localStorage as Storage;
    expect(ls.getItem('missing')).toBeNull();
    ls.setItem('a', '1');
    expect(ls.getItem('a')).toBe('1');
    expect(ls.length).toBe(1);
    ls.removeItem('a');
    expect(ls.getItem('a')).toBeNull();
  });

  it('creates a head when the authored document has none', () => {
    const out = patchHtmlForIframe('<div>no head</div>');
    expect(out.startsWith('<head>\n<script data-iframe-error-shim>')).toBe(true);
    expect(out.indexOf('</head>')).toBeLessThan(out.indexOf('<div>'));
  });

  it('does not treat head-like text in comments or scripts as the document head', () => {
    const authoredScript = 'const template = "<head>"; window.__template = template;';
    const html = `<!doctype html><!-- <head> --><html><body><script>${authoredScript}</script></body></html>`;
    const out = patchHtmlForIframe(html);

    expect(out).toContain(`<script>${authoredScript}</script>`);
    expect(out.indexOf('data-iframe-error-shim')).toBeLessThan(out.indexOf('<body>'));
  });

  it('injects the error-capture shim before the storage shim and page scripts', () => {
    const html = '<!DOCTYPE html><html><head><script>boom()</script></head><body></body></html>';
    const out = patchHtmlForIframe(html);
    expect(out).toContain('data-iframe-error-shim');
    // error shim runs first → before storage shim → before page scripts, so it
    // catches errors from everything that follows.
    expect(out.indexOf('data-iframe-error-shim')).toBeLessThan(
      out.indexOf('data-iframe-storage-shim'),
    );
    expect(out.indexOf('data-iframe-storage-shim')).toBeLessThan(out.indexOf('boom()'));
  });

  it('the error shim posts runtime errors (onerror / resource / rejection / console.error) to the parent', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = {
      parent: { postMessage: (m: Record<string, unknown>, o: string) => posts.push([m, o]) },
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        handlers[t] = cb;
      },
      console: { error: (..._args: unknown[]) => {} },
    };
    installErrorShim(win, shim as string);

    handlers.error({ message: 'JSON.parse boom', filename: 'p.html', lineno: 12 });
    expect(posts[0][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'error' });
    expect(posts[0][0].message).toContain('JSON.parse boom');
    expect(posts[0][1]).toBe('*');

    handlers.error({ target: { tagName: 'SCRIPT', src: 'https://cdn/katex.js?token=secret' } });
    expect(posts[1][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'dependency' });
    expect(String(posts[1][0].message)).toContain('script resource could not load');
    expect(String(posts[1][0].message)).not.toContain('secret');

    handlers.unhandledrejection({ reason: { message: 'rej' } });
    expect(posts[2][0]).toMatchObject({ errorKind: 'unhandledrejection' });

    win.console.error('console boom');
    expect(posts[3][0]).toMatchObject({ errorKind: 'console.error' });
    expect(String(posts[3][0].message)).toContain('console boom');

    handlers.error({ target: { tagName: 'IMG', src: 'https://cdn/image.png' } });
    expect(posts).toHaveLength(4);
  });

  it('classifies XHR outages and temporary service responses as dependencies', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const posts: Array<[Record<string, unknown>, string]> = [];
    class FakeXmlHttpRequest {
      static readonly instances: FakeXmlHttpRequest[] = [];
      readonly handlers: Record<string, () => void> = {};
      status = 503;
      url = '';

      constructor() {
        FakeXmlHttpRequest.instances.push(this);
      }

      open(_method: string, url: string) {
        this.url = url;
      }

      send() {}

      addEventListener(type: string, callback: () => void) {
        this.handlers[type] = callback;
      }
    }
    const win = {
      parent: {
        postMessage: (message: Record<string, unknown>, origin: string) =>
          posts.push([message, origin]),
      },
      addEventListener: () => undefined,
      XMLHttpRequest: FakeXmlHttpRequest,
      console: { error: () => undefined },
    };
    installErrorShim(win, shim as string);

    const request = new FakeXmlHttpRequest();
    request.open('POST', 'https://runner.example.test/compile?token=secret');
    request.send();
    request.handlers.load?.();
    expect(posts[0]?.[0]).toMatchObject({ errorKind: 'dependency' });
    expect(posts[0]?.[0].message).toContain('HTTP 503');
    expect(posts[0]?.[0].message).not.toContain('secret');

    const failedRequest = new FakeXmlHttpRequest();
    failedRequest.open('GET', 'https://runner.example.test/health');
    failedRequest.send();
    failedRequest.handlers.error?.();
    expect(posts[1]?.[0]).toMatchObject({ errorKind: 'dependency' });
    expect(posts[1]?.[0].message).toContain('XMLHttpRequest failed');
  });

  it('classifies rejected network requests as retryable dependencies', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      parent: {
        postMessage: (message: Record<string, unknown>, origin: string) =>
          posts.push([message, origin]),
      },
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        handlers[type] = callback;
      },
      console: { error: () => undefined },
    };
    installErrorShim(win, shim as string);

    handlers.unhandledrejection({ reason: { name: 'TypeError', message: 'Failed to fetch' } });
    expect(posts[0][0]).toMatchObject({
      kind: 'runtime-error',
      errorKind: 'dependency',
    });
    expect(posts[0][0].message).toContain('network request failed');
    handlers.unhandledrejection({ reason: { name: 'AbortError', message: 'Request cancelled' } });
    expect(posts).toHaveLength(1);
  });

  it('reports caught fetch failures and redacts query strings from the dependency detail', async () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      parent: {
        postMessage: (message: Record<string, unknown>, origin: string) =>
          posts.push([message, origin]),
      },
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        handlers[type] = callback;
      },
      fetch: (_url: string) =>
        Promise.reject(
          new TypeError('Failed to fetch https://service.example.test/compile?token=secret'),
        ),
      console: { error: () => undefined },
    };
    installErrorShim(win, shim as string);

    await (win.fetch as (url: string) => Promise<unknown>)(
      'https://service.example.test/compile?key=secret',
    ).catch(() => undefined);
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toMatchObject({ errorKind: 'dependency' });
    expect(posts[0][0].message).toContain('network request failed');
    expect(posts[0][0].message).toContain('https://service.example.test/compile');
    expect(posts[0][0].message).not.toContain('secret');
  });

  it('reloads only on a parent retry and never replays the last clicked button', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const windowHandlers: Record<string, (event: unknown) => void> = {};
    const documentHandlers: Record<string, (event: unknown) => void> = {};
    let clicked = 0;
    let reloaded = 0;
    const action = { disabled: false, click: () => clicked++ };
    const doc = {
      baseURI: 'about:srcdoc',
      documentElement: { contains: () => true },
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        documentHandlers[type] = callback;
      },
    };
    const win = {
      parent: { postMessage: () => undefined },
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        windowHandlers[type] = callback;
      },
      location: {
        reload: () => reloaded++,
      },
      console: { error: () => undefined },
    };
    new Function('window', 'document', shim as string)(win, doc);
    documentHandlers.click?.({ target: { nodeType: 1, closest: () => action } });
    windowHandlers.message({ source: {}, data: { __maicRetryDependency: true } });
    expect(reloaded).toBe(0);
    windowHandlers.message({ source: win.parent, data: { __maicRetryDependency: true } });
    expect(clicked).toBe(0);
    expect(reloaded).toBe(1);
  });

  it('does not report non-fatal ResizeObserver loop diagnostics as runtime errors', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = {
      parent: { postMessage: (m: Record<string, unknown>, o: string) => posts.push([m, o]) },
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        handlers[t] = cb;
      },
      console: { error: (..._args: unknown[]) => {} },
    };
    installErrorShim(win, shim as string);

    handlers.error({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    handlers.error({ message: 'ResizeObserver loop limit exceeded' });
    expect(posts).toHaveLength(0);

    handlers.error({ message: 'TypeError: broken interactive' });
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'error' });
  });

  it('applies parent-selected playback speed to animations, frames, and timers', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-playback-speed-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    let now = 0;
    let wallNow = 10_000;
    let nextNativeTimerId = 1;
    const scheduled: Array<{ id: number; callback: () => void; delay: number }> = [];
    const cleared: number[] = [];
    const frameCallbacks: Array<(timestamp: number) => void> = [];
    const handlers: Record<string, (event: unknown) => void> = {};
    const parent = {};
    const win = {
      parent,
      performance: { now: () => now },
      Date: { now: () => wallNow },
      requestAnimationFrame: (callback: (timestamp: number) => void) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      },
      setTimeout: (callback: () => void, delay: number) => {
        const id = nextNativeTimerId++;
        scheduled.push({ id, callback, delay });
        return id;
      },
      clearTimeout: (id: number) => cleared.push(id),
      clearInterval: (id: number) => cleared.push(id),
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        handlers[type] = callback;
      },
      eval: (_source: string) => undefined,
    };
    const animations = [{ playbackRate: 1 }];
    const documentHandlers: Record<string, (event: unknown) => void> = {};
    const doc = {
      getAnimations: () => animations,
      addEventListener: (type: string, callback: (event: unknown) => void) => {
        documentHandlers[type] = callback;
      },
    };
    new Function('window', 'document', shim as string)(win, doc);

    const timeoutId = (win as unknown as Window).setTimeout(() => undefined, 1000);
    expect(scheduled[0].delay).toBe(1000);
    now = 250;
    handlers.message({
      source: parent,
      data: { __maicInteractivePlaybackSpeed: true, rate: 2 },
    });
    expect(animations[0].playbackRate).toBe(2);
    expect(cleared).toContain(1);
    expect(scheduled[1].delay).toBe(375);

    const frameTimes: number[] = [];
    (win as unknown as Window).requestAnimationFrame((time) => frameTimes.push(time));
    now = 266;
    frameCallbacks.shift()?.(now);
    (win as unknown as Window).requestAnimationFrame((time) => frameTimes.push(time));
    now = 282;
    frameCallbacks.shift()?.(now);
    expect(frameTimes).toEqual([282, 314]);
    expect(frameTimes[1]).toBe(win.performance.now());

    (win as unknown as Window).clearTimeout(timeoutId);
    expect(cleared).toContain(2);
    handlers.message({
      source: parent,
      data: { __maicInteractivePlaybackSpeed: true, rate: 1 },
    });
    expect(animations[0].playbackRate).toBe(1);
    handlers.message({
      source: {},
      data: { __maicInteractivePlaybackSpeed: true, rate: 0.5 },
    });
    expect(animations[0].playbackRate).toBe(1);
    handlers.message({
      source: parent,
      data: { __maicInteractivePlaybackSpeed: true, rate: 0.5 },
    });
    expect(animations[0].playbackRate).toBe(0.5);
    const performanceBeforeSlowdown = win.performance.now();
    const dateBeforeSlowdown = win.Date.now();
    now += 1000;
    wallNow += 1000;
    expect(win.performance.now() - performanceBeforeSlowdown).toBe(500);
    expect(win.Date.now() - dateBeforeSlowdown).toBe(500);
    (win as unknown as Window).setTimeout(() => undefined, 1000);
    expect(scheduled[scheduled.length - 1].delay).toBe(2000);
    handlers.message({
      source: parent,
      data: { __maicInteractivePlaybackSpeed: true, rate: 0.25 },
    });
    expect(animations[0].playbackRate).toBe(0.25);
    const performanceBeforeQuarterSpeed = win.performance.now();
    const dateBeforeQuarterSpeed = win.Date.now();
    now += 1000;
    wallNow += 1000;
    expect(win.performance.now() - performanceBeforeQuarterSpeed).toBe(250);
    expect(win.Date.now() - dateBeforeQuarterSpeed).toBe(250);
    (win as unknown as Window).setTimeout(() => undefined, 1000);
    expect(scheduled[scheduled.length - 1].delay).toBe(4000);
    expect(documentHandlers.animationstart).toBeTypeOf('function');
  });

  it('keeps the first and later frames on the performance clock across idle rate changes', () => {
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-playback-speed-shim>([\s\S]*?)<\/script>/)![1];
    let now = 0;
    let frameCallback: (timestamp: number) => void = () => undefined;
    let onMessage: (event: unknown) => void = () => undefined;
    const parent = {};
    const win = {
      parent,
      performance: { now: () => now },
      Date: { now: () => now },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      clearInterval: () => undefined,
      requestAnimationFrame: (callback: (timestamp: number) => void) => {
        frameCallback = callback;
        return 1;
      },
      addEventListener: (_type: string, callback: (event: unknown) => void) => {
        onMessage = callback;
      },
    };
    new Function('window', 'document', shim)(win, { getAnimations: () => [] });
    const setRate = (rate: number) =>
      onMessage({ source: parent, data: { __maicInteractivePlaybackSpeed: true, rate } });
    setRate(0.25);
    now = 4000;
    const start = win.performance.now();
    const frames: number[] = [];
    win.requestAnimationFrame((timestamp) => frames.push(timestamp));
    now = 4016;
    frameCallback(now);
    expect(frames[0] - start).toBe(4);
    expect(frames[0]).toBe(win.performance.now());

    now = 5000;
    setRate(2);
    now = 6000;
    setRate(0.5);
    win.requestAnimationFrame((timestamp) => frames.push(timestamp));
    now = 6016;
    frameCallback(now);
    expect(frames[1]).toBe(3258);
    expect(frames[1]).toBe(win.performance.now());
  });

  it('the error shim buffers errors and re-emits them on a parent replay request', () => {
    // Guards the subscribe-after-insert race: a page that throws synchronously
    // while srcDoc parses may post before the parent subscribes. The shim must
    // re-emit the whole buffer when the parent asks, so nothing is lost.
    const out = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = out.match(/<script data-iframe-error-shim>([\s\S]*?)<\/script>/)?.[1];
    const posts: Array<[Record<string, unknown>, string]> = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = {
      parent: { postMessage: (m: Record<string, unknown>, o: string) => posts.push([m, o]) },
      addEventListener: (t: string, cb: (e: unknown) => void) => {
        handlers[t] = cb;
      },
      console: { error: (..._args: unknown[]) => {} },
    };
    installErrorShim(win, shim as string);

    // Two errors fire "before the parent subscribed".
    handlers.error({ message: 'first boom' });
    handlers.unhandledrejection({ reason: { message: 'second boom' } });
    expect(posts).toHaveLength(2);

    // Parent now subscribes and requests a replay.
    handlers.message({ data: { __maicErrorReplayRequest: true } });
    expect(posts).toHaveLength(4);
    expect(String(posts[2][0].message)).toContain('first boom');
    expect(String(posts[3][0].message)).toContain('second boom');
    expect(posts[2][0]).toMatchObject({ kind: 'runtime-error', errorKind: 'error' });

    // An unrelated message must NOT trigger a replay.
    handlers.message({ data: { foo: 1 } });
    expect(posts).toHaveLength(4);
  });
});
