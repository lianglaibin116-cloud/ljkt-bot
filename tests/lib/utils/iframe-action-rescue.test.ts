// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__maicActionRescueInstalled;
  delete (window as unknown as Record<string, unknown>).__maicActionRescueRefresh;
});

describe('iframe action rescue shim', () => {
  it('does not offer a submit shortcut over a paused game', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const submit = document.createElement('button');
    submit.textContent = '确认提交 Submit';
    submit.getBoundingClientRect = () =>
      ({ left: 20, right: 140, top: 900, bottom: 946, width: 120, height: 46 }) as DOMRect;
    const overlay = document.createElement('div');
    overlay.id = 'pause-overlay';
    overlay.getBoundingClientRect = () =>
      ({ left: 0, right: 800, top: 0, bottom: 600, width: 800, height: 600 }) as DOMRect;
    document.body.append(submit, overlay);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    expect(document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button')?.style.display).toBe('none');
  });

  it('proxies an off-screen submit control through the original game handler', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    expect(shim).toBeTruthy();

    const submit = document.createElement('button');
    submit.textContent = '✓ 提交';
    submit.getBoundingClientRect = () =>
      ({ left: 20, right: 140, top: 900, bottom: 946, width: 120, height: 46 }) as DOMRect;
    const originalClick = vi.fn();
    submit.addEventListener('click', originalClick);
    document.body.appendChild(submit);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    const proxy = document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button');
    expect(proxy?.textContent).toContain('提交');
    expect(proxy?.style.display).toBe('block');
    proxy?.click();
    expect(originalClick).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a submit control that is already inside the viewport', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    const submit = document.createElement('button');
    submit.textContent = 'Confirm answer';
    submit.getBoundingClientRect = () =>
      ({ left: 20, right: 160, top: 100, bottom: 146, width: 140, height: 46 }) as DOMRect;
    document.body.appendChild(submit);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    const proxy = document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button');
    expect(proxy?.style.display).toBe('none');
  });

  it('rescues a geometrically in-view control that is actually covered', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    const submit = document.createElement('button');
    submit.textContent = '确认答案';
    submit.getBoundingClientRect = () =>
      ({ left: 20, right: 160, top: 100, bottom: 146, width: 140, height: 46 }) as DOMRect;
    const coveringPanel = document.createElement('div');
    document.body.append(submit, coveringPanel);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => coveringPanel,
    });

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    const proxy = document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button');
    expect(proxy?.style.display).toBe('block');
    expect(proxy?.textContent).toBe('确认答案');
  });

  it('rescues an authored submit control hidden by the game layout after start', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    const submit = document.createElement('button');
    submit.textContent = '✓ 提交';
    submit.style.display = 'none';
    const originalClick = vi.fn();
    submit.addEventListener('click', originalClick);
    document.body.appendChild(submit);

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    const proxy = document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button');
    expect(proxy?.style.display).toBe('block');
    proxy?.click();
    expect(originalClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the proxy hidden while a visible restart action is available', () => {
    const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
    const shim = patched.match(/<script data-iframe-action-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
    const submit = document.createElement('button');
    submit.textContent = '✓ 提交';
    submit.style.display = 'none';
    const restart = document.createElement('button');
    restart.textContent = '重新挑战';
    restart.getBoundingClientRect = () =>
      ({ left: 20, right: 160, top: 100, bottom: 146, width: 140, height: 46 }) as DOMRect;
    document.body.append(submit, restart);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => restart,
    });

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    new Function('window', 'document', 'MutationObserver', shim as string)(
      window,
      document,
      MutationObserver,
    );
    document.dispatchEvent(new Event('DOMContentLoaded'));
    (window as unknown as { __maicActionRescueRefresh: () => void }).__maicActionRescueRefresh();

    const proxy = document.querySelector<HTMLButtonElement>('[data-maic-action-rescue] button');
    expect(proxy?.style.display).toBe('none');
  });
});
