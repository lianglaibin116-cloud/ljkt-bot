import { injectIntoDocumentHead } from '@/lib/utils/html-document';
import { patchHtmlForIframe } from '@/lib/utils/iframe';
import { INTERACTIVE_VISUAL_VALIDATION_DRIVER } from './visual-validation-driver';

const VALIDATION_TIMEOUT_MS = 2_500;
const POST_LOAD_CHECK_MS = 900;
const MAX_RUNTIME_ERRORS = 5;

const VALIDATION_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data:; connect-src 'none'; media-src data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'">`;

export interface InteractiveHtmlValidationResult {
  /** Deterministic page-code failures that should block saving or generation. */
  readonly errors: string[];
  /** External resources intentionally skipped by the isolated offline check. */
  readonly warnings: string[];
}

export function listExternalInteractiveResources(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<(script|link)\b[^>]*>/giu)) {
    const attribute = match[1]?.toLowerCase() === 'script' ? 'src' : 'href';
    const attributeMatch = match[0].match(
      new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu'),
    );
    const value = attributeMatch?.[1] ?? attributeMatch?.[2] ?? attributeMatch?.[3];
    if (value && /^(?:https?:)?\/\//iu.test(value)) urls.add(value);
  }
  return [...urls];
}

/**
 * Exercise generated HTML inside the same script-only sandbox used for lessons.
 * External network access is denied so validation cannot send requests or rely
 * on a third-party CDN. The iframe is removed on every exit path.
 */
export async function validateGeneratedInteractiveHtml(
  html: string,
): Promise<InteractiveHtmlValidationResult> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { errors: [], warnings: [] };
  }

  const errors = new Set<string>();
  const warnings = new Set<string>();
  const externalResources = listExternalInteractiveResources(html);
  if (externalResources.length > 0) {
    warnings.add(
      `Offline validation skipped ${externalResources.length} external script or stylesheet resource(s).`,
    );
  }
  const iframe = document.createElement('iframe');
  iframe.title = 'Interactive content validation';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:fixed;left:-10000px;top:0;width:960px;height:540px;border:0;visibility:hidden;pointer-events:none;';

  let timeout: number | undefined;
  let loadListener: EventListener | undefined;
  let visualFailed = false;
  let finishVisualFailure: () => void = () => {};
  const visualFailure = new Promise<void>((resolve) => {
    finishVisualFailure = resolve;
  });
  const onMessage = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as
      | { __maicInteractive?: unknown; kind?: unknown; errorKind?: unknown; message?: unknown }
      | undefined;
    if (data?.__maicInteractive !== true || data.kind !== 'runtime-error') return;
    const message = typeof data.message === 'string' ? data.message.trim() : '';
    if (!message) return;
    if (data.errorKind === 'dependency' || data.errorKind === 'resource') {
      warnings.add(`[dependency] ${message.slice(0, 700)}`);
      return;
    }
    // A blocked resource does not establish the cause of a later script error.
    // Keep page-code failures blocking even when the same page has warnings.
    errors.add(`[${String(data.errorKind || 'error')}] ${message.slice(0, 700)}`);
    if (data.errorKind === 'layout') {
      visualFailed = true;
      finishVisualFailure();
    }
  };

  const validationDriver = INTERACTIVE_VALIDATION_DRIVER;
  const source = patchHtmlForIframe(
    injectIntoDocumentHead(html, `${VALIDATION_CSP}${validationDriver}`),
  );
  try {
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
    const loaded = new Promise<void>((resolve) => {
      loadListener = () => resolve();
      iframe.addEventListener('load', loadListener, { once: true });
    });
    iframe.srcdoc = source;
    const didLoad = await Promise.race([
      loaded.then(() => true),
      visualFailure.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = window.setTimeout(() => resolve(false), VALIDATION_TIMEOUT_MS);
      }),
    ]);
    if (timeout !== undefined) {
      window.clearTimeout(timeout);
      timeout = undefined;
    }
    if (!didLoad) errors.add('[timeout] Interactive content did not finish loading in time.');
    iframe.contentWindow?.postMessage({ __maicErrorReplayRequest: true }, '*');
    for (const [width, height] of [
      [320, 640],
      [768, 768],
      [960, 540],
    ]) {
      if (visualFailed) break;
      iframe.style.width = `${width}px`;
      iframe.style.height = `${height}px`;
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    await Promise.race([
      visualFailure,
      new Promise<void>((resolve) => {
        timeout = window.setTimeout(resolve, POST_LOAD_CHECK_MS);
      }),
    ]);
    return {
      errors: [...errors].slice(0, MAX_RUNTIME_ERRORS),
      warnings: [...warnings].slice(0, MAX_RUNTIME_ERRORS),
    };
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (loadListener) iframe.removeEventListener('load', loadListener);
    window.removeEventListener('message', onMessage);
    iframe.remove();
  }
}

export const INTERACTIVE_VALIDATION_DRIVER = `<script data-maic-validation-driver>
(function () {
  window.addEventListener('DOMContentLoaded', function () {
${INTERACTIVE_VISUAL_VALIDATION_DRIVER}
    function buttonLabel(button) {
      return (button.innerText || button.getAttribute('aria-label') || '')
        .trim()
        .replace(/^[^a-z0-9\u3400-\u9fff]+/i, '');
    }
    var controls = document.querySelectorAll('input[type="range"], input[type="number"]');
    Array.prototype.forEach.call(controls, function (control) {
      var original = control.value;
      ['min', 'max'].forEach(function (edge) {
        var value = control.getAttribute(edge);
        if (value === null || value === '') return;
        control.value = value;
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
      control.value = original;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    var start = Array.prototype.find.call(document.querySelectorAll('button'), function (button) {
      var label = buttonLabel(button);
      var lowerLabel = label.toLowerCase();
      return !button.disabled && (
        lowerLabel.indexOf('start') === 0 ||
        lowerLabel.indexOf('run') === 0 ||
        lowerLabel.indexOf('play') === 0 ||
        label.indexOf('开始') === 0 ||
        label.indexOf('启动') === 0 ||
        label.indexOf('运行') === 0 ||
        label.indexOf('播放') === 0
      );
    });
    if (start) start.click();
    var step = Array.prototype.find.call(document.querySelectorAll('button'), function (button) {
      var label = buttonLabel(button);
      return !button.disabled && /^(next|step|continue|下一步|单步|继续)/i.test(label);
    });
    var reset = Array.prototype.find.call(document.querySelectorAll('button'), function (button) {
      var label = buttonLabel(button);
      return !button.disabled && /^(reset|restart|重置|重新开始|复位)/i.test(label);
    });
    if (step) window.setTimeout(function () { step.click(); }, 120);
    if (reset) window.setTimeout(function () { reset.click(); }, 260);
  });
})();
</script>`;
