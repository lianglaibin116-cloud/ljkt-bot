/** Browser-only checks inserted into the isolated, disposable validation iframe. */
export const INTERACTIVE_VISUAL_VALIDATION_DRIVER = `
    var reportedVisualFailures = new Set();
    var canvasSamples = new WeakMap();
    var resizeLoopWarnings = 0;
    window.addEventListener('error', function (event) {
      if (/^ResizeObserver loop/.test(String(event.message))) resizeLoopWarnings++;
    });
    function reportVisualFailure(message) {
      if (reportedVisualFailures.has(message) || reportedVisualFailures.size >= 5) return;
      reportedVisualFailures.add(message);
      window.parent.postMessage({
        __maicInteractive: true,
        kind: 'runtime-error',
        errorKind: 'layout',
        message: message
      }, '*');
    }
    function elementName(element) {
      return element.id ? '#' + element.id.slice(0, 80) : element.tagName.toLowerCase();
    }
    function checkVisualLayout() {
      Array.prototype.forEach.call(document.querySelectorAll('[hidden]'), function (element) {
        if (String(element.getAttribute('hidden')).toLowerCase() === 'until-found') return;
        var style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' ||
            style.visibility === 'collapse' || style.contentVisibility === 'hidden' ||
            Number(style.opacity) === 0) return;
        var rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || !element.getClientRects().length) return;
        reportVisualFailure('Hidden element remains displayed (' + elementName(element) +
          '). Preserve its [hidden] display:none rule instead of covering the working page.');
      });
      Array.prototype.forEach.call(document.querySelectorAll('canvas'), function (canvas) {
        var width = canvas.clientWidth;
        var height = canvas.clientHeight;
        if (width <= 0 || height <= 0) return;
        var viewportWidth = window.innerWidth;
        var viewportHeight = window.innerHeight;
        var previous = canvasSamples.get(canvas);
        var sameViewport = previous && previous.viewportWidth === viewportWidth &&
          previous.viewportHeight === viewportHeight;
        function increased(value, oldValue) { return oldValue > 0 && value >= oldValue * 1.25; }
        var growing = sameViewport && (increased(width, previous.width) ||
          increased(height, previous.height) || increased(canvas.width, previous.pixelsWidth) ||
          increased(canvas.height, previous.pixelsHeight));
        var growthCount = growing ? previous.growthCount + 1 : 0;
        var slowlyGrowing = sameViewport && (width > previous.width || height > previous.height);
        var slowGrowthCount = slowlyGrowing ? previous.slowGrowthCount + 1 : 0;
        canvasSamples.set(canvas, {
          width: width, height: height, pixelsWidth: canvas.width, pixelsHeight: canvas.height,
          viewportWidth: viewportWidth, viewportHeight: viewportHeight, growthCount: growthCount,
          slowGrowthCount: slowGrowthCount
        });
        // Large but stable canvases are valid. Only sustained growth at a stable
        // viewport plus excessive size establishes this particular failure.
        var excessiveSize = width > viewportWidth * 4 || height > viewportHeight * 4 ||
          canvas.width * canvas.height > 16777216;
        // Padding/border feedback can grow by only a few pixels per frame. A
        // repeated observer-loop warning distinguishes it from a normal tween.
        var observerFeedback = slowGrowthCount >= 8 && resizeLoopWarnings >= 6;
        if ((growthCount >= 3 && excessiveSize) || observerFeedback) {
          reportVisualFailure('Canvas keeps growing at a stable viewport (' + elementName(canvas) +
            '). Give its container an independent CSS size; bitmap resizing must not resize that container.');
        }
      });
    }
    var visualFrames = 0;
    function sampleVisualLayout() {
      checkVisualLayout();
      visualFrames++;
      if (visualFrames < 24 && reportedVisualFailures.size === 0) {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(sampleVisualLayout);
        } else {
          window.setTimeout(sampleVisualLayout, 16);
        }
      }
    }
    sampleVisualLayout();
    window.setTimeout(checkVisualLayout, 700);
`;
