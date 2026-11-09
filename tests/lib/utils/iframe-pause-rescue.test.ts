// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

function installPauseRescue() {
  const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
  const shim = patched.match(/<script data-iframe-pause-rescue-shim>([\s\S]*?)<\/script>/)?.[1];
  expect(shim).toBeTruthy();
  new Function('window', 'document', shim as string)(window, document);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__maicPauseRescueInstalled;
});

describe('iframe pause rescue shim', () => {
  it('uses the original pause control to resume without covering other controls', async () => {
    const pauseControl = document.createElement('button');
    pauseControl.setAttribute('onclick', 'togglePause()');
    pauseControl.textContent = '暂停 Pause';
    const overlay = document.createElement('div');
    overlay.id = 'pause-overlay';
    overlay.className = 'pause-overlay';
    overlay.textContent = 'PAUSED 暂停';
    document.body.append(pauseControl, overlay);

    const originalHandler = vi.fn(() => overlay.classList.add('hidden'));
    pauseControl.click = originalHandler;
    installPauseRescue();

    expect(overlay.style.background).toBe('transparent');
    expect(overlay.style.backdropFilter).toBe('none');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.querySelector('button')).toBeNull();
    expect(pauseControl.textContent).toContain('继续游戏');
    pauseControl.click();
    await vi.waitFor(() => expect(pauseControl.textContent).toBe('暂停 Pause'));
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(overlay.classList.contains('hidden')).toBe(true);
    overlay.classList.remove('hidden');
    await vi.waitFor(() => expect(pauseControl.textContent).toContain('继续游戏'));
  });

  it('does not add a second resume control when the overlay already has one', () => {
    const pauseControl = document.createElement('button');
    pauseControl.setAttribute('onclick', 'togglePause()');
    const overlay = document.createElement('div');
    overlay.id = 'pause-overlay';
    const existingResume = document.createElement('button');
    existingResume.textContent = 'Resume';
    overlay.appendChild(existingResume);
    document.body.append(pauseControl, overlay);

    installPauseRescue();
    expect(overlay.querySelector('[data-maic-resume]')).toBeNull();
  });

  it('does not invent a resume action when there is no known game toggle', () => {
    const overlay = document.createElement('div');
    overlay.id = 'pause-overlay';
    overlay.textContent = 'PAUSED';
    document.body.appendChild(overlay);

    installPauseRescue();
    expect(overlay.querySelector('[data-maic-resume]')).toBeNull();
  });
});
