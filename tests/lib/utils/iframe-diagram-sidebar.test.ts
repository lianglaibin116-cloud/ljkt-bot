// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

function installDiagramSidebarShim() {
  const patched = patchHtmlForIframe('<html><head></head><body></body></html>');
  const shim = patched.match(/<script data-iframe-diagram-sidebar-shim>([\s\S]*?)<\/script>/)?.[1];
  expect(shim).toBeTruthy();
  new Function('window', 'document', shim as string)(window, document);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__maicDiagramSidebarInstalled;
});

describe('iframe diagram sidebar shim', () => {
  it('reserves the open sidebar width and restores the full diagram when collapsed', async () => {
    const container = document.createElement('div');
    container.className = 'diagram-container';
    const diagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    diagram.id = 'diagram';
    diagram.setAttribute('viewBox', '0 0 1100 620');
    container.appendChild(diagram);
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.style.position = 'absolute';
    sidebar.style.width = '340px';
    vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue({ width: 340 } as DOMRect);
    document.body.append(container, sidebar);

    installDiagramSidebarShim();
    expect(container.style.right).toBe('340px');

    sidebar.classList.add('collapsed');
    await vi.waitFor(() => expect(container.style.right).toBe('0px'));

    sidebar.classList.remove('collapsed');
    await vi.waitFor(() => expect(container.style.right).toBe('340px'));

    sidebar.style.display = 'none';
    await vi.waitFor(() => expect(container.style.right).toBe('0px'));
  });

  it('leaves unrelated interactive layouts unchanged', () => {
    const container = document.createElement('div');
    container.className = 'diagram-container';
    const diagram = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    diagram.id = 'other-diagram';
    diagram.setAttribute('viewBox', '0 0 1100 620');
    container.appendChild(diagram);
    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.style.position = 'absolute';
    document.body.append(container, sidebar);

    installDiagramSidebarShim();
    expect(container.style.right).toBe('');
  });
});
